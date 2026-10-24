# RAKSHAK Web Demo: Architecture Plan

**Team:** Git Happens · **Event:** ChronoForge, NITK Surathkal · **Track:** Cybersecurity

This plan maps the Round 1 proposal (`RAKSHAK_GitHappens_ChronoForge_Round1_Proposal.pdf`) onto a browser-based simulation. It has three screens (predator chat, victim chat and the RAKSHAK console) and two modes:

- **Mode A:** AI runs both chats and the engine analyses them.
- **Mode B:** two humans chat live and the engine analyses them in real time.

The engine's cue classifier has **two interchangeable backends**:

- **GPT backend:** OpenAI API, server-side.
- **In-house backend:** our own trained model, on-device.

Both feed the same deterministic scoring engine.

---

## 1. Core idea: the classifier labels, the engine decides

Each backend does only one job: turn a message into **cue probabilities**. Everything after that is our own deterministic, explainable code: case memory, decay, sequence multipliers, floors, levels and rule traces. That has three benefits:

- Alerts stay **explainable and reproducible**. The same cues always give the same level, whichever backend produced them.
- The proposal's golden numbers (1.0 → 2.9 → 8.4 → 10.9) hold for both backends.
- We can swap backends live in the demo and compare them on the same conversation.

```
┌──────────────────┐        ┌──────────────────────┐        ┌───────────────────────────┐
│  SCREEN 1        │        │  SCREEN 2            │        │  SCREEN 3                 │
│  Predator chat   │        │  Victim chat         │        │  RAKSHAK Console          │
│  (iMessage glass)│        │  (iMessage glass)    │        │  ├─ Device debug view     │
│                  │        │  ┌────────────────┐  │        │  ├─ Guardian phone (L2/L3)│
│                  │        │  │ ENGINE         │  │        │  └─ Backend switch        │
│                  │        │  │ normalize →    │  │        │     GPT ⇄ In-house        │
│                  │        │  │ classify* →    │──┼─min───▶│                           │
│                  │        │  │ memory → score │  │ payload│                           │
│                  │        │  │ → policy       │  │        │                           │
│                  │        │  └───────┬────────┘  │        └─────────────▲─────────────┘
└────────┬─────────┘        └──────────┼───────────┘                      │
         │  chat messages              │ *GPT backend only:               │
         │                             │  text → /classify                │
         └──────────┬──────────────────┘                                  │
                    ▼                                                     │
        ┌───────────────────────────────────────────────────┐            │
        │  SERVER (Node + Socket.IO)                        │────────────┘
        │  • rooms / message relay (Mode B)                 │
        │  • Scenario Director (Mode A)                     │
        │  • Classifier Gateway → OpenAI API (key here)     │
        │  • Sim clock (Day 1 → Day 6 time-skips)           │
        └───────────────────────────────────────────────────┘
```

### Privacy framing, per backend

| Backend | Where text goes | How we present it |
|---|---|---|
| **In-house** | Nowhere. The model runs in the victim tab (ONNX). | **"On-device mode."** This is the proposal's real target, and judges can confirm it in DevTools. |
| **GPT** | One message (plus a short redacted context window) goes to our server, then to OpenAI. | **"Cloud prototype mode."** Fast to ship and strong on Tanglish. We say plainly that it is a stepping stone, and that the production design is on-device. |

> Being upfront about this difference fits the proposal's "Honest coverage" tone, and judges will respect it.

> **Billing note:** a ChatGPT Plus/Pro subscription does **not** include API access. The API is billed separately through platform.openai.com, so make sure the team has API credits.

---

## 2. The engine (`packages/engine`)

```
message ─▶ [A] Normalize ─▶ [B] Cue Classifier ─▶ [C] Case Memory ─▶ [D] Stage & Score ─▶ [E] Response Policy ─▶ Alert
            leetspeak,       GPT  ⇄  In-house        per-contact         decay, ×2 seq,       L1 child nudge
            emoji, Tanglish  (same interface)        (IndexedDB,         floors, reductions   L2 guardian alert
            translit, lang-ID                        encrypted)          → rule trace          L3 critical + report
```

### 2.1 Cue taxonomy (from proposal §03)

