# RAKSHAK web demo (UI only)

UI preview with dummy data. The engine is not connected yet (see `../../../Plan.md`).

```bash
npm install
npm run dev        # http://127.0.0.1:5280
```

| Route | What it shows |
|---|---|
| `/#/` | Landing page |
| `/#/sim?mode=A` | Simulation: AI scenario (`mode=B` for live chat) |
| `/#/predator` | Predator chat only (pop-out) |
| `/#/victim` | Child's chat only (pop-out) |
| `/#/console` | Guardian phone + engine panels (pop-out) |

Simulation shortcuts: `Space` play/pause · `→` step · `E` engine drawer · `R` reset.

Windows stay in sync via `BroadcastChannel`, so each route can be opened on its own screen.
Scenario data lives in `src/data/scenario.ts`; the engine will later replace its precomputed `analysis` blocks.
