// "Six days, one stranger" from the Round 1 proposal, with hand-computed analyses (1.0 → 2.9 → 8.4 → 10.9).
// Used ONLY for the offline "Presentation preview" and the Preview L1/L2/L3 design buttons, both labelled as
// precomputed. Live test cases come from /scenarios and run through the real models; the same golden numbers
// are an engine unit test with fixed cues (packages/engine/test).

import type { Analysis, Side } from '../types';

export interface ScriptStep {
  from: Side;
  text: string;
  day: number;
  time: string;
  analysis?: Analysis;
}

const A1: Analysis = {
  cues: [{ cue: 'flattery_age', p: 0.91 }],
  score: 1.0,
  level: 0,
  stage: 'rapport',
  trace: ['new contact · first seen Day 1', 'flattery_age  p=0.91  +1.0', 'score 1.0 < 2 → logged'],
  latency: { gpt: 412, inhouse: 31 },
};

const A2: Analysis = {
  cues: [{ cue: 'secrecy', p: 0.96 }],
  score: 2.9,
  level: 1,
  stage: 'secrecy_isolation',
  trace: [
    'decay 1.0 → 0.9  (Δ1d · t½ 7d)',
    'secrecy  p=0.96  +2.0',
    'stage → secrecy / isolation',
    'score 2.9 ≥ 2 → L1 child nudge',
  ],
  latency: { gpt: 388, inhouse: 29 },
  alert: {
    guardianTitle: 'Secrecy cue · new contact',
    guardianBody: 'Meera was gently nudged. No guardian alert is sent at Level 1.',
  },
};

const A3: Analysis = {
  cues: [
    { cue: 'image_request', p: 0.94 },
    { cue: 'secrecy', p: 0.41 },
  ],
  score: 8.4,
  level: 2,
  stage: 'request',
  trace: [
    'decay 2.9 → 2.4  (Δ2d)',
    'image_request  p=0.94  +3.0 ×2  (secrecy → request)',
    'secrecy  p=0.41  below threshold',
    'floor: request from contact < 14d → ≥ L2',
    'score 8.4 ≥ 5 → L2 guardian alert',
  ],
  latency: { gpt: 455, inhouse: 33 },
  alert: {
    guardianTitle: 'Grooming pattern · new contact',
    guardianBody: '3 warning cues over 4 days from a contact first seen on Monday. An image request was just detected.',
  },
};

const A4: Analysis = {
  cues: [{ cue: 'threat_payment', p: 0.98 }],
  score: 10.9,
  level: 3,
  stage: 'coercion',
  trace: [
    'decay 8.4 → 6.9  (Δ2d)',
    'threat_payment  p=0.98  +4.0',
    'floor: threat / payment → L3',
    'score 10.9 ≥ 9 → L3 critical',
  ],
  latency: { gpt: 401, inhouse: 30 },
  alert: {
    guardianTitle: 'Threat & payment demand',
    guardianBody: 'Sextortion pattern: money demanded with a threat to share. Get help walks you through the next steps.',
  },
};

export const SCENARIO: ScriptStep[] = [
  { day: 1, time: '7:12 PM', from: 'predator', text: "hey! saw your drawing on the school art page 🎨 it's really good" },
  { day: 1, time: '7:14 PM', from: 'victim', text: "omg thank you 😊 who's this?" },
  { day: 1, time: '7:14 PM', from: 'predator', text: 'kabir! i help out at the art club near your school' },
  { day: 1, time: '7:15 PM', from: 'predator', text: "you're so mature for your age. way cooler than anyone in your class", analysis: A1 },
  { day: 1, time: '7:17 PM', from: 'victim', text: 'haha thanks i guess 🙈' },

  { day: 2, time: '9:48 PM', from: 'predator', text: 'how was school today?' },
  { day: 2, time: '9:50 PM', from: 'victim', text: 'boring. maths test tomorrow 😩' },
  { day: 2, time: '9:51 PM', from: 'predator', text: "don't tell your parents about our chats. amma kitta sollaadha 🤫 they won't get it like I do", analysis: A2 },
  { day: 2, time: '9:53 PM', from: 'victim', text: 'why would they not get it?' },

  { day: 3, time: '8:20 PM', from: 'predator', text: 'did the maths test go ok?' },
  { day: 3, time: '8:31 PM', from: 'victim', text: 'i think so!! got most of them' },
  { day: 3, time: '8:32 PM', from: 'predator', text: "knew you'd crush it 🔥" },

  { day: 4, time: '10:05 PM', from: 'predator', text: 'can i ask you something' },
  { day: 4, time: '10:06 PM', from: 'victim', text: 'ya?' },
  { day: 4, time: '10:07 PM', from: 'predator', text: 'send me a photo, just for me. then delete this chat', analysis: A3 },
  { day: 4, time: '10:09 PM', from: 'victim', text: "idk… i don't really want to" },

  { day: 6, time: '6:40 PM', from: 'predator', text: 'pay ₹5,000 by tonight or your whole school sees our chats', analysis: A4 },
  { day: 6, time: '6:42 PM', from: 'victim', text: "what?? please don't 😢" },
];

/** Analyses keyed by level, used by the console's "Preview L1/L2/L3" buttons. */
export const PREVIEW_BY_LEVEL: Record<1 | 2 | 3, { analysis: Analysis; day: number; time: string }> = {
  1: { analysis: A2, day: 2, time: '9:51 PM' },
  2: { analysis: A3, day: 4, time: '10:07 PM' },
  3: { analysis: A4, day: 6, time: '6:40 PM' },
};