| Cue | Example (EN / Tanglish) | Default weight |
|---|---|---|
| Flattery / age | "so mature for your age" | 1 |
| Secrecy | "don't tell your parents" / "amma kitta sollaadha" | 2 |
| Isolation | "your friends don't get you like I do" | 2 |
| Platform move | "add me on snap / telegram" | 2 |
| Image request | "send a pic, just for me" | 3 |
| Meeting request | "come alone, don't tell anyone" | 3 |
| Disable protection | "delete that app / turn it off" | 4 |
| Threat / payment | "pay or everyone sees it" | 4 |
| Insult / harassment | "nobody wants you here" | 1 |

### 2.2 Scoring rules (all values live in `config.json`)

- **Cue activation:** a cue counts when its probability is at or above `cueThreshold` (default 0.5). A separate threshold can be set per backend for calibration.
- **Accumulation:** each active cue adds its weight to the contact's case score.
- **Decay:** `score × 0.5^(Δdays / 7)`, a 7-day half-life.
- **Sequence multiplier:** secrecy or isolation followed by an image or meeting request counts **×2**.
- **Thresholds:** score ≥ 2 → Level 1 · ≥ 5 → Level 2 · ≥ 9 → Level 3.
- **Severity floors** (minimum level regardless of score):
  - threat / payment → Level 3
  - image or meeting request from a contact first seen within 14 days → Level 2
  - disable-protection → Level 2
- **Reductions:**
  - quotes or counterspeech → ×0.3
  - child's dismissal → ×0.5, but never below Level 1 and never at the Request or Coercion stage. Dismissals are counted and shown in the Level 2 summary.
- **Bullying path:** a child-level harassment score sums insult cues across *all* senders. It routes to parent + school counsellor, not to a cybercrime report, unless threats or images are involved.
- **Linked contacts:** an unknown contact messaging within 24 h of a block starts at the blocked case's stage, pending review.
- **Retention:** 30 days by default.

### 2.3 Data model (`packages/shared`)

```ts
type Cue =
  | "flattery_age" | "secrecy" | "isolation" | "platform_move"
  | "image_request" | "meeting_request" | "disable_protection"
  | "threat_payment" | "insult_harassment";

type Stage = "rapport" | "secrecy_isolation" | "request" | "coercion";
type Level = 0 | 1 | 2 | 3;
type Backend = "gpt" | "inhouse";

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  simTime: number;            // simulated clock, ms
}

interface CueResult {
  scores: Partial<Record<Cue, number>>;   // probability per cue, 0..1
  isQuoteOrCounterspeech: boolean;
  backend: Backend;
  latencyMs: number;
  rationale?: string;         // GPT only: one short line, shown in debug view
}

interface Case {
  contactHash: string;        // hashed contact ID, never the raw ID
  stage: Stage;
  score: number;
  lastUpdatedSimTime: number;
  firstSeen: number;
  cueHistory: { cue: Cue; simTime: number; excerpt: string }[];  // short redacted excerpts
  dismissals: number;
  linkedFrom?: string;
}

interface Alert {
  id: string;
  level: Level;
  contactHash: string;
  stage: Stage;
  score: number;
  ruleTrace: string[];        // e.g. ["secrecy(2.0)", "image_request(3.0×2)", "floor:new_contact_14d", "→ L2"]
  simTime: number;
  backend: Backend;
}

interface GuardianPayload {   // the ONLY thing that reaches the guardian phone
  level: Level;
  contactHash: string;
  stage: Stage;
  cues: { cue: Cue; date: string }[];  // cue types & dates, no chat text
  dismissals: number;
}
```

### 2.4 Storage

The case memory lives in **IndexedDB, encrypted with WebCrypto AES-GCM**. It is the browser version of the proposal's Keystore-encrypted DB. No images and no full chats are stored.

### 2.5 Golden test

The engine must reproduce the proposal's six-day illustration exactly. The test feeds fixed `CueResult`s, so it runs independently of the backend:

| Day | Message cue | Calculation | Score | Level |
|---|---|---|---|---|
| 1 | Flattery / age | +1.0 | **1.0** | Logged (rapport) |
| 2 | Secrecy | 0.9 + 2.0 | **2.9** | L1 (child nudge) |
| 4 | Image request | 2.4 + 3.0×2 | **8.4** | L2 (also new-contact floor) |
| 6 | Threat / payment | 6.9 + 4.0 | **10.9** | L3 (also threat floor) |

