# RAKSHAK web app

The React UI: three phones (other participants, the protected child, the guardian), alerts, and the engine console.
It renders **real analysis** from the local inference service (`apps/server`, proxied at `/api`) and computes risk with
the deterministic engine (`packages/engine`). See the [project README](../../README.md) for setup.

```bash
# from rakshak/
npm install
npm run server     # inference service (needed for live analysis)
npm run dev        # http://127.0.0.1:5280
npm run build      # type-check + production build
```

| Route | What it shows |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | A · Guided Demo: five scripted examples + two fictional case studies, real pipeline |
| `/#/sim?mode=B` | B · Continue the Conversation: preloaded history up to a checkpoint, then live |
| `/#/sim?mode=C` | C · Free Chat: fresh conversation, private and group chats, multi-day |
| `/#/predator` | Left phone only (pop-out) |
| `/#/victim` | Child's phone only (pop-out) |
| `/#/console` | Guardian phone + engine panels (pop-out) |

Shortcuts: `Space` play/pause · `→` step · `S` studio · `E` engine drawer · `R` reset.

Key files:
- `src/store.ts`: state, modes vs case origin, the scenario player, history load/initialisation, the live analysis loop, stale-result protection, ChatGPT actions
- `src/lib/flow.ts`: pure mode/history rules (who may type, history batches, honest history status, persisted prefs)
- `src/lib/report.ts`: guardian evidence report: selection, redaction, escaped HTML + JSON export
- `src/console/Studio.tsx`: Studio panel per mode; `src/console/CaseStudyView.tsx`: case studies; `src/alerts/GetHelp.tsx`: guardian Get help
- `src/data/caseStudies.ts`, `src/data/resources.ts`: sourced case-study facts and helpline/reporting copy (UI-only)
- `src/lib/api.ts`: typed client; validates every analysis against the shared zod contract
- `src/lib/case.ts`: evidence → engine → per-message `Analysis` and de-duplicated `AlertItem`s
- `src/console/Analytics.tsx`: case card, score chart, trace, evidence (case memory), models panels
- `src/console/ChatGPTPanel.tsx`: Sign in with ChatGPT status, models, consent
- `src/data/scenario.ts`: the precomputed six-day script, used only for the labelled *Presentation preview* and the
  design *Preview L1/L2/L3* buttons

Windows stay in sync via `BroadcastChannel`. In dev builds, `window.__rakshak` exposes the store for
`scripts/e2e-browser.mjs`.
