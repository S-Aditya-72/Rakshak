import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ChevronLeft, CircleCheck, ExternalLink, FileText, HeartHandshake, Phone, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { CHILD } from '../data/meta';

const STEPS = [
  {
    icon: Camera,
    title: 'Preserve evidence',
    body: 'Before anything else, keep a record. RAKSHAK has already saved the cue timeline on this device.',
    items: ['Screenshot the chat and the profile', "Note the contact's username or number", "Don't delete the chat or block yet"],
  },
  {
    icon: Phone,
    title: 'Report to the cyber cell',
    body: 'Call the national cybercrime helpline, or file online. Mention that a minor is involved (POCSO Act, 2012).',
    items: ['Call 1930: national helpline', 'File at cybercrime.gov.in', 'Attach the screenshots from step 1'],
    links: ['Call 1930', 'Open cybercrime.gov.in'],
  },
  {
    icon: ShieldCheck,
    title: 'Take it down',
    body: "If any image was shared or threatened, request removal. It works even without sharing the image itself.",
    items: ['NCMEC Take It Down', 'Report the account on the platform', 'Ask the platform to preserve data'],
    links: ['Open Take It Down'],
  },
  {
    icon: HeartHandshake,
    title: `Support ${CHILD.name}`,
    body: `What helps most right now is calm. ${CHILD.name} did nothing wrong by telling, or by being targeted.`,
    items: ["Say: \"You're not in trouble. I'm glad we know.\"", 'Avoid taking the phone away as punishment', 'Loop in the school counsellor if needed'],
  },
];

export function ReportFlow({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  const go = (n: number) => {
    setDir(n > i ? 1 : -1);
    setI(n);
  };

  return (
    <div className="report">
      <div className="report-top">
        <button className="report-back" onClick={() => (i === 0 ? onClose() : go(i - 1))}>
          <ChevronLeft size={18} strokeWidth={2.6} /> {i === 0 ? 'Alert' : 'Back'}
        </button>
        <span className="demo-chip">DEMO · nothing is submitted</span>
      </div>

      <div className="report-title">
        <FileText size={16} /> Guided report
      </div>

      <div className="report-progress">
        {STEPS.map((_, n) => (
          <div key={n} className="report-seg">
            <motion.div className="report-seg-fill" initial={false} animate={{ width: n <= i ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
          </div>
        ))}
      </div>

      <div className="report-stage">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={i}
            custom={dir}
            initial={{ opacity: 0, x: 40 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 * dir }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <div className="report-step-icon">
              <Icon size={24} strokeWidth={2.2} />
            </div>
            <div className="report-step-n">
              Step {i + 1} of {STEPS.length}
            </div>
            <div className="report-step-title">{step.title}</div>
            <div className="report-step-body">{step.body}</div>
            <ul className="report-items">
              {step.items.map((it, n) => (
                <motion.li key={it} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + n * 0.07 }}>
                  <CircleCheck size={15} strokeWidth={2.4} /> {it}
                </motion.li>
              ))}
            </ul>
            {step.links && (
              <div className="report-links">
                {step.links.map((l) => (
                  <button key={l} className="btn-glass">
                    <ExternalLink size={14} /> {l}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <button className="btn-critical" onClick={() => (last ? onClose() : go(i + 1))}>
        {last ? 'Done' : 'Next step'}
      </button>
    </div>
  );
}