This is test #1 in Vitest.

---

## 3. Classifier backends

Both backends implement one interface:

```ts
interface CueClassifier {
  readonly backend: Backend;
  classify(text: string, context?: string[]): Promise<CueResult>;
}
```

### 3.1 GPT backend (`GptClassifier`)

- **Flow:** victim tab → `POST /api/classify` on our server → OpenAI API → validated `CueResult` back to the tab. **The API key never reaches the browser.**
- **Model:** a small, fast GPT tier (the current "mini"-class model). The model name lives in `config.json` so it can be swapped without code changes.
- **Structured output:** use OpenAI's JSON-schema structured outputs so the response always matches `CueResult.scores` plus `isQuoteOrCounterspeech` and a one-line `rationale`. Validate it again server-side with Zod.
- **Settings:** temperature 0 and a fixed system prompt holding the cue taxonomy, the definitions and roughly 15 few-shot examples. These include Tanglish, hard negatives and leetspeak.
- **Context window:** the current message plus the **last 3 turns**, redacted (names and numbers masked). This lets it spot quoting and counterspeech. Memory across days stays in our engine, not in the prompt.
- **Data minimisation:** send no contact IDs or names, only the text. Log only cue outputs, never the text.
- **Reliability:**
  - Cache results by message hash, so demo replays are instant and free.
  - Use a 4 s timeout. On error, refusal or rate limit, **fall back to the in-house model** and show a "fallback" badge in the console.
  - The console shows per-message latency.
- **Bonus role, as teacher for the in-house model:** GPT pre-labels the training set (humans then review it). That speeds up labelling and makes the in-house model a distillation of the GPT backend.

### 3.2 In-house backend (`InHouseClassifier`)

- **Runs in the victim tab** through `onnxruntime-web` (WASM/WebGPU). This is the true on-device path.
- **Model ladder:** pick by measured accuracy and latency.
  1. **Char n-gram logistic regression:** the guaranteed fallback. It trains in minutes and is exported with `skl2onnx`.
  2. **bert-tiny, fine-tuned for multi-label output:** the proposal's on-device candidate. It is exported through `optimum` / `torch.onnx`.
  3. **IndicBERT:** a stretch goal, tested for Tanglish.
- **Training (`/training`, Python):** data from PAN-2012 lines, DravidianCodeMix, Civil Comments / Jigsaw (insult and threat classes only), team-written scenarios and GPT pre-labels that humans review. Outsiders write the blind test set.
- **Optional:** a FastAPI service for the same ONNX model, if browser inference is too slow on the demo laptop. It is still "in-house", but present it as a local server, not on-device.

### 3.3 Keyword baseline (comparison only)

`KeywordClassifier` is **not** an engine backend. It exists only for the "3 setups" comparison (§6.4), so we can show how much earlier the engine with memory alerts.

> The proposal says no prep is allowed before the 24h window, with a dataset of about 500 messages. **Confirm what can be brought in**, such as pre-trained weights and the prompt. The GPT backend needs no training, which makes it the safest bet if training time runs short.

---

## 4. Mode A: AI runs both chats

The server-side **Scenario Director** plays scenario files. Each file is a list of *beats*: `{ stage, cueIntent, simDay, speaker }`.

### Scenarios

