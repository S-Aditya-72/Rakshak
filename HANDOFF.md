# RAKSHAK: Handoff

**Team Git Happens** (M Sarvesh, Naren K, S Aditya, Mohit Kumar). ChronoForge 2026, NITK Surathkal, Cybersecurity track, theme "Cities of the Future".
Last updated: 2026-10-25 (web v2 merged with the phone apps: three demo modes, history continuation, case studies, guardian Get help; per-role Android apps, QR setup, guardian app, temporary guardians). Setup for a new laptop: [`rakshak/README.md`](rakshak/README.md#0-team-setup-start-here). Phones: [`rakshak/MOBILE.md`](rakshak/MOBILE.md).

This file records what exists today, how to run it, how it fits together, and what is still open. Read it next to
[`Plan.md`](Plan.md) (original architecture), [`rakshak/README.md`](rakshak/README.md) (setup and pipeline details) and
the Round 1 proposal PDF.

---

## 0. TL;DR

| Area | Status |
|---|---|
| Web UI: landing, simulation, chats, alerts, console | ✅ Same design, now wired to **real analysis** |
| Deterministic engine (`packages/engine`) | ✅ Decay, ×2 sequence, floors, reductions, per-contact grooming + child-level bullying tracks, alert de-dup. Golden 1.0 → 2.9 → 8.4 → 10.9 is a passing unit test |
| Shared contract (`packages/shared`) | ✅ `rakshak.analysis.v1`, TS + zod, mirrored in Python |
| Local hybrid backend | ✅ RoBERTa (CPU) + Qwen3.5 4B (Ollama, GPU) + verification + fusion, verified end to end on the RTX 5060 laptop |
| Case memory | ✅ SQLite: children, participants, conversations, messages, evidence, cases, runs, snapshots, alerts |
| A · Guided Demo | ✅ Five scripted examples + two fictional case-study recreations, every verdict from the live pipeline. The precomputed script survives only as a labelled *Presentation preview*. "Continue live from here" turns a paused playback into a live case |
| B · Continue the Conversation | ✅ Loads a scenario's history up to a checkpoint (server-side, idempotent, stable IDs), analyses it in batches (alerts from history recorded, not popped up), then judges type the next messages |
| C · Free Chat | ✅ Explicit "Start new conversation": no preloaded messages; private + group chats, sender picker, multi-day, live analysis |
| Case studies | ✅ Amanda Todd and Jordan DeMay: sourced background, fictional recreation (clearly labelled), playback, continue live, support vs documented events, sources |
| Guardian Get help | ✅ From L2/L3 alerts: understand (recorded vs AI vs deterministic), support the child, evidence review with redaction and HTML/JSON export, complaint options (standard, anonymous-eligibility check, official portal). Status always "Not submitted" |
| ChatGPT backend (Sign in with ChatGPT) | 🟡 Implemented with the official SDK in a localhost companion. **Sign-in and cloud inference not yet tested** (needs the owner's account). Compliance caveat in README §6 |
| Tests | ✅ 56 Vitest (engine/contract + web: modes, history, store transitions, report/redaction, withdrawals) + 93 server pytest (pipeline, history/continuation, confirmation gate, remote access, sync relay, rules fallback) + browser e2e (scenario, history, live, Get help) + real-model eval harness |
| Android app (Capacitor 8) | ✅ `rakshak/apk/RAKSHAK-debug.apk` (committed). One role per phone: Meera's protected messenger, Kabir's plain messenger, RAKSHAK Guardian (lock screen, Android notifications, Home/Alerts/Report/Settings, Get help), temporary guardian. QR setup. Tested on an Android 16 emulator and real phones |
| Cross-device sync | ✅ Relay `/api/sync` (`relay.py`): chat devices share the case; guardian phones get alert summaries only and the relay drops guardian-bound frames carrying chat content. Temporary-guardian invites (`/api/guardians/*`) with server-side expiry/revoke. Laptop projector view `/#/engine` shows what each device received |
| Git | ✅ GitHub `S-Aditya-72/Rakshak`, branch `master` |
| Launch video (`/brag`) | ✅ Unchanged |

---

## 1. Repository map

```
Chronoforge/
├─ HANDOFF.md, Plan.md, proposal PDF, screenshot
└─ rakshak/                         npm workspace root (README.md has full setup)
   ├─ package.json                  scripts: dev, build, server, server:lan, apk, companion, test, test:server, eval, e2e, setup:siwc
   ├─ MOBILE.md                     Android app: install, connect, run the demo, troubleshooting
   ├─ apk/                          (git-ignored) RAKSHAK-debug.apk from `npm run apk`
   ├─ apps/
   │  ├─ web/                       React UI (Vite :5280, proxies /api and the /api/sync WebSocket → :8787)
   │  │  ├─ src/mobile/             Setup (/app), ChatApp (child/contact), GuardianApp (guardian/temp)
   │  │  ├─ src/qr/                 QR codes: generate, scan (jsQR), pairing format
   │  │  ├─ src/lib/sync.ts         cross-tab + cross-device sync (BroadcastChannel + relay)
   │  │  └─ android/                Capacitor Android project (icon, splash, cleartext, portrait)
   │  ├─ server/                    Python FastAPI inference service (:8787) + pytest suite
   │  │  └─ rakshak_server/         app, pipeline, context, analyzers (Qwen/ChatGPT), roberta, fusion, validation, db, scenarios
   │  └─ siwc-companion/            Node, official @siwc/local SDK, holds ChatGPT tokens (:8788), standalone package
   ├─ packages/
   │  ├─ shared/                    contract types + zod schema
   │  └─ engine/                    deterministic risk engine + config.json + tests
   ├─ prompts/                      analysis_system.v1.md, verify_findings.v1.md
   ├─ scenarios/                    01–05 demo examples (+ checkpoints, presenter ideas), eval/ fixtures (expect = evaluator only),
   │                                case-studies/ two fictional recreations (no expect; not evaluated)
   ├─ scripts/                      setup-server.{ps1,sh}, setup-siwc.mjs, start-server.mjs, eval.ts, e2e-browser.mjs
   ├─ eval/reports/latest.md        latest real-model evaluation
   ├─ data/                         (git-ignored) SQLite DB, SIWC encrypted credentials, companion secret
   └─ vendor/                       (git-ignored) sign-in-with-chatgpt-devkit at a pinned commit
```

---

## 2. How to run

```bash
cd rakshak
npm install
powershell -ExecutionPolicy Bypass -File scripts/setup-server.ps1   # Windows; macOS: bash scripts/setup-server.sh
ollama pull qwen3.5:4b
npm run server        # :8787 (RoBERTa loads once in the background, Qwen warms up)
npm run server:lan    # same, but reachable by the phones: prints address + access code (see MOBILE.md)
npm run dev           # http://127.0.0.1:5280
npm run companion     # optional ChatGPT backend, after: npm run setup:siwc
```

- Port **5280** (strictPort, 127.0.0.1). The service binds to 127.0.0.1 unless started with `server:lan`; the companion always does.
- Remote clients (phones, tunnels) must send the access code; the laptop's own browser never needs it. The ChatGPT
  backend refuses anything that is not from the laptop itself.
- The status pill in the simulation's top-right corner shows the real model state. Click it to refresh.
- `R` / reset restarts the current case from its own starting point (script start, history checkpoint, or a new
  conversation) and clears its server-side memory. Switching modes never resets anything.

### Routes (HashRouter)

| URL | What it is |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | A · Guided Demo (Studio panel → pick an example or case study → Play) |
| `/#/sim?mode=B` | B · Continue the Conversation (Studio panel → conversation → checkpoint → Load history) |
| `/#/sim?mode=C` | C · Free Chat (Studio panel → Start new conversation) |
| `/#/predator`, `/#/victim`, `/#/console` | Pop-out windows (synced) |
| `/#/app` | Android app home: Scan QR / enter address and code, role picker, offline demo (the app opens here) |
| `/#/m/child`, `/#/m/contact`, `/#/m/guardian`, `/#/m/temp` | Phone roles (the app reopens into the saved one) |
| `/#/engine` | Projector view: engine panels + Devices + Connect phones QR (V toggles drawn phones) |

Shortcuts: `Space` play/pause · `→` step · `S` studio panel · `E` engine drawer · `R` reset. A `?mode=` in the URL only selects the view.

---

## 3. Tech stack

| Concern | Choice |
|---|---|
| Web | React 18 + TypeScript, Vite 6, Tailwind v4 + `styles.css`, framer-motion 11, zustand 5, react-router 6 (HashRouter), lucide-react |
| Contract validation | zod 3 (browser), pydantic 2 (server) |
| Engine | Pure TypeScript, Vitest |
| Inference service | Python 3.12, FastAPI, uvicorn, httpx, SQLite (WAL) |
| Models | `nayan90k/roberta-finetuned-cyberbullying-detection` (transformers + torch CPU), `qwen3.5:4b` Q4_K_M via Ollama 0.40 |
| ChatGPT | `@siwc/local` (OpenAI DevKit, Noncommercial licence) in a Node 22+ companion |
| Android | Capacitor 8.5 (haptics, keep-awake, app, keyboard, local-notifications, share) + own plugins ScreenColor and GuardianService (foreground service), Gradle 8.14, AGP 8.13, compile/target SDK 36, min SDK 24 |
| Sync | FastAPI WebSocket relay (`websockets` 17) + BroadcastChannel; message ids de-duplicate the two routes |

---

## 4. The UI (unchanged design, new wiring)

The landing page, phones, alert system, console and launch video from the previous handoff are all still there with the
same visuals. What changed:

- **Simulation** (`pages/Simulation.tsx`): status pill (real model state); Settings has *Analysis backend*
  (Hybrid · Local / ChatGPT · Cloud) and the ChatGPT connection panel; modes and cases are picked in the Studio panel; the dock gets
  **Analyze with ChatGPT** when the cloud backend is selected; the progress bar marks where alerts *actually* fired.
- **Engine drawer**: tabs *Case*, *Evidence* (case memory with provenance), *Trace* (per-message RoBERTa score, Qwen
  verdict, fusion agreement, rule trace, measured latency), *Models* (live status + full validated latest run). ↻
  re-analyses every chat (idempotent).
- **Chats** (`chat/ChatScreen.tsx`): messages are scoped to the active conversation; group chats show sender names; the
  back arrow opens an iMessage-style chat list; live cases (B and C) can create private or group chats; the left phone has a sender
  picker in groups.
- **Alerts**: same components. Copy is category-aware (bullying vs potential grooming), the guardian sheet adds "AI-detected
  warning signs, not a confirmed offence", and the child's *Dismiss* and *Block* now feed the engine's dismissal and
  linked-contact rules.
- **Landing**: copy updated to describe the real backends honestly (laptop prototype, not yet on-device mobile).
- Preview L1/L2/L3 buttons still show the design with precomputed data, labelled as previews.

### 4.1 Modes, case origin and history (this update)

- **Mode vs case.** `mode` (A/B/C) is only the view. The case lives on the server with an `origin`
  (`scripted`, `history`, `fresh`; plus the client-only `preview`). The header shows both. Replacing a case is always
  an explicit button; a refresh restores the server case in the last selected mode (mode/backend/speed/sound are in
  `localStorage`, the case is not).
- **Old → new mapping.** Old Mode A = new A. Old Mode B (fresh manual chat, auto-seeded on entry) = new **C**, now
  started explicitly. New **B** is history continuation.
- **History preload** (`POST /api/scenarios/{id}/history?checkpoint=…` or `?upto=n`): saves the cast and the first *n*
  messages with the same IDs playback uses, in one transaction. Same scenario + checkpoint again → `reused`, untouched
  (no duplicate messages, evidence, risk or alerts). Nothing after the checkpoint is saved, so future script lines,
  captions, presenter ideas and expectations can never reach a model.
- **History initialisation** (browser): batches = consecutive messages of one chat on one simulated day, analysed one at a
  time through the normal pipeline. States: loading → analyzing (progress, *Stop after this batch*) → complete / failed
  (*Retry*) / cancelled (*Resume*). Cloud backend: *messages only*, nothing runs until the owner presses Analyze.
- **Historical alert policy.** Alerts raised while analysing history are real and recorded (marked `historical`), listed
  on the guardian phone as "from earlier history", but not pushed as banners, nudges or takeovers. The Studio panel shows
  the baseline captured when history finished. Live messages after that alert normally (de-duplication unchanged).
- **Reassessment.** Every saved live message (including the child's objections) triggers a local analysis; the server
  coalesces bursts. Playback keeps its pace by analysing after other participants' messages; child replies fall in the
  next run's focus, and any trailing unanalysed message is analysed when playback stops or is continued live. ChatGPT
  never runs automatically.
- **Continue live from here** (Mode A, paused): `POST /api/case/continue` relabels the played case as history at the
  number of saved messages, keeping all memory and the case generation.

### 4.2 Case studies

`apps/web/src/data/caseStudies.ts` holds the documented background and sources (UI-only). The recreations
(`scenarios/case-studies/*.json`) use fictional names and original, non-graphic dialogue, with the notice "Fictional
recreation inspired by a documented abuse pattern. These are not the actual messages or participants." The case-study
view's "Observed in this run" lists what the live pipeline actually flagged on the team's key moments, including misses.

Sources were checked on 2026-10-24: CBC News sentencing report for Amanda Todd (14 Oct 2022) and the U.S. Attorney's
Office (W.D. Michigan) releases for Jordan DeMay (indictment 3 May 2023, pleas 10 Apr 2024, sentencing 5 Sep 2024).
cbc.ca and justice.gov blocked our automated fetcher, so the text was read from Internet Archive snapshots of those exact
URLs (noted in the UI). **Re-check the live pages before presenting.**

### 4.3 Guardian Get help

Opened from the L2/L3 alert sheet or the L3 takeover (*Get help*, *Support*, *Reporting options*). The alert's own
buttons keep their one-tap effects on every phone (*Talk to Meera* sends a check-in, *Block contact* blocks in the demo
messenger, *Loop in counsellor* is logged, *Call 1930* opens the dialer). It always uses the selected alert's own case
(`caseKey`); if that case is gone it says so and shows nothing from another case.

**On the guardian's Android phone** Get help runs full screen from the alert summary only (that phone never receives
messages or model output): *Understand* lists the cue types and days and the rule trace, *Evidence & report* says the
evidence stays on the child's phone, and the Support/Complaint buttons send the same shared responses (check-in, block,
counsellor note, *Mark as handled* closes CRITICAL everywhere). Links and helpline numbers open outside the app.

1. **Understand:** concern summary; *recorded messages* (refs, chats, days, no text), *AI interpretations* (status,
   agreement, uncertainty), *deterministic risk level* (score, rule trace) kept visually separate.
2. **Support:** conversation guide, category-specific next steps (bullying is not routed into a sexual-offence flow),
   simulator-only block (labelled; no real account), helplines with sources (112, 1098, Tele-MANAS 14416), and an honest
   "no counsellor service is connected".
3. **Evidence & report:** opt-in evidence review → choose messages (optionally findings added after the alert), edit the
   export text, redact (child name/ID, extra terms, phones, emails, links, @handles), summary/notes, live preview of the
   exact HTML that downloads (sandboxed iframe), HTML + JSON download. Report: ID, time, synthetic designation, alias,
   timeline, IDs, simulated days, reported accounts with "suspected behaviour", AI interpretations, provenance,
   "Not submitted", "not a legal determination". Originals are never modified or embedded in a redacted export.
4. **Complaint options:** standard complaint checklist, anonymous-reporting eligibility check (by content type, never by
   risk level), official portal link (no data attached). Copy is sourced from PIB releases (portal, 1930, "Report
   Anonymously" categories), India Code (POCSO s.23) and Take It Down.

---

## 5. Launch video (`/brag`)

Unchanged; see `rakshak/apps/web/brag-output/`. `.gitignore` now excludes its frames, stills, Chrome profile and WAVs.

---

## 6. How analysis works (summary; details in README §5)

```
message ─▶ POST /api/messages ─▶ POST /api/analyze
  context: this chat (focus + evidence-bearing + recent, token-budgeted) + prior findings + cross-chat evidence
  RoBERTa(focus msgs) ∥ Qwen(whole context, schema-constrained, IDs aliased)
  → validation (IDs, targets, enums) → verification pass (new uncorroborated claims)
  → fusion (agree / contextual_only / context_override / needs_review; banter mutuality check)
  → reconcile evidence (stable keys, supersede, retract, merge) → response
browser: computeRisk(evidence) → score/level/stage/tracks/trace → decideAlerts → route to L1/L2/L3 UI
         → persist snapshot + alerts (server de-duplicates)
```

Key engineering points for judges:
- Qwen is never gated on RoBERTa; RoBERTa never produces grooming cues.
- The model never sets the score: it reports evidence; the engine (config in `packages/engine/config.json`) decides.
- Same evidence twice never counts twice (stable evidence keys; the engine is a pure function of the evidence set).
- Group chats: per-sender attribution, model-identified targets, harm aimed at others recorded but not scored for the child.
- Cross-chat: the bullying track sums across all of the child's chats; accounts are never merged by guesswork.
- Stale results: generation counter + watermark on the server, epoch on the client.

---

## 7. Measured on this laptop (RTX 5060 Laptop 8 GB, 24 GB RAM, Windows 11)

- Qwen3.5 4B Q4_K_M at 8192 context: **3.36 GB VRAM** (4.0 GB total GPU use), fully on GPU.
- Inference service with RoBERTa on CPU: ~680 MB RAM; RoBERTa ~30 ms per message after load (~4–16 s cold load).
- End-to-end analysis per message: typically **3–8 s** (Qwen ~2.5–6 s, plus ~1 s when the verification pass runs).
- Real-model evaluation: see `rakshak/eval/reports/latest.md` (includes misses). **Note:** scenarios 01 and 05 gained a
  few lines in this update (a boundary in banter, a quoted defence in the group chat), so re-run `npm run eval`.
- Rehearsals on 2026-10-24 (real models, single runs, not accuracy evidence): banter history → baseline L1 (Qwen judged
  some teasing mildly concerning), harmless reply → Qwen retracted, L0. Bullying history → baseline L2, escalation →
  intimidation, score 8.8 (L2). Free Chat bus-stop question → personal-info request, L1. Rapid-sextortion recreation →
  history already L3 (payment-threat floor), new demand → score 12. Coercion recreation playback → L1 then L3; after
  continuing live, "you will regret blocking me…" → intimidation, new L2 bullying alert. Group pile-on playback → L2;
  **Riya's quoted defence and her harmless "i'll bring the ball!" were flagged by RoBERTa without Qwen** (needs review,
  half weight), so she appears among the bullying track's senders: a real attribution limitation, left visible.
- MacBook Air M4 16 GB: **not tested by us**. Expect Ollama on Metal and RoBERTa on CPU to fit comfortably; latency unknown.

---

## 8. What is pending

### 8.1 Before the demo
- [ ] Install the new `rakshak/apk/RAKSHAK-debug.apk` on the demo phones and run through MOBILE.md once on the demo laptop (restart `npm run server:lan` after pulling)
- [ ] Try the QR scan with a real camera, and RAKSHAK's background service on the demo phones' brands (battery savers)
      (firewall prompt, hotspot, address + code, all three roles, one Mode A case and one Mode B exchange).
- [ ] **Owner:** run `npm run setup:siwc`, `npm run companion`, then *Continue with ChatGPT* in Settings. Confirm a model is
      listed and one owner-initiated analysis works. Until then the ChatGPT path is untested. Decide whether to show it at
      all given the Terms caveat (README §6).
- [ ] Rehearse each test case once on the demo laptop and keep the Ollama model warm (`keep_alive 30m` is set).
- [ ] Rehearse A, B, C and both case studies (README §4.1). History initialisation takes ~5 s per batch.
- [ ] Re-check the case-study sources and the Indian helpline/portal details on the live official pages.
- [ ] Re-run `npm run eval` (scenarios 01 and 05 changed).
- [ ] Re-run `npm run eval` after any prompt change and read the report, not just the totals.

### 8.2 Known weaknesses to work on
- [ ] Qwen3.5 4B still mislabels some messages (see eval report). Ideas: few-shot examples from the misses, a larger model
      on the Mac (`RAKSHAK_QWEN_MODEL=qwen3.5:9b` if memory allows), or calibrating per-cue thresholds on more data.
- [ ] Tanglish / Tamil script: RoBERTa is English-only; Qwen handles some Tanglish. Needs a test set.
- [ ] Latency grows with very long chats; the context budget keeps evidence but drops plain older chatter.

### 8.3 Not started (from Plan.md)
- [ ] In-browser on-device model (ONNX) for a true phone story. The current "local" backend runs on the laptop.
- [ ] "3 setups" comparison view (keyword vs model vs model + memory).
- [ ] Encrypted-at-rest case memory (SQLite is plain on disk; synthetic data only).

---

## 9. Open questions

1. **ChatGPT backend and the SIWC Terms:** keep it as an owner-only, synthetic-data comparison, or drop it from the pitch?
2. **Hackathon rules:** pretrained weights (RoBERTa, Qwen) are used as-is. Confirm that is allowed and say so plainly on stage.
3. **Default backend on stage:** local hybrid (privacy story, no internet) is the recommendation.

---

## 10. Gotchas

- Port 5173 is someone else's app on this machine. Use **5280**.
- Anything that writes lots of files inside `apps/web/` triggers Vite reloads unless it is in `server.watch.ignored`
  (`android/` is ignored, because `cap sync` copies the build there).
- Gradle downloads time out on networks with broken IPv6: set `JAVA_OPTS=-Djava.net.preferIPv4Stack=true` (`npm run apk` does).
- Only the laptop starts test cases or switches modes; phones keep their own open chat and screens. The offline demo
  is disabled while a phone is connected so it cannot overwrite the shared case.
- Zustand selectors must return stable values: `useDemo((s) => s.data.alerts.filter(...))` re-renders forever
  (React #185). Filter in `useMemo` instead.
- Overlay exits use `pointerEvents: 'none'`: a stalled exit animation otherwise leaves an invisible layer catching taps.
- Notifications need `isExactNotification: false`, or the plugin opens Android's exact-alarm settings page.
- A full HMR reload resets the in-browser state; the server-side case memory survives and is re-hydrated.
- Chat auto-scroll must run inside `requestAnimationFrame`, after the new bubble is laid out.
- Phones are scaled with `--phone-scale`. Don't hard-code pixel sizes in phone content.
- CRITICAL content needs about 62 px of top padding to clear the dynamic island.
- Windows consoles: run Python with `PYTHONIOENCODING=utf-8` (the npm scripts do) or emoji in chats crash prints.
- `npm run server` sets `HF_HUB_OFFLINE=1`; set `RAKSHAK_ALLOW_DOWNLOAD=1` the first time if you skipped the setup script.
- Changing a prompt file needs a server restart (prompts are cached at load).
- Zustand selectors must not build new objects each call (use `useMemo`), or React loops.
- In dev builds `window.__rakshak` exposes the store for `scripts/e2e-browser.mjs`; it is absent from production builds.
- Headless screenshots taken with Chrome's `--virtual-time-budget` can freeze framer-motion entry animations (invisible
  bubbles, stale caption). Use `npm run e2e` (real time) for screenshots.
- Stopping `npm run server` from a task runner may leave the Python child holding port 8787; stop that process too.
