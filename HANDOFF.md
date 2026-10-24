# RAKSHAK: Handoff

**Team Git Happens** (M Sarvesh, Naren K, S Aditya, Mohit Kumar). ChronoForge 2026, NITK Surathkal, Cybersecurity track, theme "Cities of the Future".
Last updated: 2026-10-24.

This file records what exists today, how to run it, how it fits together, and what still has to be built. Read it next to [`Plan.md`](Plan.md), which holds the full architecture, and the Round 1 proposal PDF.

---

## 0. TL;DR

| Area | Status |
|---|---|
| Architecture plan (`Plan.md`) | ✅ Done (v2: polished alert system and two classifier backends) |
| Web UI: landing page, simulation, chats, alerts, console | ✅ Done. Runs on **dummy data** |
| Mode A (scripted AI-vs-AI demo) | 🟡 UI plays a hard-coded 6-day script with **precomputed** analyses |
| Mode B (two humans chat live) | 🟡 UI only. You can type on both phones, but **nothing analyses the messages**, and sync is same-browser only |
| Engine (normalise → classify → score → policy) | ❌ Not started |
| GPT classifier backend + server gateway | ❌ Not started |
| In-house model (n-gram LR → bert-tiny → ONNX) | ❌ Not started |
| Realtime relay server (Socket.IO, rooms) | ❌ Not started |
| Launch video (`/brag`) | ✅ Done: `brag.mp4`, poster, share copy |

**The next big step is the engine.** The UI was built so the engine can plug in without UI changes. See §6.

---

## 1. Repository map

```
Chronoforge/
├─ HANDOFF.md                     ← this file
├─ Plan.md                        ← full architecture (engine, backends, alert system, build order)
├─ RAKSHAK_GitHappens_ChronoForge_Round1_Proposal.pdf
├─ Screenshot 2026-10-23 135552.png   ← alert design inspiration (iOS Time-Sensitive, 3D warning)
└─ rakshak/
   └─ apps/
      └─ web/                     ← the only app that exists so far
         ├─ package.json, vite.config.ts, tsconfig.json, index.html, README.md
         ├─ dist/                 ← an old production build (safe to delete or rebuild)
         ├─ src/                  ← ~5,900 lines (about 3,000 of them CSS)
         └─ brag-output/          ← launch video and its build pipeline
```

`Plan.md` §7 lists the planned folders that **do not exist yet**: `apps/server`, `packages/engine`, `packages/classifiers`, `packages/shared`, `models/`, `prompts/`, `scenarios/`, `training/`.

---

## 2. How to run

```bash
cd rakshak/apps/web
npm install          # first time only
npm run dev          # → http://127.0.0.1:5280
npm run build        # type-check + production build into dist/
```

- **Port 5280** with `strictPort`, bound to 127.0.0.1. Port 5173 is taken by another project on Mohit's machine. If 5280 is busy, the server fails rather than silently moving to another port.
- `vite.config.ts` tells the watcher to ignore `brag-output/**/frames`, `stills`, `chrome-profile` and `*.wav`. Without that, the video capture made Vite reload the page mid-capture.
- The last dev server was stopped by Claude Code because the machine was low on memory. That was not an app bug. Start it again with `npm run dev`.

### Routes (HashRouter)

| URL | What it is |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | Simulation, Mode A (scripted demo) |
| `/#/sim?mode=B` | Simulation, Mode B (live typing) |
| `/#/predator` | Single predator phone (pop-out window) |
| `/#/victim` | Single victim phone (pop-out window) |
| `/#/console` | Engine console / analytics (pop-out window) |

### Keyboard shortcuts on `/sim`

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `→` | Step one message |
| `E` | Open/close the Engine drawer |
| `R` | Reset the demo |

### Multi-window demo

All tabs and windows of the same browser stay in sync over `BroadcastChannel('rakshak-demo')`. A new tab says "hello" and an existing tab replies with a full state snapshot. Settings → *Pop-out windows* opens the predator, victim and console windows, so you can arrange three screens on one laptop or across monitors.

