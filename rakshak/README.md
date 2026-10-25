# RAKSHAK

Context-aware cyberbullying and child-safety prototype by **Team Git Happens** for ChronoForge 2026, NITK Surathkal.

RAKSHAK reads a child's chats as **conversations**, not isolated messages. It remembers evidence across days and across
different chats, attributes it to senders and targets, and turns it into an explainable risk level (L1 child nudge,
L2 guardian alert, L3 critical) using a deterministic engine. The models label evidence; our code decides.

> **What this is, honestly.** A hackathon prototype running on a laptop with synthetic conversations. The RoBERTa and
> Qwen weights are third-party pretrained models. RAKSHAK's own work is the hybrid pipeline: context retrieval,
> verification, fusion, case memory, scoring and the response policy. Findings are *potential safeguarding concerns*,
> never proof of an offence. Thresholds are prototype heuristics, not validated probabilities. This is not yet a
> production on-device mobile app.

**What is in this version**

- **Web demo** (laptop): three modes. *A · Guided Demo* plays scripted examples and two real-world case studies through
  the live pipeline; *B · Continue the Conversation* loads an earlier chat up to a checkpoint, analyses it, then you type
  the next messages; *C · Free Chat* starts from nothing. The Studio panel picks the case, the engine drawer shows the
  evidence, trace and models, and the guardian's **Get help** guides understanding, support, a redacted evidence report
  and complaint options.
- **Android app** (phones): one app, one role per phone. Meera's messenger protected by RAKSHAK (private nudges,
  *Pause before you send* on photos, SOS), Kabir's plain messenger, and **RAKSHAK Guardian** for Amma (lock screen,
  real Android notifications, alerts, report, Get help, temporary guardians by QR). The phones connect to the laptop by
  QR code; the guardian's phone only ever receives alert summaries, never the chat.
- **Inference service** (laptop): RoBERTa + Qwen3.5 4B with verification, fusion, a confirmation gate and case memory.
  Without Ollama it falls back to clearly labelled keyword rules, so the demo still runs on a laptop without a GPU.

---

## 0. Team setup (start here)

Do this once on the laptop that will run the demo (Windows, ideally the one with the NVIDIA GPU).

**1. Install the tools** (skip what you already have):

| Tool | Get it | Check |
|---|---|---|
| Git | `winget install Git.Git` | `git --version` |
| Node.js 22 or newer | `winget install OpenJS.NodeJS.LTS` | `node -v` |
| Python 3.12 | `winget install Python.Python.3.12` | `py -3.12 --version` |
| Ollama | `winget install Ollama.Ollama` | `ollama -v` |

Close and reopen the terminal after installing so the new commands are found.

**2. Get the code.**

*First time on this laptop:*

```powershell
cd $HOME\Documents
git clone https://github.com/S-Aditya-72/Rakshak.git
cd Rakshak\rakshak
```

*Already have a copy:* the new version contains everything from the folder you shared, including the changes you had
not committed yet, so set your local changes aside and pull:

```powershell
cd path\to\Rakshak
git stash -u          # puts your uncommitted changes aside (they are already in the new version)
git checkout master
git pull
git stash drop        # throw away the set-aside copy
cd rakshak
```

If you changed files after sharing the folder, use `git stash pop` instead of `git stash drop` to get them back on top
of the new version. If `git pull` still complains, the simplest fix is a fresh copy: rename your old `Rakshak` folder
and use the *first time* commands above.