- Grooming over 6 days (the proposal's illustration)
- Scripted sextortion ring replayed from rotating accounts
- Multi-sender bullying pile-on
- Platform-move / cross-app case
- **Hard negatives:** surprise-party secret, friend banter, quoting the news
- **Adversarial:** misspellings, leetspeak, emoji, Tamil script

### How lines are produced

GPT models will often refuse to play an adult grooming a child, even at a non-explicit level. So:

- **Primary:** hand-written scripted transcripts for the predator side. These are deterministic, safe for a live demo, and match the Tanglish examples.
- **GPT role:** voice the victim's replies and generate paraphrased variants and hard negatives. That exercises the engine on text it hasn't seen.
- **Offline fallback:** pre-recorded runs, with cached classifier outputs, in case the venue Wi-Fi fails.

The server pushes lines to both chat screens with realistic typing delays.

---

## 5. Mode B: two humans chat live

- Same UI, same relay. Two devices join a **room by code**.
- The engine runs on the victim client. With the GPT backend, only the classify call goes to the server.
- A **sim-clock control** on the console ("⏩ +1 day") lets the 7-day decay and the 14-day new-contact floor show up in a 3-minute demo.

---

## 6. UI layer (`apps/web`, React + Vite + Tailwind + Framer Motion)

### 6.1 Chat screens (`/predator`, `/victim`)

- iPhone frame, glass blur (`backdrop-filter: blur(24px) saturate(180%)`)
- Blue sent bubbles (`#0A84FF`), gray received bubbles, with tails
- Typing dots, "Delivered / Read" receipts
- Font: `-apple-system, "SF Pro Text", Inter, system-ui` (SF on Apple devices, Inter elsewhere)

### 6.2 Alert design system

Inspired by the reference board (`Screenshot 2026-10-23 135552.png`):
- glossy 3D warning triangles
- the dark "CRITICAL" glass card with a red glow
- the neon-outlined **WARNING** sign
- the soft toast with faint hazard stripes
- red HUD-style line icons

**Design rule: escalate the intensity with the level, and never scare the child.** The alarming red visuals are for the **guardian**. The child sees something calm and supportive. A frightened child closes the app, while a supported one talks to someone.

| | **Level 1: Gentle nudge** | **Level 2: Guardian alert** | **Level 3: Critical** |
|---|---|---|---|
| **Seen by** | Child (victim phone) | Guardian phone + console | Guardian phone (full takeover) + console |
| **Inspiration** | Soft light toast with faint amber hazard stripes | iOS "Time Sensitive" banner + glossy 3D amber triangle | Dark "CRITICAL" glass card, glossy red 3D triangle on a pedestal, neon red border, hazard band |
| **Palette** | Warm amber tint on frosted white · `#FFD60A` @ 15% | Amber/orange · `#FF9F0A` on dark glass | Red `#FF453A` on near-black `#0B0B0F`, red outer glow |
| **Surface** | Light glass card inside the chat, above the composer | Banner drops from the top, tap → expands to a detail sheet | Screen dims to black, centred critical card, pulsing glow |
| **Motion** | Slide up + fade, 250 ms, gentle spring | Spring drop from top (stiffness 400, damping 30), small icon bounce | 250 ms dim → card scales 0.92→1 with spring → glow pulse (1.6 s loop) + siren-beacon sweep (2 s) + 2-shake of the phone frame |
| **Sound** | None | Soft chime (toggle) | Critical tone (toggle) |
| **Example copy** | "Hey, safe people don't ask you to keep chats secret. Want to talk to someone you trust?" | "**RAKSHAK · Time Sensitive.** A new contact is showing a grooming pattern: 3 cues over 4 days. Tap to review." | "**CRITICAL: threat & payment demand.** Don't pay. Don't delete anything. Start a guided report now." |
| **Actions** | Talk to someone · Block · Dismiss | Review summary · Talk to child · Block contact | Start guided report · Call 1930 · Contact trusted adult |

**What the guardian sees:** only the `GuardianPayload`, meaning cue types, dates, stage, score and dismissal count. **Never chat text.** A small line, "Message content stays on your child's device", makes the privacy promise visible.

### 6.3 Alert components (`apps/web/src/alerts/`)

| Component | Purpose |
|---|---|
| `Icon3DWarning` | Glossy 3D triangle drawn in SVG: layered gradients, inner highlight, soft drop shadow, optional pedestal. Amber and red variants. No raster assets needed. |
| `NudgeCard` | Level 1 child card. Frosted light glass with a faint diagonal amber stripe texture. |
| `GuardianBanner` | Level 2 iOS-style notification that drops in, swipes to dismiss and taps to expand. |
| `AlertSheet` | Expanded Level 2 detail: stage stepper, cue timeline (dates only), score ring, dismissal count. |
| `CriticalTakeover` | Level 3 full-screen dark card: neon border, hazard band, siren glow, action stack. |
| `HazardStripe` | Animated diagonal stripe band (CSS `repeating-linear-gradient` + slow translate). |
| `NeonBadge` | Level badge with a neon text-shadow glow ("WARNING" style), used in the console. |
| `CueChip` | HUD-style red/amber line icon + label, attached to each message in the debug view. |
| `ScoreRing` | Animated radial score with a count-up and tick marks at 2 / 5 / 9. |
| `ReportFlow` | Level 3 guided report stepper. Preserve evidence → 1930 / cybercrime.gov.in → Take It Down. **Mocked, never actually submitted.** |

**Polish details:**
- Shared layout animations (`layoutId`), so a banner morphs smoothly into its expanded sheet.
- Score changes animate with a count-up, and the stage stepper fills like a progress bar.
- A subtle grain or noise overlay on the dark cards makes the glass feel premium.
- `prefers-reduced-motion` turns animations into plain fades. Level is always shown by **icon + text + colour**, never by colour alone.

### 6.4 Console (`/console`)

- **Guardian phone mock:** the real recipient of L2/L3 alerts, using the components above
- **Device debug view:** per-message cue chips, backend badge (GPT / In-house / Fallback), latency, GPT rationale, rule-trace log
- **Charts:** score-over-time chart with neon threshold lines at 2 / 5 / 9, and a stage stepper
- **Controls:**
  - sim clock
  - scenario picker
  - sound toggle
  - **Backend switch (GPT ⇄ In-house)**, which re-runs the current conversation through the other backend
- **Flagship comparison, the "3 setups" view:** keyword-only vs model-per-message vs model + memory, run side by side on the same conversation. It shows the headline metric live: *"alerted N messages earlier than the keyword baseline."* A second toggle compares **GPT vs In-house** on the same view.

---

## 7. Repo layout

```
rakshak/
├─ apps/
│  ├─ web/                React UI: /predator, /victim, /console
│  │  └─ src/alerts/      alert design system components (§6.3)
│  └─ server/             Node + Socket.IO relay, Scenario Director,
│                         Classifier Gateway (/api/classify → OpenAI; key in .env)
├─ packages/
│  ├─ engine/             pure TS engine + config.json + golden tests (Vitest)
│  ├─ classifiers/        GptClassifier (client stub), InHouseClassifier (onnxruntime-web), KeywordClassifier
│  └─ shared/             types: Message, CueResult, Case, Alert, GuardianPayload
├─ models/                exported .onnx files + tokenizer/vocab
├─ prompts/               GPT system prompt, few-shot examples, JSON schema
├─ scenarios/             scenario beat sheets + scripted transcripts + cached classifier outputs
└─ training/              Python: GPT pre-labelling, n-gram LR, bert-tiny → ONNX, eval scripts
```

---

## 8. Build order

1. **Engine first:** `packages/engine` with `KeywordClassifier` and the golden test. The scoring logic is proven before any UI exists.
2. **GPT backend:** the Classifier Gateway, prompt, JSON schema and cache. The engine now has a real classifier from day one.
3. **Three screens** with a scripted scenario player (Mode A).
4. **Alert design system:** `Icon3DWarning`, `NudgeCard`, `GuardianBanner`, `CriticalTakeover`, wired to real engine alerts.
5. **Socket relay** plus Mode B live chat.
6. **In-house backend:** n-gram LR first, then bert-tiny. Add the backend switch and fallback.
7. **Comparisons:** the "3 setups" view and GPT vs In-house.
8. **Polish:** shared-layout transitions, sounds, `ReportFlow`, reduced-motion pass, offline demo cache.

### Suggested team split

| Member | Owns |
|---|---|
| 1 | Chat screens + alert design system (§6) |
| 2 | Engine + golden tests + console charts (§2, §6.4) |
| 3 | Server, Classifier Gateway (GPT), Scenario Director (§3.1, §4, §5) |
| 4 | In-house model training + ONNX export + eval (§3.2) |

---

## 9. Open questions

1. **Hackathon rules:** can we bring pre-written code, a pre-trained model or prompts, or must everything be built inside the 24h?
2. **OpenAI API access:** do we have API credits (separate from any ChatGPT subscription), and which model tier fits the budget?
3. **Demo setup:** one laptop showing three windows, or separate devices for predator, victim and guardian?
4. **Default backend for the live demo:** lead with GPT (more reliable on Tanglish) or with In-house (the stronger on-device story)?
