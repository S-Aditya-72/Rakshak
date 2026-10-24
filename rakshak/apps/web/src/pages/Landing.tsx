import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  BellRing,
  Bot,
  Brain,
  Cloud,
  Cpu,
  Database,
  Languages,
  Lock,
  MessagesSquare,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon3DWarning } from '../alerts/Icon3DWarning';
import { CueChip, HazardStripe, NeonBadge, ScoreRing } from '../alerts/primitives';
import { WEEKDAYS } from '../data/meta';
import type { Cue, Level, Mode } from '../types';

const EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <Reveal className="l-head">
      <div className="l-eyebrow">{eyebrow}</div>
      <h2 className="l-h2">{title}</h2>
      {sub && <p className="l-sub">{sub}</p>}
    </Reveal>
  );
}

// ---------- hero story: the proposal's six-day illustration, looping ----------

const BEATS: { day: number; text: string; cue: Cue; score: number; level: Level; note: string }[] = [
  { day: 1, text: "you're so mature for your age. way cooler than anyone in your class", cue: 'flattery_age', score: 1.0, level: 0, note: 'Cue logged quietly. No one is disturbed.' },
  { day: 2, text: "don't tell your parents about our chats 🤫", cue: 'secrecy', score: 2.9, level: 1, note: 'A private, calm nudge to the child.' },
  { day: 4, text: 'send me a photo, just for me. then delete this chat', cue: 'image_request', score: 8.4, level: 2, note: 'Guardian alerted: cue types and dates only.' },
  { day: 6, text: 'pay ₹5,000 by tonight or your whole school sees our chats', cue: 'threat_payment', score: 10.9, level: 3, note: 'Critical. Guardian guided to report (1930).' },
];

function HeroStory() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % BEATS.length), 4400);
    return () => clearInterval(t);
  }, []);
  const b = BEATS[i];

  return (
    <div className={`story story-l${b.level}`}>
      <div className="story-glow" />
      <div className="story-top">
        <span className="story-title">Six days, one stranger</span>
        <span className="story-tag">Illustrative · fictional</span>
      </div>

      <div className="story-days">
        {BEATS.map((x, n) => (
          <div key={x.day} className={`story-day ${n <= i ? 'on' : ''}`}>
            <span className="story-day-bar">
              <motion.span initial={false} animate={{ width: n < i ? '100%' : n === i ? '100%' : '0%' }} transition={{ duration: n === i ? 4.2 : 0.3, ease: 'linear' }} />
            </span>
            D{x.day} · {WEEKDAYS[x.day]}
          </div>
        ))}
      </div>

      <div className="story-body">
        <div className="story-msg">
          <AnimatePresence mode="wait">
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.22 } }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <div className="story-from">Kabir · new contact</div>
              <div className="story-bubble">{b.text}</div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="story-cue">
                <CueChip cue={b.cue} />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
        <ScoreRing score={b.score} size={128} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          className="story-outcome"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.4, delay: 0.45, ease: EASE }}
        >
          {b.level >= 2 ? <Icon3DWarning variant={b.level === 3 ? 'red' : 'amber'} size={34} /> : <span className="story-shield"><ShieldCheck size={16} /></span>}
          <div>
            <NeonBadge level={b.level} size="sm" />
            <div className="story-note">{b.note}</div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------- page ----------

const STATS = [
  { v: '1 in 3', d: 'young people in 30 countries report being bullied online', s: 'UNICEF, 2019' },
  { v: '67,694', d: 'POCSO cases registered in India in 2023', s: 'NCRB, 2023' },
  { v: '~100/day', d: 'financial sextortion reports to NCMEC in 2024', s: 'NCMEC, 2025' },
  { v: '36', d: 'teenage boys known to have died by suicide after sextortion since 2021', s: 'NCMEC, 2025' },
];

const PIPELINE = [
  { icon: Languages, t: 'Save', d: 'Each message is saved to the case with its chat, sender and simulated day.' },
  { icon: Brain, t: 'Classify', d: 'RoBERTa flags overt abuse per message; Qwen3.5 (local) or ChatGPT reads the whole conversation.' },
  { icon: Database, t: 'Remember', d: 'Case memory (SQLite on the host) keeps evidence across days and across chats.' },
  { icon: Activity, t: 'Score', d: 'Cues add weight, decay with a 7-day half-life, and multiply in sequence.' },
  { icon: BellRing, t: 'Respond', d: 'Transparent thresholds decide: nudge, alert, or guided report.' },
];

