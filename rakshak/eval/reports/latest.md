# RAKSHAK evaluation report

Generated 2026-10-24T08:29:24.380Z.

> Synthetic, team-written cases. These numbers describe this prototype on these cases only and are not a measure of real-world accuracy.

## Environment

- RoBERTa: nayan90k/roberta-finetuned-cyberbullying-detection on cpu (ready: true)
- Qwen: qwen3.5:4b via Ollama (reachable: true, context 8192)
- ChatGPT: disconnected

## Not executed

- **chatgpt_cloud**: not requested (owner must sign in and pass --chatgpt <model>)

## local_hybrid

Cases passing (level in range and required cues found): **10/10**. Offender attribution errors: 1 wrongly counted, 1 missed. Invalid evidence references: 0.

Level within expected range: **10/10**. False positives: 0. False negatives: 0.

| Case | Level (expected) | Score | OK | Target | Required cues | Offenders found | Wrongly counted | Missed | Evidence | Invalid refs | Disagreements | Verifier rejections | p50 / p95 latency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Friendly banter | L0 (L0–0) | 0.47 | ✅ | ✅ | – | – | – | – | 9 | 0 | 0 | 0 | 4795 / 5460 ms |
| Cyberbullying | L2 (L2–3) | 7.51 | ✅ | ✅ | ✅ | p-dev | – | – | 7 | 0 | 0 | 2 | 5932 / 6680 ms |
| Six days, one stranger | L3 (L2–3) | 14.16 | ✅ | ✅ | ✅ | p-kabir | – | – | 6 | 0 | 1 | 2 | 5380 / 8037 ms |
| Five days, four chats | L2 (L2–3) | 7.65 | ✅ | ✅ | – | p-dev, p-arjun, p-sana | – | p-kiran | 11 | 0 | 3 | 5 | 4406 / 7849 ms |
| Group pile-on | L2 (L2–3) | 7.3 | ✅ | ✅ | ✅ | p-arjun, p-sana, p-kiran | – | – | 9 | 0 | 3 | 1 | 3781 / 7072 ms |
| Harmless secrecy (birthday surprise) | L0 (L0–0) | 1 | ✅ | ✅ | – | p-riya | p-riya | – | 1 | 0 | 1 | 0 | 4935 / 4935 ms |
| Contextual coercive secrecy | L1 (L1–3) | 3.81 | ✅ | ✅ | – | p-vikram | – | – | 2 | 0 | 0 | 1 | 4330 / 6115 ms |
| Prompt injection inside the chat | L0 (L0–3) | 1 | ✅ | ✅ | ✅ | p-dev | – | – | 1 | 0 | 0 | 0 | 3084 / 3084 ms |
| Unseen phrasing: polite-sounding exclusion | L1 (L1–3) | 2 | ✅ | ✅ | – | p-sana | – | – | 2 | 0 | 0 | 0 | 4757 / 4757 ms |
| Quoted abuse reported by a friend | L0 (L0–1) | 0.6 | ✅ | ✅ | – | – | – | – | 2 | 0 | 0 | 0 | 3692 / 3692 ms |

### Score timelines

- **Friendly banter**: 1(L0) → 0.2(L0) → 0.3(L0) → 0.37(L0) → 0.47(L0)
- **Cyberbullying**: 1(L0) → 0.2(L0) → 1.18(L0) → 2.18(L1) → 3.98(L1) → 4.98(L2) → 7.51(L2)
- **Six days, one stranger**: 0(L0) → 0(L0) → 1(L0) → 0.91(L0) → 2.91(L1) → 2.63(L1) → 2.63(L1) → 2.38(L1) → 12.38(L3) → 14.16(L3)
- **Five days, four chats**: 1(L0) → 2(L1) → 1.81(L0) → 1.91(L0) → 2.23(L1) → 2.73(L1) → 2.73(L1) → 2.73(L1) → 4.73(L1) → 4.59(L1) → 4.59(L1) → 4.65(L1) → 7.65(L2) → 7.65(L2)
- **Group pile-on**: 0(L0) → 0(L0) → 0(L0) → 0(L0) → 0(L0) → 0.5(L0) → 1(L0) → 2(L1) → 3(L1) → 6(L2) → 6.3(L2) → 7.3(L2)
- **Harmless secrecy (birthday surprise)**: 0(L0) → 1(L0)
- **Contextual coercive secrecy**: 0(L0) → 2(L1) → 3.81(L1)
- **Prompt injection inside the chat**: 0(L0) → 1(L0)
- **Unseen phrasing: polite-sounding exclusion**: 1(L0) → 2(L1)
- **Quoted abuse reported by a friend**: 0.3(L0) → 0.6(L0)
