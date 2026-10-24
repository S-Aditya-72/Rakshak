# RAKSHAK: Handoff

**Team Git Happens** (M Sarvesh, Naren K, S Aditya, Mohit Kumar). ChronoForge 2026, NITK Surathkal, Cybersecurity track, theme "Cities of the Future".
Last updated: 2026-10-24 (AI integration).

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
| Mode A | ✅ Five test cases, every verdict from the live pipeline. The old precomputed script survives only as a labelled *Presentation preview* |
| Mode B | ✅ Unscripted messages, private + group chats, sender picker, multi-day, chat list, live analysis |
| ChatGPT backend (Sign in with ChatGPT) | 🟡 Implemented with the official SDK in a localhost companion. **Sign-in and cloud inference not yet tested** (needs the owner's account). Compliance caveat in README §6 |
| Tests | ✅ 23 engine/contract (Vitest) + 37 server (pytest) + browser e2e + real-model eval harness |
| Realtime relay across devices (Socket.IO) | ❌ Not started (BroadcastChannel only) |
| Launch video (`/brag`) | ✅ Unchanged |

---

## 1. Repository map

```
Chronoforge/
├─ HANDOFF.md, Plan.md, proposal PDF, screenshot
└─ rakshak/                         npm workspace root (README.md has full setup)
   ├─ package.json                  scripts: dev, build, server, companion, test, test:server, eval, e2e, setup:siwc
   ├─ apps/
   │  ├─ web/                       React UI (Vite :5280, proxies /api → :8787)
   │  ├─ server/                    Python FastAPI inference service (:8787) + pytest suite
   │  │  └─ rakshak_server/         app, pipeline, context, analyzers (Qwen/ChatGPT), roberta, fusion, validation, db, scenarios
   │  └─ siwc-companion/            Node, official @siwc/local SDK, holds ChatGPT tokens (:8788), standalone package
   ├─ packages/
   │  ├─ shared/                    contract types + zod schema
   │  └─ engine/                    deterministic risk engine + config.json + tests
   ├─ prompts/                      analysis_system.v1.md, verify_findings.v1.md
   ├─ scenarios/                    01–05 demo test cases, eval/ extra fixtures (expect blocks = evaluator only)
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
npm run dev           # http://127.0.0.1:5280
npm run companion     # optional ChatGPT backend, after: npm run setup:siwc
```

- Port **5280** (strictPort, 127.0.0.1). The service and companion also bind to 127.0.0.1 only.
- The status pill in the simulation's top-right corner shows the real model state. Click it to refresh.
- `R` / reset clears the synthetic case **and its server-side memory**.

### Routes (HashRouter)

| URL | What it is |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | Test cases (Settings → Test case → Play) |
| `/#/sim?mode=B` | Live chat (chat list behind the back arrow; ✎ new private/group chat) |
| `/#/predator`, `/#/victim`, `/#/console` | Pop-out windows (BroadcastChannel sync) |

Shortcuts: `Space` play/pause · `→` step · `E` engine drawer · `R` reset.

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

---

## 4. The UI (unchanged design, new wiring)

The landing page, phones, alert system, console and launch video from the previous handoff are all still there with the
same visuals. What changed:

- **Simulation** (`pages/Simulation.tsx`): status pill (real model state); Settings has *Analysis backend*
  (Hybrid · Local / ChatGPT · Cloud), the ChatGPT connection panel, and a *Test case* picker; the dock gets
  **Analyze with ChatGPT** when the cloud backend is selected; the progress bar marks where alerts *actually* fired.
- **Engine drawer**: tabs *Case*, *Evidence* (case memory with provenance), *Trace* (per-message RoBERTa score, Qwen
  verdict, fusion agreement, rule trace, measured latency), *Models* (live status + full validated latest run). ↻
  re-analyses every chat (idempotent).
- **Chats** (`chat/ChatScreen.tsx`): messages are scoped to the active conversation; group chats show sender names; the
  back arrow opens an iMessage-style chat list; Mode B can create private or group chats; the left phone has a sender
  picker in groups.
- **Alerts**: same components. Copy is category-aware (bullying vs potential grooming), the guardian sheet adds "AI-detected
  warning signs, not a confirmed offence", and the child's *Dismiss* and *Block* now feed the engine's dismissal and
  linked-contact rules.
- **Landing**: copy updated to describe the real backends honestly (laptop prototype, not yet on-device mobile).
- Preview L1/L2/L3 buttons still show the design with precomputed data, labelled as previews.

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
- Real-model evaluation: see `rakshak/eval/reports/latest.md` (includes misses).
- MacBook Air M4 16 GB: **not tested by us**. Expect Ollama on Metal and RoBERTa on CPU to fit comfortably; latency unknown.

---

## 8. What is pending

### 8.1 Before the demo
- [ ] **Owner:** run `npm run setup:siwc`, `npm run companion`, then *Continue with ChatGPT* in Settings. Confirm a model is
      listed and one owner-initiated analysis works. Until then the ChatGPT path is untested. Decide whether to show it at
      all given the Terms caveat (README §6).
- [ ] Rehearse each test case once on the demo laptop and keep the Ollama model warm (`keep_alive 30m` is set).
- [ ] Re-run `npm run eval` after any prompt change and read the report, not just the totals.

### 8.2 Known weaknesses to work on
- [ ] Qwen3.5 4B still mislabels some messages (see eval report). Ideas: few-shot examples from the misses, a larger model
      on the Mac (`RAKSHAK_QWEN_MODEL=qwen3.5:9b` if memory allows), or calibrating per-cue thresholds on more data.
- [ ] Tanglish / Tamil script: RoBERTa is English-only; Qwen handles some Tanglish. Needs a test set.
- [ ] Latency grows with very long chats; the context budget keeps evidence but drops plain older chatter.

### 8.3 Not started (from Plan.md)
- [ ] Socket.IO relay so Mode B works across devices (§7.4 of the old plan).
- [ ] In-browser on-device model (ONNX) for a true phone story. The current "local" backend runs on the laptop.
- [ ] "3 setups" comparison view (keyword vs model vs model + memory).
- [ ] Encrypted-at-rest case memory (SQLite is plain on disk; synthetic data only).
- [ ] `git init` at `rakshak/` (a `.gitignore` is ready).

---

## 9. Open questions

1. **ChatGPT backend and the SIWC Terms:** keep it as an owner-only, synthetic-data comparison, or drop it from the pitch?
2. **Hackathon rules:** pretrained weights (RoBERTa, Qwen) are used as-is. Confirm that is allowed and say so plainly on stage.
3. **Default backend on stage:** local hybrid (privacy story, no internet) is the recommendation.

---

## 10. Gotchas

- Port 5173 is someone else's app on this machine. Use **5280**.
- Anything that writes lots of files inside `apps/web/` triggers Vite reloads unless it is in `server.watch.ignored`.
- A full HMR reload resets the in-browser state; the server-side case memory survives and is re-hydrated.
- Chat auto-scroll must run inside `requestAnimationFrame`, after the new bubble is laid out.
- Phones are scaled with `--phone-scale`. Don't hard-code pixel sizes in phone content.
- CRITICAL content needs about 62 px of top padding to clear the dynamic island.
- Windows consoles: run Python with `PYTHONIOENCODING=utf-8` (the npm scripts do) or emoji in chats crash prints.
- `npm run server` sets `HF_HUB_OFFLINE=1`; set `RAKSHAK_ALLOW_DOWNLOAD=1` the first time if you skipped the setup script.
- Changing a prompt file needs a server restart (prompts are cached at load).
- Zustand selectors must not build new objects each call (use `useMemo`), or React loops.
- In dev builds `window.__rakshak` exposes the store for `scripts/e2e-browser.mjs`; it is absent from production builds.
