# /brag plan: RAKSHAK

**Format:** landscape 1920×1080, 30 fps, 20.0 s
**Tone:** `polished`, with cinematic beats (serious subject, no jokes)
**Music:** 96 BPM (beat = 0.625 s, bar = 2.5 s), D minor; 32 beats, every cut on a beat

## Angle

Groomers rely on one thing: that nobody connects the messages. The video *shows* the messages being connected. First comes a harmless-looking line with no bad words. Then the pattern stacks up as RAKSHAK's score climbs. Last come the three escalation levels, landing on the real phones.

- **Hook (first 2 s):** a single, harmless-looking chat bubble, *"you're so mature for your age."*, then "No bad words." and "No one is told."
- **Highlights:**
  1. The memory: four messages over six days, with the case score climbing 1.0 → 2.9 → 8.4 → 10.9
  2. The levels on the real phones: a calm nudge for the child → a guardian alert → CRITICAL
- **Punchline:** "RAKSHAK connects the messages. Privately, on the child's own phone."

## Visual identity (from `src/styles.css`)

- Background `#07070b` with soft blue / teal / red aurora glows
- Blue `#0A84FF`, teal `#64D2FF`, L1 `#FFD60A`, L2 `#FF9F0A`, L3 `#FF453A`
- Inter (800 for headlines), JetBrains Mono for small labels
- Real components and CSS reused:
  - `PhoneFrame`, `StatusBar`, `Icon3DWarning`, `NeonBadge`, `CueChip`, `HazardStripe`
  - the `.nudge`, `.g-banner`, `.critical`, `.lock` and `.bubble` styles
- All copy comes from the app and the Round 1 proposal. Names (Kabir, Meera, Amma) are the app's fictional stand-ins.

## Storyboard

| # | Time | Beats | Scene | On screen | Sound |
|---|---|---|---|---|---|
| 1 | 0.00–3.75 | 0–6 | **Hook** | "Day 1 · Mon 7:15 PM" label; gray bubble pops in: *you're so mature for your age.* Beat 2: **No bad words.** Beat 3: **No one is told.** (muted) | Low D drone, heartbeat kick, soft bubble "tock" in key |
| 2 | 3.75–7.50 | 6–12 | **The pattern** | Title *Harm builds message by message.* Bubble stack (D1, D2, D4, D6) lands on beats 6–9, each with its real cue chip. Large score ring on the right counts 1.0 → 2.9 → 8.4 → 10.9, colour shifting teal → yellow → amber → red. Neon badge ends at *L3 · CRITICAL* | Kick on every beat, hats join, a rising tone on each jump, reverse swell into the cut |
| 3 | 7.50–10.00 | 12–16 | **Reveal** | Shield mark + RAKSHAK wordmark; **Protection should too.** (gradient); sub *On-device AI that protects children's chats.* | Soft impact, F major lift |
| 4 | 10.00–12.50 | 16–20 | **Level 1** | Left: L1 badge + *A calm nudge, just for the child.* Right: child's phone (lit) and guardian phone (dim); a secrecy message arrives, then the calm L1 nudge card slides up | Groove: kick, hats, bass 8ths; soft chime on the nudge |
| 5 | 12.50–15.00 | 20–24 | **Level 2** | L2 badge + *Parents alerted. Never the chat text.* Child receives "send me a photo…", the nudge becomes L2, and the guardian's "Time Sensitive" banner drops in with the amber 3D triangle (guardian lit) | A5→E6 chime, as in the app |
| 6 | 15.00–17.50 | 24–28 | **Level 3** | L3 badge + *Threats trigger a guided report to 1930.* Child receives the ₹5,000 threat; the guardian phone shakes into the CRITICAL takeover (siren beam, neon border, red pedestal triangle); child sees "You're not alone in this" | Impact, pulsing alarm figure in key (A4/F4), filtered |
| 7 | 17.50–20.00 | 28–32 | **Outro** | Shield + **RAKSHAK connects the messages.** Sub *Privately, on the child's own phone.* Footer: Team Git Happens · ChronoForge 2026 | Drums drop, F major pad + bell motif, ring-out |

Durations: 3.75 + 3.75 + 2.5 + 2.5 + 2.5 + 2.5 + 2.5 = **20.0 s** ✔

## Transitions

Staggered, never crossfaded between busy layouts. The outgoing content fades and lifts out over the last 0.25 s of its scene, then the new content enters from the beat. The phones persist through scenes 4–6. Between those scenes only the left-hand text swaps, and the spotlight shifts between the two phones.

## Readability check (≈0.3 s per word, from settled)

- "No bad words." / "No one is told.": settle by 2.2 s, hold to 3.5 s ✔
- "Harm builds message by message.": on screen for 3.4 s ✔
- "Protection should too." + 6-word sub: the sub settles at 8.1 s and holds 1.65 s ✔ (tight)
- The Level 1–3 lines (6–7 words each) settle about 0.35 s in and hold about 1.9 s ✔
- Outro line + sub: settle by 18.2 s and hold to 20 s ✔

## Build

A Vite page in `work/composition/` imports the real project components and CSS. Every frame is a pure function of `t`: React renders from `t`, and all CSS loop animations are paused and seeked to `t`.

Frames are captured with headless Chrome over CDP. The music is synthesised with numpy on the same beat grid. ffmpeg muxes it all into H.264 + AAC.