**3. Install the dependencies** (inside `rakshak/`, ~10 minutes, needs internet):

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/setup-server.ps1    # Python venv, CPU torch, RoBERTa weights
ollama pull qwen3.5:4b                                               # ~3.3 GB
```

**4. Run it** (two terminals, both inside `rakshak/`; keep them open):

```powershell
npm run server:lan     # terminal 1: inference service + phone relay (prints the laptop's address and an access code)
npm run dev            # terminal 2: web UI on http://127.0.0.1:5280
```

The Ollama app must be running (or run `ollama serve` in a third terminal). The first time, Windows Firewall asks about
Python: allow **Private networks**. Then open **http://127.0.0.1:5280** (web demo) or
**http://127.0.0.1:5280/#/engine** (projector view for the phone demo). The status pill at the top right says whether
RoBERTa and Qwen are ready.

*On a laptop without Ollama/GPU* use the rules fallback and skip the RoBERTa download time (Command Prompt syntax):

```bat
set RAKSHAK_ROBERTA_ENABLED=0
set RAKSHAK_WARMUP=0
npm run server:lan
```

(In PowerShell: `$env:RAKSHAK_ROBERTA_ENABLED="0"; $env:RAKSHAK_WARMUP="0"; npm run server:lan`.)

**5. The phones** (optional, for the real-phone demo; details in [MOBILE.md](MOBILE.md)):

1. Download [`apk/RAKSHAK-debug.apk`](apk/RAKSHAK-debug.apk) from GitHub on each phone (or copy it over) and install it.
   If Android refuses to update an older RAKSHAK, uninstall that one first. Every phone needs this same APK.
2. Put the laptop and all phones on the **same Wi-Fi, or a phone hotspot** (college Wi-Fi often blocks devices from
   seeing each other).
3. Laptop: open `/#/engine` → **Connect phones**. Each phone: RAKSHAK → **Scan QR code** → choose Meera, Kabir or Amma.
4. Laptop: **C · Free Chat** → Studio → *Start new conversation*, then type on Kabir's phone. Meera gets nudges, Amma
   gets notifications.