> ⚠️ BroadcastChannel works **only inside one browser on one machine**. Two separate devices (two laptops, or a phone) need the Socket.IO relay. See §7.4.

---

## 3. Tech stack (web)

| Concern | Choice |
|---|---|
| Framework | React 18.3.1 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind v4 (`@tailwindcss/vite`) plus a large hand-written `styles.css` with design tokens |
| Animation | framer-motion 11 |
| State | zustand 5 (one store, reducer-style actions) |
| Icons | lucide-react 0.460 |
| Routing | react-router-dom 6 (HashRouter, so it works from any static host) |
| Sound | WebAudio synth (no audio files) |

---

## 4. What has been built: the UI in detail

### 4.1 Landing page (`src/pages/Landing.tsx`)

Built after the team said the first single-page version felt cluttered. The page now introduces the product, and the simulation lives on its own page.

- **Hero** with a gradient headline and a looping **HeroStory** card. The card cycles through a short grooming escalation (bubble → cue chip → score rises → alert level) every ~4.4 s.
- **Stats** strip.
- **Pipeline** section: normalise → classify → case memory → stage & score → response.
- **Levels** section: L1, L2 and L3 explained with their visuals.
- **Privacy** section covering the on-device story and what leaves the phone (nothing for in-house; only the classify call for GPT).
- **Launch cards** that go to `/sim?mode=A` or `/sim?mode=B`.
- Footer with the team credit.

### 4.2 Simulation page (`src/pages/Simulation.tsx`)

A decluttered stage. By default only the two phones and a floating dock are visible, and everything else is one click away.

- **Top bar:** back to landing, mode label, status.
- **Two phones side by side**, predator ("Kabir") and victim ("Meera"), scaled to fit the viewport by `usePhoneScale`, which sets `--phone-scale`.
- **Caption narration** under the stage explains what is happening at each beat ("Day 3: the contact asks to keep it secret…").
- **Spotlight:** when an alert fires on one phone, the other phone dims so the audience looks at the right place.
- **Floating dock:**
  - Play/pause, step, and a progress bar with markers where alerts fire
  - Live level badge and score
  - Reset
  - **Settings** popover
  - **Engine** button
- **Settings popover:**
  - Mode A/B and classifier backend (GPT / In-house). The backend is cosmetic for now, apart from the latency numbers.
  - Playback speed, the sim clock (day +/−) and the sound toggle
  - **Preview L1 / L2 / L3** buttons, so any alert can be shown on demand. Useful when pitching.
  - Pop-out windows
- **Engine drawer** with two tabs:
  - *Case overview:* the case card (contact, first seen, stage stepper, score ring, cue list) and the score-over-time chart with L1/L2/L3 threshold lines
  - *Message trace:* a per-message debug feed showing the cues and their probabilities, the trace lines (decay, combos, floors), and latency per backend

### 4.3 Chat screens (`src/chat/`)

- `PhoneFrame.tsx`: iPhone shell with dynamic island, status bar and RAKSHAK shield indicator. Takes a `shakeKey` so the phone shakes on L3.
- `ChatScreen.tsx`:
  - iMessage-style glass UI: blue and grey bubbles, day separators, timestamps
  - typing indicator and a composer (live typing in Mode B)
  - auto-scroll inside `requestAnimationFrame`, so it never lags a new bubble
  - extra bottom padding while a nudge card is open, so the nudge never covers the latest message

### 4.4 Alert design system (`src/alerts/`)

Inspired by the screenshot: an iOS "Time Sensitive" banner and a glossy 3D warning.