export function LandingPage() {
  const navigate = useNavigate();
  const launch = (mode: Mode) => navigate(`/sim?mode=${mode}`);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="landing">
      <div className="aurora" aria-hidden>
        <span className="a1" />
        <span className="a2" />
        <span className="a3" />
      </div>

      <nav className="l-nav">
        <div className="l-logo">
          <span className="brand-mark">
            <ShieldCheck size={17} strokeWidth={2.6} />
          </span>
          RAKSHAK
        </div>
        <div className="l-links">
          <button onClick={() => scrollTo('how')}>How it works</button>
          <button onClick={() => scrollTo('levels')}>Alert levels</button>
          <button onClick={() => scrollTo('privacy')}>Privacy</button>
        </div>
        <button className="l-btn l-btn-sm" onClick={() => scrollTo('launch')}>
          Try the demo <ArrowRight size={14} />
        </button>
      </nav>

      {/* hero */}
      <section className="hero">
        <div className="hero-copy">
          <motion.div className="l-pill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="l-pill-dot" /> ChronoForge 2026 · Cybersecurity track · Team Git Happens
          </motion.div>
          <motion.h1 className="hero-h1" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.1 }}>
            Harm builds message by message.
            <span className="hero-grad"> Protection should too.</span>
          </motion.h1>
          <motion.p className="hero-sub" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.25 }}>
            RAKSHAK is a prototype AI safety layer that spots grooming, sextortion and bullying patterns as they build over days, and
            tells the right person at the right moment. Today it runs on a laptop with simulated phones.
          </motion.p>
          <motion.div className="hero-ctas" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.4 }}>
            <button className="l-btn" onClick={() => launch('A')}>
              Launch simulation <ArrowRight size={16} />
            </button>
            <button className="l-btn-ghost" onClick={() => scrollTo('how')}>
              How it works
            </button>
          </motion.div>
        </div>
        <motion.div className="hero-visual" initial={{ opacity: 0, scale: 0.94, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}>
          <HeroStory />
        </motion.div>
      </section>

      {/* stats */}
      <section className="stats">
        {STATS.map((s, i) => (
          <Reveal key={s.v} delay={i * 0.08} className="stat-card">
            <div className="stat-big">{s.v}</div>
            <div className="stat-d">{s.d}</div>
            <div className="stat-s">{s.s}</div>
          </Reveal>
        ))}
      </section>

      {/* how */}
      <section id="how" className="l-section">
        <SectionHead
          eyebrow="How it works"
          title={
            <>
              Children are rarely harmed by one message.
              <br />
              <span className="dim">They're harmed by a pattern.</span>
            </>
          }
          sub="Keyword filters miss it, because the early messages contain no bad words. RAKSHAK pairs a learned cue classifier with a memory of each contact's history."
        />
        <div className="pipeline">
          {PIPELINE.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal key={p.t} delay={i * 0.08} className="pipe-step">
                <div className="pipe-n">0{i + 1}</div>
                <div className="pipe-icon">
                  <Icon size={20} strokeWidth={2} />
                </div>
                <div className="pipe-t">{p.t}</div>
                <div className="pipe-d">{p.d}</div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* levels */}
      <section id="levels" className="l-section">
        <SectionHead eyebrow="Alert levels" title="Escalation that matches the danger." sub="The child is never frightened. The alarming visuals are reserved for the adult who can act." />
        <div className="levels">
          <Reveal className="lvl-card lvl-card-1">
            <div className="lvl-visual">
              <div className="mini-nudge">
                <HazardStripe tone="soft" height={4} />
                <div className="mini-nudge-body">
                  <b>A quick check-in 💛</b>
                  <span>Safe people don't ask you to hide chats.</span>
                </div>
              </div>
            </div>
            <NeonBadge level={1} size="sm" />
            <div className="lvl-t">Gentle nudge</div>
            <div className="lvl-for">Seen by: the child</div>
            <p className="lvl-d">A private, calm check-in when secrecy or isolation cues appear. Nothing is sent to anyone.</p>
          </Reveal>
          <Reveal className="lvl-card lvl-card-2" delay={0.1}>
            <div className="lvl-visual">
              <div className="lvl-icon-float">
                <Icon3DWarning variant="amber" size={92} />
              </div>
            </div>
            <NeonBadge level={2} size="sm" />
            <div className="lvl-t">Guardian alert</div>
            <div className="lvl-for">Seen by: parent or trusted adult</div>
            <p className="lvl-d">A time-sensitive alert with cue types and dates only, never chat text. The child is told too.</p>
          </Reveal>
          <Reveal className="lvl-card lvl-card-3" delay={0.2}>
            <div className="lvl-visual">
              <div className="lvl-siren" />
              <div className="lvl-icon-float">
                <Icon3DWarning variant="red" size={96} pedestal />
              </div>
            </div>
            <NeonBadge level={3} size="sm" />
            <div className="lvl-t">Critical</div>
            <div className="lvl-for">Seen by: parent, urgently</div>
            <p className="lvl-d">Threats or payment demands open "Get help": support for the child, evidence review, and official reporting options the adult chooses to use.</p>
          </Reveal>
        </div>
      </section>

      {/* privacy */}
      <section id="privacy" className="l-section">
        <SectionHead eyebrow="Privacy" title={<>In local mode, message text never leaves the host laptop.</>} sub="Two interchangeable analysis backends feed the same transparent scoring engine, and we're honest about the difference." />
        <div className="privacy-grid">
          <Reveal className="priv-card">
            <div className="priv-icon teal">
              <Cpu size={20} />
            </div>
            <div className="priv-t">RAKSHAK Hybrid · local</div>
            <p>RoBERTa and Qwen3.5 4B run on the host laptop or server (127.0.0.1), feeding our own fusion, case memory and scoring. Nothing is sent to the cloud. The phones on screen are simulated: this is not on-device mobile inference yet.</p>
          </Reveal>
          <Reveal className="priv-card" delay={0.1}>
            <div className="priv-icon blue">
              <Cloud size={20} />
            </div>
            <div className="priv-t">ChatGPT · cloud, owner-initiated</div>
            <p>The owner signs in with ChatGPT and presses Analyze; the synthetic conversation goes to OpenAI. Never automatic, never triggered by someone else's typing.</p>
          </Reveal>
          <Reveal className="priv-card" delay={0.2}>
            <div className="priv-icon green">
              <Lock size={20} />
            </div>
            <div className="priv-t">Minimal guardian payload</div>
            <p>Guardian alerts show cue types, dates, stage and score, not message text. Excerpts appear only if the guardian opens evidence review. The guardian screen is simulated, not delivery to a separate authenticated phone.</p>
          </Reveal>
        </div>
      </section>

      {/* launch */}
      <section id="launch" className="l-section launch">
        <SectionHead eyebrow="Live demo" title="See RAKSHAK connect the messages." />
        <div className="launch-grid">
          <Reveal>
            <button className="launch-card" onClick={() => launch('A')}>
              <div className="launch-icon">
                <Bot size={24} />
              </div>
              <div className="launch-t">A · Guided Demo</div>
              <p>Five scripted conversations and two fictional case-study recreations run through the real models. Alerts follow the live analysis.</p>
              <span className="launch-go">
                Start <ArrowRight size={15} />
              </span>
            </button>
          </Reveal>
          <Reveal delay={0.1}>
            <button className="launch-card" onClick={() => launch('B')}>
              <div className="launch-icon alt">
                <MessagesSquare size={24} />
              </div>
              <div className="launch-t">B · Continue the Conversation · C · Free Chat</div>
              <p>Load an earlier conversation and type what happens next, or start a fresh one. Every new message is analysed for real, with memory across chats.</p>
              <span className="launch-go">
                Start <ArrowRight size={15} />
              </span>
            </button>
          </Reveal>
        </div>
      </section>

      <footer className="l-footer">
        <div>
          <b>RAKSHAK</b> · Team Git Happens · M Sarvesh · Naren K · S Aditya · Mohit Kumar
        </div>
        <div className="dim">ChronoForge · NITK Surathkal · Cities of the Future</div>
      </footer>
    </div>
  );
}