**Phones somewhere else** (teammates in another city): install `cloudflared` once
(`winget install Cloudflare.cloudflared`) and start the server with `npm run server:remote` instead. Connect phones
then shows an *Over the internet* QR code that works from anywhere; scan it off a shared screen. Details:
[MOBILE.md → Phones in another city](MOBILE.md#phones-in-another-city-over-the-internet).

**6. After pulling new code later:** run `npm install` again, restart both terminals, and reinstall the APK on the
phones if `apk/RAKSHAK-debug.apk` changed. Rebuilding the APK yourself (`npm run apk`) needs Android Studio and is only
needed after changing the web code.

## 1. Architecture

```
 web UI (React, Vite :5280)  ──/api──▶  inference service (FastAPI :8787, 127.0.0.1)
   phones · alerts · console              │
   ▲ deterministic engine (TS)            ├─ SQLite case memory (data/rakshak.sqlite3)
   │ computeRisk(evidence) → level        ├─ context retrieval (conversation + cross-chat evidence)
   └─ alerts (de-duplicated)              ├─ RoBERTa (CPU)  ─┐
                                          ├─ Qwen3.5 4B via Ollama (GPU) ─┼─ verify ─ fusion ─ evidence
                                          └─ ChatGPT via SIWC companion (:8788, owner-initiated only)
```

| Piece | Where | What it does |
|---|---|---|
| Shared contract | `packages/shared` | Versioned analysis schema `rakshak.analysis.v1`, TS types + zod runtime validation (mirrored in `apps/server/rakshak_server/contract.py`) |
| Deterministic engine | `packages/engine` | Pure function `computeRisk(evidence) → tracks, score, level, stage, trace`. Config in `packages/engine/config.json` |
| Inference service | `apps/server` | Memory, context, RoBERTa, Qwen, verification, fusion, reconciliation, APIs |
| SIWC companion | `apps/siwc-companion` | Sign in with ChatGPT via the official `@siwc/local` SDK; holds tokens; localhost only |
| Prompts | `prompts/` | `analysis_system.v2.md` (Qwen + ChatGPT), `verify_findings.v2.md` (v1 kept for comparison) |
| Scenarios | `scenarios/` | 5 demo test cases + `scenarios/eval/` extra fixtures, with `expect` blocks used only by the evaluator |
| Web UI | `apps/web` | Existing design, now wired to real analysis |
| Android app | `apps/web/android` | Capacitor app, one role per phone: Meera's protected messenger, Kabir's plain messenger, RAKSHAK Guardian (alerts, report, temporary guardians, Android notifications). QR setup. See [MOBILE.md](MOBILE.md) |
| Device sync | `/api/sync` | WebSocket relay between the laptop and the phones. Guardian phones only receive alert summaries; the relay drops any guardian-bound frame carrying chat content (`apps/server/rakshak_server/relay.py`, `apps/web/src/lib/sync.ts`) |
| Temporary guardians | `/api/guardians/*` | Time-limited invite codes (QR from the guardian's phone), scope all/critical, revocable; expiry enforced by the server |

### What is ours and what is not

| Third-party (used as-is) | RAKSHAK (built here) |
|---|---|
| `nayan90k/roberta-finetuned-cyberbullying-detection` (binary: LABEL_0 not bullying, LABEL_1 bullying) | Context selection and cross-chat memory |
| `qwen3.5:4b` (Ollama, Q4_K_M) | Schema-constrained prompting, ID aliasing, output validation |
| ChatGPT models via Sign in with ChatGPT (owner's plan) | Verification pass, hybrid fusion, evidence identity and reconciliation |
| | Deterministic scoring, tracks, floors, decay, alert de-duplication, guardian summaries |

## 2. Install

**Prerequisites:** Node.js ≥ 22.12, Python 3.12 (or [uv](https://docs.astral.sh/uv/)), [Ollama](https://ollama.com) ≥ 0.40, ~6 GB free disk.

### Windows (tested: RTX 5060 Laptop 8 GB, Windows 11)

```powershell
cd rakshak
npm install                                                     # web, engine, shared
powershell -ExecutionPolicy Bypass -File scripts/setup-server.ps1   # Python venv, CPU torch, RoBERTa weights
winget install Ollama.Ollama                                    # if not installed
ollama pull qwen3.5:4b                                          # ~3.3 GB
```

### macOS (MacBook Air M4 16 GB: expected to work, **not tested by us**)

```bash
cd rakshak
npm install
bash scripts/setup-server.sh            # Python venv, torch (MPS-capable), RoBERTa weights
brew install ollama                     # or the app from ollama.com
ollama pull qwen3.5:4b
```

After these downloads the local hybrid backend works **offline** (`npm run server` sets `HF_HUB_OFFLINE=1`;
set `RAKSHAK_ALLOW_DOWNLOAD=1` to let it fetch model files again).

### What stays out of git

Everything the steps above generate is git-ignored and is recreated by them, never committed:

| Path | Created by |
|---|---|
| `node_modules/` (any level), `dist/` | `npm install`, `npm run build` |
| `apps/server/.venv/`, `__pycache__/`, `.pytest_cache/` | `setup-server.*`, running the service and tests |
| `data/` | the service and companion at runtime: SQLite case memory, encrypted SIWC credentials, companion secret |
| `vendor/` | `npm run setup:siwc` (third-party DevKit) |
| `eval/reports/20*.{json,md}` | `npm run eval` (only `latest.*` is kept) |
| `apps/web/brag-output/work/{frames,stills,chrome-profile}/`, `*.wav` | launch video build |

The repository root `.gitignore` also excludes `.env` / `.env.*` (except `.env.example`), shell profiles (`.bashrc`,
`.zshrc`, `.profile`, …), `.prompt` files, logs, `.vscode/`, `.idea/` and `.claude/settings.local.json`.
`CLAUDE.md` and Claude Code plans are tracked on purpose.

## 3. Run

Three processes (plus one optional):

```bash
ollama serve                 # if the Ollama app is not already running
npm run server               # inference service on 127.0.0.1:8787 (loads RoBERTa once, warms Qwen)
npm run dev                  # web UI on http://127.0.0.1:5280
npm run companion            # optional: ChatGPT backend (see §6)
```

**Phones / the Android app:** run `npm run server:lan` instead of `npm run server` (or `npm run server:remote` for
phones on other networks: the same plus a Cloudflare quick tunnel, see [MOBILE.md](MOBILE.md)). It listens on the network and
prints the server address(es) and an access code (saved in `data/access-token`, so it survives restarts). The easiest
way to give both to a phone is the QR code under **Connect phones** on `/#/engine` (the app also accepts them typed in).
Requests from this laptop never need the code; requests from anywhere else (Wi-Fi, or a
`cloudflared tunnel --url http://127.0.0.1:8787` link) must send it, and are refused when no code is set. The ChatGPT
backend stays usable only from the laptop itself. On Windows, allow Python through the firewall for Private networks the
first time.

Open `http://127.0.0.1:5280`. The status pill (top right of the simulation) shows real model status; click it to refresh.

| Route | |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | **A · Guided Demo**: Studio panel → pick a core example or case study → Play |
| `/#/sim?mode=B` | **B · Continue the Conversation**: Studio panel → pick a conversation and checkpoint → *Load history and continue* |
| `/#/sim?mode=C` | **C · Free Chat**: Studio panel → *Start new conversation*; type on either phone, ✎ creates private or group chats |
| `/#/predator`, `/#/victim` | Pop-out single phones (other participants / the child) |
| `/#/console` | Pop-out guardian phone + engine panels (stays in sync) |
| `/#/engine` | Projector view for the real-phone demo: engine panels + devices (what each phone received) + Connect-phones QR |
| `/#/app`, `/#/m/child`, `/#/m/contact`, `/#/m/guardian`, `/#/m/temp` | The Android app's screens (setup, then one role per phone); they also open in a phone browser |

Shortcuts: `Space` play/pause · `→` step · `S` Studio panel · `E` engine drawer · `R` reset (restarts the current case
from its own starting point and clears its server memory). Switching modes, or a `?mode=` in the URL, never resets the case.

### 3.1 Troubleshooting

- **`Failed to resolve import "@rakshak/engine"` (or `@rakshak/shared`).** The workspace links in
  `node_modules/@rakshak/` are broken. This happens when the project is copied or unzipped with `node_modules/`
  included: npm links workspaces with symlinks (junctions on Windows), and most zip tools store them as empty folders.
  Delete `node_modules/@rakshak/` and run `npm install` again, then restart `npm run dev`.
- **`Port 5280 is already in use` / `[Errno 10048] … 8787`.** Another copy of RAKSHAK (or an earlier run) is still
  listening. Stop it (Windows: `Get-NetTCPConnection -LocalPort 5280 -State Listen` gives the process ID), or run this
  copy on other ports:

  ```bash
  RAKSHAK_PORT=8797 npm run server
  cd apps/web && RAKSHAK_API=http://127.0.0.1:8797 npx vite --port 5290
  ```

  (`npm run dev -- --port …` does not work: the root script calls a workspace script, which drops the flag.)

## 4. Using it

- **Backend selector** (Settings → Analysis backend): *Hybrid · Local* or *ChatGPT · Cloud*. Each backend keeps its own
  evidence for the same chats, so you can compare them. Switching changes real inference, not cosmetics.
- **Modes and cases.** The header shows the selected mode (A/B/C) and, separately, the current case and how it started
  (*Scripted playback*, *Continued from history*, *Fresh conversation*, or the precomputed *Presentation preview*).
  Changing mode is navigation only; loading a scenario, loading a history, starting a new conversation and reset are the
  only actions that replace a case. A refresh restores the server's case.
- **A · Guided Demo** plays scripted messages but every verdict comes from the live pipeline. Expect each analysed message
  to take ~3–8 s on the RTX 5060. *Presentation preview (offline)* replays the old precomputed six-day script and is
  labelled "not live AI" everywhere it appears. Paused playback can be continued live (*Continue live from here*): the
  case is kept exactly as played and script lines after that point are never sent.
- **B · Continue the Conversation** loads a scenario's earlier messages up to a checkpoint (same IDs, people, chats,
  days), analyses them in day-by-chat batches with the local models, then lets anyone type the next messages. Alerts
  found in the history are recorded and listed ("from earlier history"), not popped up; the Studio panel shows the
  baseline. With ChatGPT · Cloud selected, the history is loaded but not analysed until the owner presses Analyze.
  Presenter ideas in the panel are never sent to a model.
- **C · Free Chat** starts a new case with no history. Pick who types on the left phone (sender picker in group chats),
  create chats, use Settings → Sim clock `+1 day` to test multi-day memory and decay.
- **Reassessment.** With the local backend every saved live message, including the child's own objections, triggers a
  contextual reassessment (bursts are coalesced on the server). ChatGPT never runs automatically.
- **Case studies** (Amanda Todd, Jordan DeMay): the real case's name, one sourced sentence, a visible "Fictional
  reconstruction of the incident" label, *Play reconstruction* and *Continue live* (checkpoints; later messages are a
  hypothetical continuation). Playback pauses once at the first real guardian alert ("An opportunity to intervene") and
  links to Get help. Background, attribution and sources are in a collapsed section. The models see neutral names, never
  the real ones, and the real cases' outcomes are never given to a model.
- **Get help** (guardian, from L2/L3 alerts): understand the concern (recorded messages, AI interpretations and the
  deterministic level shown separately), support the child, review evidence and export a redacted HTML/JSON report, and
  complaint options (standard complaint, anonymous-reporting eligibility, official portal). Nothing is submitted or sent;
  blocks only affect the demo. On the guardian's Android phone Get help works from the alert summary only: evidence
  review and the report stay on the laptop (see [MOBILE.md](MOBILE.md)).
- **Phones.** With the Android app connected, the laptop's mode and case drive the phones: they follow a new case or a
  loaded history, type in B and C, and Amma's phone raises real notifications (not for alerts found in history; a
  withdrawn alert gets a calm update).
- **Engine drawer** tabs: *Case* (score ring, tracks, chart), *Evidence* (case memory grouped by chat, with model
  provenance, status and target), *Trace* (per message: RoBERTa score, Qwen verdict, fusion agreement, rule trace,
  measured latency, and the context the model was given: messages, approximate tokens, truncation, related findings),
  *Models* (live model status and the full validated output of the latest run). Clicking a cue in the trace opens its
  evidence row. The ↻ button re-analyses every chat; unchanged evidence never inflates the score.

### 4.1 Rehearsal (all with the local backend)

1. **A, scripted:** Studio → *Cyberbullying* → Play. Pause midway → *Continue live from message N* → type as Dev.
2. **B, friendly history:** Studio → *Friendly banter* → checkpoint *Day 2 · Meera has just set a boundary* → *Load history
   and continue* → wait for "History analysed" → type as Riya: "oh ok, fair! sorry". Then try ignoring the boundary.
3. **B, concerning history:** *Cyberbullying* → *Meera has asked Dev to stop* → type an escalation as Dev, then an
   objection on Meera's phone (the child's message is reassessed too).
4. **C, fresh:** *Start new conversation* → type anything on either phone; ✎ for a group chat.
5. **Guardian help:** open an L2/L3 alert on the guardian phone → *Get help* → *Evidence & report* → *Open evidence review*
   → untick/edit/redact → download HTML and JSON. Check the preview shows "Not submitted" and no child name.
6. **Case studies:** Studio → *Case study* on each card → read sections 1–6 → *Load in Guided Demo* (A) or *Continue live
   from here* (B). History setup takes ~5 s per batch.

Scripted runs are synthetic demonstrations, not evidence of accuracy; the same input can land on a different level
between runs (§9).

## 5. How the pipeline works

**Context (per analysis).** The active conversation oldest-first, always including the new (focus) messages and every
message that already carries evidence, then filling newest-first to a token budget (`RAKSHAK_CONTEXT_TOKEN_BUDGET`,
default 11000 within a 16384 context, so in practice the whole chat is sent; only chats over ~30k characters drop old
plain messages, and that is reported). Plus prior findings for the chat and up to 12 evidence items from the child's
*other* chats. Message IDs are aliased (`m01…`) and the output schema enumerates only those IDs and the chat's
participants, so Qwen cannot cite messages or people that are not there. Transcript text is wrapped as untrusted data.

**Models.** RoBERTa scores each focus message (raw softmax, shown as such). Qwen reads the whole context and first writes a
`conversation_reading` (who the participants are to each other, the topic, what the new messages refer to), then
findings `{message, context_basis, cue, target, modifier (none/banter/quoted/counterspeech), confidence (low/medium/high)}`,
patterns, retractions and an assessment (harmless / concerning / harmful / uncertain). The schema orders these fields so
the model states context before any verdict. The verification pass gets the same whole transcript, and any finding the
model's own whole-chat assessment contradicts is dropped or left pending (it cannot raise an alert on its own). Qwen never sees RoBERTa's output and is
never gated on it. Settings: temperature 0, top_k 1, fixed seed, `think:false`, structured output, `keep_alive 30m`,
one request at a time on the GPU.

**Verification.** New findings that RoBERTa does not corroborate get a second Qwen pass over the same whole transcript:
"does this message, in this chat, show <cue definition>?" Unsupported claims are dropped (listed in the run's warnings),
unclear ones stay pending. This was added after real runs showed the 4B model labelling a supportive friend or "how was
school today?" as harmful.

**Confirmation gate.** Only confirmed evidence is *active* (scored, can raise alerts); everything else is *needs review*
(pending: recorded and shown, never scored). A harmful reading is confirmed only if the whole-chat assessment is
concerning or harmful, verification did not answer "unclear", a request cue (photo, meeting, personal info) is resolved
as being about the child, and the finding is high-confidence, corroborated by RoBERTa, or still held after later
messages. The rules fallback reports its phrase matches at high confidence, so it passes the same gate.

**Fusion** (`apps/server/rakshak_server/fusion.py`):

| Situation | Result |
|---|---|
| Qwen flags bullying, RoBERTa ≥ 0.5 | `agree`, strength = max of both, one evidence row |
| Qwen flags harm, RoBERTa < 0.5 (or a grooming cue, outside RoBERTa's scope) | `contextual_only`, active |
| RoBERTa ≥ 0.5, context says banter/quote/counterspeech or the chat is harmless | `context_override`, recorded but not scored |
| RoBERTa ≥ 0.5, Qwen silent | `needs_review` (model disagreement), pending: not scored |
| Qwen unavailable | rules fallback (labelled), or with it off RoBERTa-only `needs_review` evidence, run marked degraded |
| Serious label inside a run Qwen itself called harmless | dropped (`context_override`) |
| Medium/low confidence, no corroboration yet | `needs_review` until a later reading still supports it |

**Memory and reconciliation.** SQLite tables: protected_children, participants, conversations,
conversation_participants, messages, evidence_events, cases, risk_snapshots, analysis_runs, alerts (+ dismissals,
blocks). Evidence identity = `backend|conversation|message|cue|target`, so re-analysis updates rows in place. Evidence on
the focus messages that a new run does not reproduce is marked *superseded*; older evidence changes only on an explicit
model retraction. Accounts are never merged on similarity; a brand-new contact right after a block is *flagged for
review*, not merged.

**Staleness.** Local runs are serialised; queued requests for the same chat are coalesced; a run is applied only if the
case was not reset meanwhile (generation counter) and no newer run for that chat was applied (watermark). The browser
also drops results from before a reset, scenario switch or backend switch.

**Engine** (`packages/engine`, config in `config.json`). Weights: flattery 1, secrecy 2, isolation 2, platform move 2,
manipulation 1, personal-info request 2, image/meeting request 3, disable protection 4, threat/coercion 4, insult 1,
humiliation 1.5, exclusion 1, intimidation 3. Decay half-life 7 days. Secrecy/isolation → image/meeting request ×2.
Thresholds L1 2, L2 5, L3 9. Floors: threat/coercion → L3; disable protection → L2; image/meeting request from a contact
first seen < 14 days → L2; intimidation → L2. Reductions: quote/counterspeech ×0.3, banter ×0.1 (only for insult,
humiliation, exclusion; never threats or grooming cues), needs-review evidence not scored, dismissal ×0.5 (never below L1, never at
request/coercion stage). Grooming is scored per contact; bullying is one child-level track summed across senders and
chats, with bonuses for pile-ons (3 senders in 7 days +2), cross-chat targeting (2 chats in 7 days +1) and repetition
(3 cues from one sender +1). Bullying without a threat is capped at L2 (parent + counsellor route). The child's own
messages and harm aimed at other participants never count towards the child's score. Alerts fire once per level rise
per track; unchanged evidence never re-fires them. The guardian sees cue types, counts and days, never message text.

## 6. ChatGPT backend (Sign in with ChatGPT)

Uses OpenAI's official open-source DevKit SDK `@siwc/local`, unmodified, in a localhost companion process:
dynamic client registration, persistent host ID (`sendHostId: true`), OAuth PKCE + state + nonce on a `127.0.0.1`
loopback, ID-token verification, `chatgpt.tokens.use.direct` scope check, refresh, account-specific model discovery
(`GET /v1/models`), and Responses API calls with `store:false`, `stream:true`, success only on `response.completed`.

```bash
npm run setup:siwc             # clones the DevKit at a pinned commit into vendor/, builds @siwc/local
npm run companion              # 127.0.0.1:8788
```

Then in the UI: Settings → backend *ChatGPT · Cloud* → **Continue with ChatGPT** (your browser opens) → pick a
discovered model → tick the cloud-processing disclosure → press **Analyze with ChatGPT** in the dock.

Safeguards, from the [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/):
- Requests run only from the owner's explicit button (`trigger: owner_button`) after consent. Typing in Modes B and C never calls
  ChatGPT, so another person's activity cannot trigger requests on the owner's plan (Terms §2).
- Tokens stay in the companion's OS-encrypted store (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The
  companion refuses requests without its per-launch secret and any request carrying a browser `Origin`. It accepts only
  RAKSHAK transcript payloads, always with RAKSHAK's own instructions, so it is not a general API proxy.
- No API keys, passwords, cookies, ChatGPT web endpoints or Codex credentials are used.
- Usage-limit (`subscription_sharing_usage_limit_exceeded`), eligibility and sign-in errors are surfaced as such;
  nothing is ever fabricated when the cloud is unavailable.

> **Compliance blocker to resolve before any real use.** The Terms prohibit apps that "include any … surveillance …
> code or programs" and require that another user's activity must not trigger requests. A product that monitors a real
> child's chats through a parent's ChatGPT plan would very likely conflict with both. We therefore limit the ChatGPT
> backend to **owner-initiated analysis of synthetic demo conversations** in this prototype, and it is off unless the
> owner signs in and consents. Confirm with OpenAI before relying on it; the local hybrid backend does not depend on it.
> The DevKit is under OpenAI's *Noncommercial* licence.

**Status of verification:** the companion builds, starts, protects its key with DPAPI, enforces its access rules, and
reports `disconnected` correctly. **A real sign-in and a real ChatGPT inference have not been tested by us** (that
needs the owner's account in a browser).

## 7. Tests and evaluation

```bash
npm test                 # engine + contract (Vitest): golden 1.0 → 2.9 → 8.4 → 10.9 with fixed cues, rules, dedup
npm run test:server      # Python: fusion, memory, staleness, validation, failure modes (fake models, no GPU)
npm run eval             # real models over all scenarios → eval/reports/latest.md   (server + Ollama running)
npm run e2e -- scenario s4-crosschat     # drives the real UI in headless Chrome (dev server + service running)
npm run e2e -- live "message one" "message two"                     # C: fresh conversation, then reload + backend switch
npm run e2e -- history s2-bullying asked-to-stop "msg" "child:msg"   # B: history checkpoint, then live (child: = child's phone)
E2E_HELP=1 npm run e2e -- history cs-rapid-sextortion first-demand "child:i'm telling my dad"   # + Get help/report check
E2E_STOP_AT=9 E2E_LIVE='["a live message"]' npm run e2e -- scenario cs-sustained-coercion       # A → continue live
npm run apk                                    # Android app → apk/RAKSHAK-debug.apk (needs Android Studio)
```

Unit tests: Vitest covers the engine (unchanged golden fixtures), mode/history rules (`lib/flow.test.ts`), store
transitions with a mocked API (`store.test.ts`: no reset on mode change, exact history prefix, idempotent reloads,
failure/resume, cloud never auto-runs, child messages reassessed, historical alerts not popped up) and the report
(`lib/report.test.ts`: redaction, escaping, no originals in redacted exports, source data unchanged). Pytest covers the
history endpoint (prefix only, stable IDs, idempotency, stale runs after a switch, case-study listing, cross-chat
identities, old-database migration). These use fake models: they test bookkeeping, not model accuracy.

Scenario IDs: `s1-banter`, `s2-bullying`, `s3-grooming`, `s4-crosschat`, `s5-group`; case studies
`cs-sustained-coercion`, `cs-rapid-sextortion` (not part of `npm run eval`). Each has two checkpoints (see the JSON). The e2e
script needs Google Chrome; set `CHROME_PATH` if it is not in the default install location.

See [`eval/reports/latest.md`](eval/reports/latest.md) for the latest real-model results, including misses.

Latest run (2026-10-24, RTX 5060, 10 synthetic cases, local hybrid): level within the expected range in **10/10**, no
false-positive or false-negative alerts, 0 invalid evidence references, **2 attribution errors** (a birthday-surprise
sender listed as a source of a needs-review secrecy cue; one group sender missed in the multi-chat case), p50 latency
3.1–5.9 s per analysed message. An earlier run, before the verification pass and the banter-mutuality check, scored 7/10.
Results vary between runs; ChatGPT was not evaluated (not signed in). Scenarios 01 (a boundary) and 05 (a quoted defence)
gained a few lines after that run: re-run `npm run eval` before quoting numbers.

## 8. Configuration

Environment variables, all prefixed `RAKSHAK_` (defaults in brackets). No `.env` file is read; set them in the shell.

| Area | Variables |
|---|---|
| Service (`apps/server/rakshak_server/config.py`) | `HOST` (127.0.0.1), `PORT` (8787), `DATA_DIR` (`rakshak/data`), `LOG_TEXT` (0: raw chat text is not logged) |
| Remote access | `ACCESS_TOKEN` (empty: remote requests refused; `server:lan` sets one), `CORS_ORIGINS` (http://localhost, https://localhost, capacitor://localhost) |
| Rules fallback | `RULES_FALLBACK` (1): when Ollama is unreachable or the model is not pulled, local analysis uses keyword rules (labelled "rules fallback", never shown as AI) instead of failing |
| RoBERTa | `ROBERTA_MODEL` (nayan90k/roberta-finetuned-cyberbullying-detection), `ROBERTA_ENABLED` (1), `ROBERTA_DEVICE` (cpu \| cuda \| mps \| auto), `ROBERTA_THRESHOLD` (0.5) |
| Qwen / Ollama | `OLLAMA_URL` (http://127.0.0.1:11434), `QWEN_MODEL` (qwen3.5:4b), `QWEN_NUM_CTX` (16384; use 8192 if VRAM is tight), `QWEN_NUM_PREDICT` (1200), `QWEN_TIMEOUT_S` (120), `QWEN_KEEP_ALIVE` (30m), `QWEN_SEED` (7), `VERIFY` (1), `WARMUP` (1) |
| Context | `CONTEXT_TOKEN_BUDGET` (11000), `RELATED_EVIDENCE_LIMIT` (12) |
| ChatGPT | `CHATGPT_ENABLED` (1), `CHATGPT_TIMEOUT_S` (180), `COMPANION_URL` (http://127.0.0.1:8788), `COMPANION_PORT` (companion side, 8788) |
| Scripts / tooling | `ALLOW_DOWNLOAD` (0, `start-server.mjs`), `TORCH_INDEX` (CPU wheel index, `setup-server.ps1`), `API` (http://127.0.0.1:8787, Vite proxy and `eval.ts`), `WEB` (http://127.0.0.1:5280, e2e target) |

Scoring rules: `packages/engine/config.json`.

## 9. Known limitations

- Qwen3.5 4B is small. It still makes mistakes (see the evaluation report). The verification pass and fusion reduce
  them; they do not remove them. Every finding is shown with its provenance so a human can judge it.
- RoBERTa is English-only and binary. It flags friendly insults (e.g. 0.97 for "you absolute clown 😂") and misses
  polite exclusion; the pipeline is designed around that, but Tanglish and Tamil script are not well covered.
- Latency is ~3–8 s per analysed message on an RTX 5060 laptop and grows with longer contexts.
- Qwen's output can differ between runs even at temperature 0 with a fixed seed (each message is judged with a
  different context window), so the same scenario can land on a different score and sometimes a different level. In
  our runs, Cyberbullying ended at L2 or L3 and the multi-chat case between L1 and L3 (partly across code changes).
  Rehearse on the demo laptop.
- Counterspeech keeps the Plan's ×0.3 weight, so a friend defending the child adds a small amount (it never names the
  friend as an offender). Set `reductions.counterspeech` to 0 in the engine config if you prefer.
- The demo scenarios were written by the team; passing them is not evidence of general accuracy.
- The relay keeps no history: a chat phone that joins late gets a snapshot from a connected chat device, a guardian
  phone gets the current alert summary. Notifications need the app running (foreground or the guardian's background
  service); there is no push service. The Android app is a debug build and has not been tested on every Android version.
- In a rehearsal of the group pile-on, RoBERTa flagged Riya's quoted defence and a harmless message of hers without Qwen
  agreeing; both became *needs review* evidence at half weight, so she was listed among the bullying track's senders.
  The case studies' "Observed in this run" panel and the trace show such misses rather than hiding them.
- History initialisation is sequential (~5 s per batch). Alerts from history are not popped up by design; if the history
  already warrants concern, the baseline says so.
- Redaction is automatic for the child's known name/ID, terms the guardian adds, phones, emails, links and @handles. It
  can miss other identifying details; the report says so and must be reviewed.
- Case-study facts were read from Internet Archive snapshots of the CBC and U.S. DOJ pages (their sites blocked our
  fetcher), and the Indian reporting guidance from PIB / India Code pages; cybercrime.gov.in itself was unreachable from
  our network. Re-check the live pages before presenting.
- macOS was not tested by us.
- The ChatGPT path is untested end to end (no sign-in performed) and carries the compliance caveat above.