| Level | Who sees it | Visual |
|---|---|---|
| **L1: Nudge** | Child (victim phone) | `NudgeCard`: calm frosted card ("This conversation has some signs worth a second look"), with Dismiss / Talk to someone / Block options |
| **L2: Guardian alert** | Guardian (Amma) | `GuardianBanner`: iOS Time-Sensitive banner with an amber glossy `Icon3DWarning` triangle. Tapping it opens `AlertSheet`, which shows the stage stepper, cues with day stamps and actions |
| **L3: Critical** | Guardian, full screen | `CriticalTakeover`: dark takeover with a neon red border, hazard stripes, a rotating siren beam, the red pedestal triangle and a phone shake. Actions open `ReportFlow` |

Supporting pieces:
- `primitives.tsx`:
  - `HazardStripe`, `NeonBadge` and `CueChip`
  - `ScoreRing`: animated arc with the text scaled to the ring; the arc is hidden at 0
  - `StageStepper`: Rapport → Secrecy/Isolation → Request → Coercion
- `GuardianPhone.tsx`: the guardian's lock screen. Banners land here, and the clock fades when CRITICAL takes over.
- `ReportFlow.tsx`: multi-step flow to preserve evidence, report (cybercrime.gov.in / 1930 helpline), and block and lock.
- `lib/sounds.ts`: `playChime` for L1/L2 and `playCritical` for the L3 siren, both synthesised with WebAudio.
- Everything respects `prefers-reduced-motion`.

### 4.5 Console (`src/console/`, and `/console` pop-out)

- `Analytics.tsx`:
  - `CaseCard`
  - `ScoreChart`: SVG line of score over sim-days, with threshold bands
  - `DebugFeed`: jumps to the newest entry on mount, then scrolls smoothly
- `Segmented.tsx`: iOS segmented control used across settings.

### 4.6 State and data

- `src/types.ts` defines `Side`, `Mode`, `Backend`, `Level`, `Cue`, `Stage`, `CueHit`, `Analysis`, `ChatMessage` and `AlertItem`. These **mirror the planned `packages/shared`**, so the engine should emit exactly these shapes.
- `src/data/meta.ts` holds the constants: `CUE_META` (label, icon, colour, weight), `STAGES`, `LEVEL_META`, `THRESHOLDS` (2 / 5 / 9), `CUE_ACTIVE_P = 0.5`, `HALF_LIFE_DAYS = 7`, `SCORE_MAX = 12`, plus the demo personas (Kabir `#a3f9`, Meera, guardian Amma).
- `src/data/scenario.ts` holds the six-day grooming script. Four messages carry **hand-computed** analyses (A1–A4) that hit the proposal's golden numbers, **1.0 → 2.9 → 8.4 → 10.9**, giving L0 → L1 → L2 → L3. `PREVIEW_BY_LEVEL` feeds the preview buttons.
- `src/store.ts` is a zustand store with a pure `reduce(state, action)` function:
  - **Actions:**
    - session: `reset`, `setMode`, `setBackend`, `setSound`, `setSpeed`, `setPlaying`, `setCursor`, `setDay`
    - messages: `typing`, `push`, `analyzing`, `analysis`
    - alerts: `preview`, `dismissNudge`, `closeNudge`, `closeBanner`, `openSheet`, `closeSheet`, `closeCritical`, `openReport`, `closeReport`
    - sync: `snapshot`
  - On an `analysis` action, the store updates the score/level/stage/history and, if level ≥ 1, calls `route()`. `route()` sends L1 to the child's nudge, L2 to the guardian banner and L3 to the critical takeover.
  - **Player:** `play`, `pause`, `stepOnce` and `resetDemo` walk the `SCENARIO` with typing delays. A `runToken` cancels stale loops.
  - `sendLive(side, text)` is what Mode B uses. It **only pushes the message**. No analysis happens yet.

---

## 5. Launch video (`/brag`), done

Files in `rakshak/apps/web/brag-output/`:

| File | What |
|---|---|
| `brag.mp4` | 20 s, 1920×1080, 30 fps, H.264 + AAC 192k, ~5.3 MB. Frame 0 is the poster |
| `brag.jpg` | Poster: "Harm builds message by message", four bubbles with cue chips, the 10.9 ring and the L3 badge |
| `share-copy.txt` | Caption ready to post |
| `brag-plan.md` | Creative angle, storyboard and readability check |
| `work/` | The pipeline used to build it (below) |

**Story:** Hook ("one message looks harmless") → Pattern (cues building over six days) → Reveal (score climbs to 10.9) → L1/L2/L3 shown on the real phone components → Outro (RAKSHAK, Team Git Happens).

**Pipeline (`work/`), in case you need to re-render:**
1. `composition/` is a React page that reuses the app's real components and `styles.css`. It exposes `window.__seek(t)`, `__ready` and `__duration = 20`. Each frame is a pure function of `t`: React renders with `flushSync`, and all CSS animations are paused and seeked through `document.getAnimations()`.
2. `capture.mjs` drives headless Chrome over raw CDP (no npm deps; uses Node's global WebSocket) and screenshots 600 JPEG frames into `frames/`.
3. `soundtrack.py` (numpy) synthesises the music: 96 BPM, D minor, 20 s, 48 kHz, about −14.8 LUFS. Visual events are snapped to the 16th-note grid.
4. ffmpeg (installed via scoop) muxes the frames and the WAV into `brag.mp4`.

**Cleanup:** `work/frames/` (~72 MB) and `work/chrome-profile/` (~74 MB) are throwaway. Delete them before zipping or committing. Add `brag-output/work/frames`, `brag-output/work/chrome-profile` and `*.wav` to `.gitignore`.

The soundtrack was checked by measurement only (loudness, peaks); nobody has listened to it critically. Give it one listen before posting.

---

## 6. How the engine plugs into the existing UI

The UI already consumes the engine's output format. The integration contract:

```ts
// What the engine must produce for each message (already defined in src/types.ts)
interface Analysis {
  cues: { cue: Cue; p: number }[];   // classifier output, p in [0,1]; ≥ 0.5 counts as active
  score: number;                     // case score after decay, combos, floors, reductions
  level: 0 | 1 | 2 | 3;
  stage: 'rapport' | 'secrecy_isolation' | 'request' | 'coercion';
  trace: string[];                   // human-readable lines shown in the Message trace tab
  latency: { gpt: number; inhouse: number };
  alert?: { guardianTitle: string; guardianBody: string };
}
```

**Integration points:**
1. **Mode A:** in `store.ts` → `runStep()`, replace `step.analysis` (precomputed) with `await engine.analyze(message, caseState)`. Keep the precomputed values as the **golden test expectations**.
2. **Mode B:** in `sendLive()`, after `push`, dispatch `analyzing`, call the engine, then dispatch `{ type: 'analysis', id, analysis }`. Everything downstream (routing, alerts, charts, trace) already works.
3. **Backend switch:** `data.backend` (`'gpt' | 'inhouse'`) is already in the store and in Settings. The engine should pick its classifier from it.
4. **Sim clock:** `data.simDay` already exists (Settings → sim clock). Decay and the 14-day new-contact floor should use it, not wall time.

---

## 7. What is pending

Ordered roughly by priority. Section numbers point to `Plan.md`.

### 7.1 Engine core: `packages/engine` (HIGHEST PRIORITY)

A pure TypeScript package with no UI dependency, unit-tested with Vitest.

- [ ] **Normaliser:** lowercase, leetspeak (`s3cr3t → secret`), repeated-char squash, emoji → tokens (🤫 → secret), Tanglish transliteration and common spellings (e.g. "yaarukum sollatha" → don't tell anyone). Tamil-script handling.
- [ ] **Classifier interface:** `classify(text, context) → CueHit[]`, with implementations behind it (7.2, 7.3, plus a keyword baseline).
- [ ] **KeywordClassifier:** a regex/lexicon baseline. Build it first so the scoring can be tested before any ML exists.
- [ ] **Case memory:** per contact. Holds the first-seen date, the cue history with days, the current score, stage, and dismissals. Encrypted at rest (WebCrypto AES-GCM in IndexedDB) for the on-device story.
- [ ] **Scoring (all values in `config.json`):**
  - weights: flattery/age 1, secrecy 2, isolation 2, platform move 2, image request 3, meeting request 3, disable protection 4, threat/payment 4, insult/harassment 1
  - decay: `score × 0.5^(Δdays/7)`
  - combo: secrecy/isolation followed by an image or meeting request → ×2
  - thresholds: 2 → L1, 5 → L2, 9 → L3
  - floors: threat/payment → L3; a request from a contact first seen under 14 days ago → L2; disable-protection → L2
  - reductions: quote/counterspeech ×0.3; dismissal ×0.5, but never below L1 and never at the Request/Coercion stage
  - bullying: harassment scores summed across senders
  - linked contacts: a new contact within 24 h of a block inherits the case
- [ ] **Stage inference:** the four-stage model from the active cues.
- [ ] **Response policy:** level → who is alerted, and what the guardian sees (`guardianTitle` / `guardianBody`). Guardians get a **summary, never the raw chat text**: a privacy promise from the proposal.
- [ ] **Trace output:** human-readable lines for the debug feed.
- [ ] **Golden test:** the six-day scenario must produce **1.0 → 2.9 → 8.4 → 10.9** and L0 → L1 → L2 → L3. Add tests for decay, each floor, each reduction, combos, bullying sums and linked contacts.
- [ ] Wire the engine into `store.ts` (§6) and delete the hard-coded analyses from the runtime path.

### 7.2 GPT classifier backend (§3.1)

- [ ] **Decide:** do we have **OpenAI API credits**? A ChatGPT Plus/Pro subscription does **not** include API access. Without credits, lead with the in-house model.
- [ ] `apps/server`: a small Node (Express/Fastify) **Classifier Gateway** at `POST /api/classify`. The API key lives in `.env` on the server, never in the browser.
- [ ] Prompt (`prompts/`): a system prompt with the cue definitions, Tanglish few-shot examples and hard negatives.
- [ ] **Structured outputs**, a JSON schema returning `{ cue, p }[]`, at temperature 0.
- [ ] Response cache keyed by normalised text, so demos are repeatable and work offline.
- [ ] Timeout plus fallback to the in-house or keyword classifier. Report the real measured latency in `Analysis.latency.gpt`.
- [ ] Note: only the classifier is GPT. **Scoring stays deterministic** in the engine.

### 7.3 In-house model (§3.2)

- [ ] `training/`: build a labelled dataset. Combine GPT pre-labelling (if there are credits), hand-written Tanglish examples and hard negatives (surprise party, banter, quoting the news).
- [ ] Stage 1: **char n-gram + logistic regression**, multi-label. Fast, tiny, robust to misspellings. Export it as JSON weights or ONNX.
- [ ] Stage 2: **bert-tiny** fine-tune → ONNX. Stage 3 (stretch): IndicBERT for Tamil/Tanglish.
- [ ] `packages/classifiers/InHouseClassifier`: run the model in the browser with **onnxruntime-web** (WASM). Store the files in `models/`.
- [ ] Eval script: per-cue precision/recall on a held-out set, plus a comparison table against GPT and keywords for the pitch.

### 7.4 Realtime relay server and Mode B across devices (§5)

- [ ] `apps/server`: **Socket.IO** relay with **rooms by code**, so two laptops or phones can join one chat.
- [ ] A "Join room" screen in the web app. Replace the BroadcastChannel sync with sockets when a room is active, and keep BroadcastChannel for the single-laptop demo.
- [ ] The engine runs on the **victim client**. With GPT, only the classify call goes to the server.
- [ ] The sim-clock "+1 day" control must drive decay in Mode B too.

### 7.5 Mode A done properly (§4)

- [ ] **Scenario Director:** scenario files made of beats `{ stage, cueIntent, simDay, speaker }` in `scenarios/`.
- [ ] More scenarios (currently only the six-day grooming one exists):
  - [ ] Sextortion ring replayed from rotating accounts (tests linked contacts and the threat floor)
  - [ ] Multi-sender bullying pile-on (tests the harassment sum)
  - [ ] Platform-move / cross-app case
  - [ ] Hard negatives: surprise-party secret, friend banter, quoting the news (**must stay L0**)
  - [ ] Adversarial: misspellings, leetspeak, emoji, Tamil script
- [ ] A scenario picker in Settings.
- [ ] GPT voices the **victim** replies and paraphrased variants. Predator lines stay **hand-scripted**, because models refuse that role and scripts are safe and deterministic on stage.
- [ ] Offline fallback: pre-recorded runs with cached classifier outputs, in case the venue Wi-Fi fails.

### 7.6 UI follow-ups (after the engine lands)

- [ ] Switching the backend should visibly change real latency and confidence values. "GPT vs In-house" comparison view (Plan §8, step 7).
- [ ] "3 setups" view: keyword vs GPT vs in-house on the same message.
- [ ] Loading/"analysing…" state when the classifier is slow (the `analyzing` action exists, but the visuals only exist for the scripted delay).
- [ ] Error states: gateway down, model failed to load.
- [ ] A mobile layout pass for the single-phone routes on a real phone (needed once Mode B is cross-device).
- [ ] Accessibility pass: focus order in the sheets and takeover, and screen-reader labels on alerts.
- [ ] Optional: a vertical (9:16) cut of the launch video for Instagram/WhatsApp status.

### 7.7 Housekeeping

- [ ] `git init` at `rakshak/`. **The project is not under version control yet.** Add a `.gitignore` covering `node_modules`, `dist`, `brag-output/work/frames`, `brag-output/work/chrome-profile` and `*.wav`.
- [ ] Turn `rakshak/` into an npm workspace when `packages/*` and `apps/server` arrive.
- [ ] Delete the stale `apps/web/dist/` or rebuild it.

---

## 8. Open questions (decide as a team)

1. **Hackathon rules:** can we bring pre-written code, pre-trained models and prompts, or must everything be built during the event? This decides whether the existing UI counts and whether the model can be trained in advance.
2. **OpenAI API credits:** do we have them, and how much? This decides whether the GPT backend is real or a stretch goal.
3. **Demo setup:** one laptop with three windows (works today), or separate devices for predator, victim and guardian (needs §7.4)?
4. **Default backend on stage:** GPT (better on Tanglish) or in-house (the stronger on-device privacy story)? Suggestion: **in-house by default, with GPT as a toggle**. That leads with privacy and still shows the accuracy comparison.

---

## 9. Suggested next steps and owners

Following the team split in Plan §8:

| Member | Next task |
|---|---|
| 1 (UI) | §7.6 follow-ups; scenario picker; analysing/error states once the engine API is fixed |
| 2 (Engine) | **§7.1 engine + golden test**, then wire it into `store.ts` |
| 3 (Server) | §7.2 Classifier Gateway + prompt/schema/cache; §7.4 Socket.IO rooms |
| 4 (Model) | §7.3 dataset → n-gram LR → bert-tiny ONNX → eval table |

**Order:** engine with KeywordClassifier and the golden test → wire it into the UI → in-house n-gram model → GPT gateway (if there are credits) → Socket.IO Mode B → more scenarios → comparisons and polish.

---

## 10. Gotchas learned so far

- Port 5173 is someone else's app on this machine. Use **5280**.
- Anything that writes lots of files inside `apps/web/` (Chrome profiles, frame dumps) triggers Vite reloads unless it is added to `server.watch.ignored`.
- A full HMR reload resets the demo state. That is expected, not a bug.
- Chat auto-scroll must run inside `requestAnimationFrame`, after the new bubble is laid out.
- Phones are scaled with the `--phone-scale` CSS variable. Don't hard-code pixel sizes in phone content.
- CRITICAL content needs about 62 px of top padding to clear the dynamic island.
- If the machine runs low on memory, Claude Code may kill the dev server. Restart it with `npm run dev`.
