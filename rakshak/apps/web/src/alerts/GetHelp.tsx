// Guardian "Get help" workflow, opened from an L2/L3 alert. Help comes before complaint preparation:
// 1 Understand the concern · 2 Support the child · 3 Review & export evidence · 4 Complaint options.
//
// It always works on the selected alert's own case (caseKey). If that case is no longer loaded it says so and
// shows nothing from any other case. Nothing here contacts anyone, blocks a real account or submits a complaint.
//
// On a guardian's phone (Android app) the panel works from the alert summary only: that phone never receives the
// child's messages or the model's output, so evidence review stays on the child's phone and the laptop.

import { AnimatePresence, motion } from 'framer-motion';
import { Ban, Check, CircleAlert, Download, ExternalLink, FileText, HeartHandshake, Info, Lock, MessageCircleHeart, Phone, Scale, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BACKEND_META, CUE_META, LEVEL_META, WEEKDAYS } from '../data/meta';
import { REPORTING, SUPPORT, type Resource } from '../data/resources';
import { buildExport, defaultRules, download, newReportId, reportItems, toHtml, toJson, type ReportItem } from '../lib/report';
import { isGuardianDevice, useDevice } from '../lib/device';
import { openExternal } from '../lib/native';
import { caseKeyFor, childNameOf, recordBlock, respond, useDemo, type HelpTab } from '../store';
import type { AlertItem, ResponseKind } from '../types';
import { NeonBadge } from './primitives';

const TABS: { id: HelpTab; label: string; icon: typeof Info }[] = [
  { id: 'understand', label: 'Understand', icon: Info },
  { id: 'support', label: 'Support', icon: HeartHandshake },
  { id: 'evidence', label: 'Evidence & report', icon: FileText },
  { id: 'complaint', label: 'Complaint options', icon: Scale },
];

export function GetHelp() {
  const alert = useDemo((s) => s.data.helpFor);
  return <AnimatePresence>{alert && <HelpPanel key={alert.id} alert={alert} />}</AnimatePresence>;
}

function HelpPanel({ alert }: { alert: AlertItem }) {
  const dispatch = useDemo((s) => s.dispatch);
  const d = useDemo((s) => s.data);
  const tab = d.helpTab;
  const setTab = (t: HelpTab) => dispatch({ type: 'openHelp', alert, tab: t });
  const sameCase = !alert.preview && alert.caseKey === caseKeyFor(d);
  const child = alert.childName ?? childNameOf(d);
  const summaryOnly = isGuardianDevice();

  return (
    <motion.div className="help-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => dispatch({ type: 'closeHelp' })}>
      <motion.div
        className="help"
        role="dialog"
        aria-label="Get help"
        initial={{ y: 30, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <div>
            <div className="help-kicker">
              <ShieldCheck size={13} /> Get help · guardian view · synthetic demo
            </div>
            <div className="help-title">
              <NeonBadge level={alert.level} size="sm" /> {alert.guardianTitle}
            </div>
            <div className="help-sub">
              About {child} · Day {alert.day} · {alert.time}
              {alert.historical ? ' · found while analysing earlier history' : ''}
            </div>
          </div>
          <button className="sheet-x" onClick={() => dispatch({ type: 'closeHelp' })} aria-label="Close">
            <X size={15} strokeWidth={2.6} />
          </button>
        </div>

        <div className="help-tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={`help-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              <span className="help-tab-n">{i + 1}</span> <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="help-body">
          {!sameCase && (
            <div className="help-warn">
              <CircleAlert size={15} />
              {alert.preview
                ? 'This is a design preview alert with precomputed values. It has no case evidence behind it; only the general guidance below applies.'
                : 'This alert belongs to an earlier case that is no longer loaded (the case was reset or replaced). Its evidence is not shown, and nothing from the current case is substituted.'}
            </div>
          )}
          {tab === 'understand' && <Understand alert={alert} sameCase={sameCase} child={child} summaryOnly={summaryOnly} />}
          {tab === 'support' && <Support alert={alert} sameCase={sameCase} child={child} />}
          {tab === 'evidence' &&
            (summaryOnly ? (
              <SummaryOnly child={child} />
            ) : sameCase ? (
              <Evidence alert={alert} child={child} />
            ) : (
              <p className="help-p">Evidence review needs the alert's own case to be loaded.</p>
            ))}
          {tab === 'complaint' && <Complaint alert={alert} onReport={() => setTab('evidence')} onDone={() => dispatch({ type: 'closeHelp' })} />}
        </div>
        <div className="help-foot">
          <Lock size={12} /> Status: <b>Not submitted</b>. RAKSHAK does not contact anyone, block real accounts or submit complaints. AI findings are not a legal determination.
        </div>
      </motion.div>
    </motion.div>
  );
}

// ---------- 1. Understand ----------

/** Evidence behind the alert when it fired; optionally also findings added to the same track (same case) since. */
function useAlertEvidence(alert: AlertItem, sameCase: boolean, includeLater = false) {
  const d = useDemo((s) => s.data);
  return useMemo(() => {
    if (!sameCase) return { items: [] as ReportItem[], track: null, later: 0 };
    const track = d.risk?.tracks.find((t) => t.key === alert.trackKey) ?? null;
    const own = new Set(alert.evidenceKeys ?? []);
    const laterKeys = (track?.cues ?? []).map((c) => c.evidenceKey).filter((k) => !own.has(k));
    const scope = includeLater ? { ...alert, evidenceKeys: [...own, ...laterKeys] } : alert;
    const items = reportItems(scope, d.evidence, d.messages, d.participants, d.conversations, d.childId);
    return { items, track, later: laterKeys.length };
  }, [alert, sameCase, includeLater, d.evidence, d.messages, d.participants, d.conversations, d.childId, d.risk]);
}

/** A guardian's phone holds the alert summary only: what was detected and when, never the messages. */
function SummaryOnly({ child }: { child: string }) {
  return (
    <section className="help-card wide">
      <h3>
        <Lock size={15} /> Evidence stays on {child}'s phone
      </h3>
      <p className="help-p">
        This phone receives alert summaries only: cue types, days and the risk level. {child}'s messages and the AI's reading of them are never sent here.
      </p>
      <p className="help-p muted">
        To review excerpts and make a redacted report, open Get help for this alert on the RAKSHAK laptop, or go through {child}'s phone together with {child}.
      </p>
    </section>
  );
}

function Understand({ alert, sameCase, child, summaryOnly }: { alert: AlertItem; sameCase: boolean; child: string; summaryOnly: boolean }) {
  const { items, track } = useAlertEvidence(alert, sameCase);
  const backend = useDemo((s) => s.data.backend);
  const findings = items.flatMap((i) => i.findings.map((f) => ({ ...f, ref: i.messageId, fromChild: i.fromChild })));
  const days = items.map((i) => i.day);
  const chats = [...new Set(items.map((i) => i.conversationTitle))];
  const accounts = [...new Set(items.filter((i) => !i.fromChild).map((i) => i.senderName))];
  const review = findings.filter((f) => f.status === 'needs_review').length;
  const disagree = findings.filter((f) => f.agreement === 'needs_review').length;
  const override = findings.filter((f) => f.agreement === 'context_override').length;

  return (
    <div className="help-grid">
      <section className="help-card wide">
        <h3>The concern</h3>
        <p className="help-p">{alert.guardianBody}</p>
        {sameCase && items.length > 0 && (
          <p className="help-p muted">
            {items.length} recorded message{items.length === 1 ? '' : 's'} in {chats.length} chat{chats.length === 1 ? '' : 's'} ({chats.join(', ')}), simulated day{days.length > 1 ? 's' : ''} {Math.min(...days)}
            {Math.max(...days) !== Math.min(...days) ? `–${Math.max(...days)}` : ''}. Reported account{accounts.length === 1 ? '' : 's'}: {accounts.join(', ') || 'none'}.
          </p>
        )}
      </section>

      {summaryOnly ? (
        <section className="help-card">
          <h3>
            <span className="help-tag tag-rec">What was detected</span>
          </h3>
          <ul className="help-list">
            {alert.cues.map((c, n) => (
              <li key={n}>
                {CUE_META[c.cue]?.label ?? c.cue} · Day {c.day} {WEEKDAYS[c.day] ?? ''}
              </li>
            ))}
          </ul>
          <p className="help-note">Message text and the AI's interpretations stay on {child}'s phone.</p>
        </section>
      ) : (
        <>
      <section className="help-card">
        <h3>
          <span className="help-tag tag-rec">Recorded messages</span>
        </h3>
        {sameCase ? (
          <ul className="help-list">
            {items.map((i, n) => (
              <li key={i.messageId}>
                <b>E{n + 1}</b> · {i.conversationTitle} · {i.fromChild ? `${child} (the child)` : i.senderName} · Day {i.day} {WEEKDAYS[i.day] ?? ''} · {i.time}
              </li>
            ))}
          </ul>
        ) : (
          <p className="help-p muted">Not available for this alert.</p>
        )}
        <p className="help-note">Message text is not shown here. Open “Evidence & report” to review excerpts.</p>
      </section>

      <section className="help-card">
        <h3>
          <span className="help-tag tag-ai">AI interpretations</span>
        </h3>
        {sameCase ? (
          <ul className="help-list">
            {findings.map((f, n) => (
              <li key={n}>
                {CUE_META[f.cue as keyof typeof CUE_META]?.label ?? f.cue} · {f.status.replace('_', ' ')} · {f.agreement.replace('_', ' ')}
                {f.modifier !== 'none' ? ` · ${f.modifier}` : ''}
                {f.fromChild ? ' · child’s own message (not scored)' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="help-p muted">Not available for this alert.</p>
        )}
        <p className="help-note">
          From {BACKEND_META[backend].label}. Models can be wrong.
          {review || disagree || override ? ` Uncertainty: ${review} finding${review === 1 ? '' : 's'} need review, ${disagree} where the two models disagreed, ${override} overridden by context.` : ''}
        </p>
      </section>
        </>
      )}

      <section className="help-card">
        <h3>
          <span className="help-tag tag-det">Deterministic risk level</span>
        </h3>
        <p className="help-p">
          <b style={{ color: LEVEL_META[alert.level].color }}>
            {LEVEL_META[alert.level].short} · {LEVEL_META[alert.level].label}
          </b>{' '}
          · score {alert.score.toFixed(1)} · {alert.category}
        </p>
        {track && (
          <ul className="help-list mono">
            {track.trace.slice(-5).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        <p className="help-note">Computed by RAKSHAK’s fixed rules from the evidence: prototype thresholds, not a validated probability.</p>
      </section>
    </div>
  );
}

// ---------- 2. Support ----------

function Support({ alert, sameCase, child }: { alert: AlertItem; sameCase: boolean; child: string }) {
  const d = useDemo((s) => s.data);
  const { items } = useAlertEvidence(alert, sameCase);
  const [guide, setGuide] = useState(true);
  const [blocked, setBlocked] = useState<string[]>([]);
  const bullying = alert.category === 'bullying';
  const payment = alert.cues.some((c) => c.cue === 'threat_payment');
  // From the evidence; on a guardian's phone (no evidence there) the contact named in the alert itself.
  const fromEvidence = [...new Map(items.filter((i) => !i.fromChild).map((i) => [i.senderId, i.senderName])).entries()];
  const contact = alert.contactId ? d.participants.find((p) => p.id === alert.contactId) : undefined;
  const accounts = fromEvidence.length ? fromEvidence : contact ? [[contact.id, contact.displayName] as [string, string]] : [];
  const temporary = useDevice((s) => s.role === 'temp') && isGuardianDevice();
  const caseHere = sameCase || isGuardianDevice();
  const onPhone = isGuardianDevice();

  return (
    <div className="help-grid">
      <section className="help-card wide">
        <h3>
          <MessageCircleHeart size={15} /> Talk to {child}
        </h3>
        <button className="chip-btn" onClick={() => setGuide((v) => !v)}>
          {guide ? 'Hide' : 'Show'} conversation guide
        </button>
        {guide && (
          <ul className="help-list">
            <li>Start with reassurance: “You’re not in trouble. I’m glad I know, and we’ll sort this out together.”</li>
            <li>Listen first. Let {child} tell it in their own words; avoid “why did you…” questions.</li>
            <li>Ask what would help: “What would you like to happen next? Who would you like involved?”</li>
            <li>Don’t take the phone away as a punishment. It can stop children telling you next time.</li>
            <li>Agree next steps together, and check in again tomorrow.</li>
          </ul>
        )}
        <LogButton kind="guardian_talk" alert={alert} label={`Send ${child} a check-in`} doneLabel={`Check-in sent to ${child}`} disabled={!caseHere} />
        <p className="help-note">The check-in appears on {child}'s phone as a note from you; {child} can answer with one tap.</p>
      </section>

      <section className="help-card">
        <h3>Practical next steps</h3>
        <ul className="help-list">
          {bullying ? (
            <>
              <li>Save the messages before anything is deleted (Evidence & report can make a dated, redacted copy).</li>
              <li>Don’t reply to or retaliate against the people involved.</li>
              <li>With {child}’s agreement, talk to the class teacher or school counsellor.</li>
              <li>Use the app’s own report and block tools for the accounts involved.</li>
              <li>If anyone threatens {child}’s safety, contact the police or call 112 in an emergency.</li>
            </>
          ) : (
            <>
              {payment && <li>Don’t pay, and don’t negotiate. Paying rarely stops the demands.</li>}
              <li>Don’t delete the chat or the account’s profile: save evidence first.</li>
              <li>Stop replying to the account after evidence is saved; then block and report it in the app.</li>
              {payment && <li>If money was already paid, call 1930 promptly.</li>}
              <li>If images were taken when {child} was under 18, see Take It Down under Complaint options.</li>
            </>
          )}
        </ul>
      </section>

      {!temporary && (
      <section className="help-card">
        <h3>
          <Ban size={15} /> Block contact
        </h3>
        <p className="help-p muted">To block on a real platform, use that app’s block and report tools. This prototype is not connected to any platform.</p>
        {accounts.length === 0 && <p className="help-note">No reported account in this alert’s evidence.</p>}
        {accounts.map(([id, name]) => {
          const done = blocked.includes(id) || d.blocks.some((b) => b.contactId === id);
          return (
            <button
              key={id}
              className="chip-btn"
              disabled={done || !caseHere}
              onClick={() => {
                recordBlock(id, alert.id);
                setBlocked((v) => [...v, id]);
              }}
            >
              <Ban size={12} /> {done ? (onPhone ? `${name} blocked` : `Recorded: ${name} blocked in the simulator`) : onPhone ? `Block ${name}` : `Block ${name} (simulator only)`}
            </button>
          );
        })}
        <p className="help-note">
          {onPhone
            ? `Blocks ${accounts[0]?.[1] ?? 'the contact'} in the RAKSHAK demo messenger on every phone: their messages stop reaching ${child}. No account on any other app is affected.`
            : 'A simulator block only changes this demo case (a new account after a block is flagged for review). No real account is blocked.'}
        </p>
      </section>
      )}

      <section className="help-card wide">
        <h3>
          <Phone size={15} /> Counsellor and helplines
        </h3>
        <p className="help-p muted">No counsellor service is connected to this prototype, and nobody has been contacted. Contact the school counsellor directly, or:</p>
        <ResourceList items={SUPPORT} />
        <LogButton kind="guardian_counsellor" alert={alert} label="Note: counsellor looped in" doneLabel="Noted in the case" disabled={!caseHere} />
      </section>
    </div>
  );
}

/** A helpline number: on a phone, tapping it opens the dialer with the number filled in. */
function HelpNumber({ value }: { value: string }) {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{3,}$/.test(digits)) return <span className="help-num">{value}</span>;
  return (
    <a className="help-num" href={`tel:${digits}`} onClick={(e) => (e.preventDefault(), openExternal(`tel:${digits}`))}>
      {value}
    </a>
  );
}

function ResourceList({ items }: { items: Resource[] }) {
  return (
    <ul className="help-res">
      {items.map((r) => (
        <li key={r.name}>
          <b>{r.name}</b>
          {r.contact ? <HelpNumber value={r.contact} /> : null} · {r.what}{' '}
          <a href={r.source.url} target="_blank" rel="noopener noreferrer">
            source <ExternalLink size={10} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------- 3. Evidence & report ----------

function Evidence({ alert, child }: { alert: AlertItem; child: string }) {
  const d = useDemo((s) => s.data);
  const [includeLater, setIncludeLater] = useState(false);
  const { items, later } = useAlertEvidence(alert, true, includeLater);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((i) => i.messageId)));
  useEffect(() => {
    // Newly included messages start selected; the guardian can untick them.
    setSelected((v) => new Set([...v, ...items.map((i) => i.messageId).filter((id) => !v.has(id))]));
  }, [includeLater]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [redact, setRedact] = useState(true);
  const [alias, setAlias] = useState('the protected child');
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const [reportId] = useState(() => newReportId());
  const [createdAt] = useState(() => new Date().toISOString());
  const days = items.map((i) => i.day);
  const accounts = [...new Set(items.filter((i) => !i.fromChild).map((i) => i.senderName))];
  const cues = [...new Set(items.flatMap((i) => i.findings.filter((f) => f.status === 'active' || f.status === 'needs_review').map((f) => f.label)))];
  const [summary, setSummary] = useState(
    () =>
      `Between simulated day ${days.length ? Math.min(...days) : '?'} and day ${days.length ? Math.max(...days) : '?'}, the RAKSHAK prototype flagged ${items.length} message${items.length === 1 ? '' : 's'} involving ${child}` +
      `${accounts.length ? ` from ${accounts.join(', ')}` : ''}${cues.length ? ` (suspected behaviour: ${cues.join(', ').toLowerCase()})` : ''}. AI interpretations may be wrong and need human review.`,
  );
  const rules = useMemo(
    () =>
      defaultRules(
        child,
        d.childId,
        alias || 'the protected child',
        extra.split(',').map((s) => s.trim()),
      ),
    [child, d.childId, alias, extra],
  );
  const doc = useMemo(
    () =>
      buildExport({
        reportId,
        createdAt,
        alert,
        items,
        selected,
        edits,
        redact,
        rules,
        alias: alias || 'the protected child',
        childName: child,
        childId: d.childId,
        summary,
        notes,
        backendLabel: `${BACKEND_META[d.backend].label} (${BACKEND_META[d.backend].where})`,
        models: [...new Set(d.messages.flatMap((m) => (m.analysis?.run ? [m.analysis.run.models.contextual, m.analysis.run.models.classifier] : [])).filter((x): x is string => !!x))],
        caseKey: caseKeyFor(d),
      }),
    [reportId, createdAt, alert, items, selected, edits, redact, rules, alias, child, d, summary, notes],
  );
  const html = useMemo(() => toHtml(doc), [doc]);

  if (!open) {
    return (
      <div className="help-grid">
        <section className="help-card wide">
          <h3>Review evidence</h3>
          <p className="help-p">
            Guardian alerts deliberately leave out message text. Evidence review shows excerpts of the {items.length} message{items.length === 1 ? '' : 's'} behind this alert so you can choose what to keep in a report.
          </p>
          <p className="help-note">Nothing leaves this computer: the report is built in your browser and saved only if you download it.</p>
          <button className="btn-amber" onClick={() => setOpen(true)} disabled={items.length === 0}>
            <FileText size={15} /> Open evidence review
          </button>
          {items.length === 0 && <p className="help-note">No evidence rows are linked to this alert in the loaded case.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="help-ev">
      <div className="help-ev-left">
        <section className="help-card">
          <h3>1 · Choose messages</h3>
          {later > 0 && (
            <label className="help-check">
              <input type="checkbox" checked={includeLater} onChange={(e) => setIncludeLater(e.target.checked)} /> Include {later} finding{later === 1 ? '' : 's'} added to this case after the alert fired
            </label>
          )}
          {items.map((i, n) => (
            <div key={i.messageId} className={`help-item ${selected.has(i.messageId) ? 'on' : ''}`}>
              <label className="help-check">
                <input
                  type="checkbox"
                  checked={selected.has(i.messageId)}
                  onChange={() =>
                    setSelected((v) => {
                      const next = new Set(v);
                      next.has(i.messageId) ? next.delete(i.messageId) : next.add(i.messageId);
                      return next;
                    })
                  }
                />
                <b>E{n + 1}</b> · {i.fromChild ? `${child} (the child)` : i.senderName} · {i.conversationTitle} · Day {i.day} · {i.time}
              </label>
              <div className="help-orig">
                <span className="help-tag tag-rec">Recorded</span> “{i.text}”
              </div>
              <div className="help-ai">
                <span className="help-tag tag-ai">AI</span> {i.findings.map((f) => `${f.label} (${f.status.replace('_', ' ')}${f.modifier !== 'none' ? `, ${f.modifier}` : ''})`).join(' · ')}
              </div>
              {selected.has(i.messageId) && (
                <textarea
                  className="help-input"
                  rows={2}
                  aria-label="Text for the export copy"
                  placeholder="Optional: edit the text used in the export copy (the recorded message is unchanged)"
                  value={edits[i.messageId] ?? ''}
                  onChange={(e) => setEdits((v) => ({ ...v, [i.messageId]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </section>

        <section className="help-card">
          <h3>2 · Redaction</h3>
          <label className="help-check">
            <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} /> Redact known identifiers of {child}
          </label>
          <div className="help-row">
            <span>Alias</span>
            <input className="help-input" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} />
          </div>
          <div className="help-row">
            <span>Also hide</span>
            <input className="help-input" placeholder="school, street, nickname, handle (comma separated)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          <p className="help-note">
            Replaces {child}’s name and ID, the terms you add, and phone numbers, emails, links and @handles. Automated redaction may be incomplete: read the preview before sharing.
          </p>
          {!redact && <div className="help-warn">This copy is NOT redacted and will include identifying details.</div>}
        </section>

        <section className="help-card">
          <h3>3 · Summary and notes</h3>
          <textarea className="help-input" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Summary" />
          <textarea className="help-input" rows={2} placeholder="Your notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </section>
      </div>

      <div className="help-ev-right">
        <div className="help-preview-head">
          <span>
            4 · Preview <b>{doc.reportId}</b> · {doc.timeline.length} message{doc.timeline.length === 1 ? '' : 's'} · {doc.redacted ? 'redacted' : 'NOT redacted'} · Not submitted
          </span>
          <span className="pop-inline">
            <button className="chip-btn" onClick={() => download(`${doc.reportId}.html`, html, 'text/html;charset=utf-8')}>
              <Download size={12} /> HTML
            </button>
            <button className="chip-btn" onClick={() => download(`${doc.reportId}.json`, toJson(doc), 'application/json')}>
              <Download size={12} /> JSON
            </button>
          </span>
        </div>
        {/* The preview is the exact HTML that is downloaded, rendered in a sandbox with scripts disabled. */}
        <iframe className="help-preview" title="Report preview" sandbox="" srcDoc={html} />
        <p className="help-note">Printable HTML and structured JSON are generated from the same reviewed document. This is not certified evidence: keep the original messages on the device.</p>
      </div>
    </div>
  );
}

// ---------- 4. Complaint options ----------

/** A response recorded in the case and shown on every phone (the same as the alert's own buttons). */
function LogButton({ kind, alert, label, doneLabel, disabled }: { kind: ResponseKind; alert: AlertItem; label: string; doneLabel: string; disabled?: boolean }) {
  const done = useDemo((s) => s.data.responses.some((r) => r.kind === kind && r.alertId === alert.id));
  return (
    <button className="chip-btn" disabled={done || disabled} onClick={() => respond(kind, alert.id)}>
      {done && <Check size={12} />} {done ? doneLabel : label}
    </button>
  );
}

function Complaint({ alert, onReport, onDone }: { alert: AlertItem; onReport: () => void; onDone: () => void }) {
  const [which, setWhich] = useState<'standard' | 'anonymous' | 'portal'>('standard');
  const [answer, setAnswer] = useState<'yes' | 'no' | 'unsure' | null>(null);
  const payment = alert.cues.some((c) => c.cue === 'threat_payment');

  return (
    <div className="help-grid">
      <section className="help-card wide">
        <div className="help-choice">
          <button className={which === 'standard' ? 'on' : ''} onClick={() => setWhich('standard')}>
            Prepare a standard complaint
          </button>
          <button className={which === 'anonymous' ? 'on' : ''} onClick={() => setWhich('anonymous')}>
            Check anonymous reporting eligibility
          </button>
          <button className={which === 'portal' ? 'on' : ''} onClick={() => setWhich('portal')}>
            Open official reporting portal
          </button>
        </div>
      </section>

      {which === 'standard' && (
        <section className="help-card wide">
          <h3>Prepare a standard complaint</h3>
          <ul className="help-list">
            <li>Make the reviewed report first (Evidence & report). Keep the original messages and screenshots on the device.</li>
            <li>On the portal, complaints other than the anonymous categories use “Report and Track”, which asks for your name and contact details so the police can follow up and you can track progress.</li>
            <li>Include the reported account names exactly as they appear, the dates, and what was said or demanded. Describe “suspected behaviour”; you do not have to prove who is behind an account.</li>
            <li>Ask how {alert.childName ?? 'your child'}’s identity will be protected. {REPORTING.identity.what.split('. ').slice(0, 1).join('')}.</li>
            {payment && <li>If money was paid, also call {REPORTING.helpline1930.name.replace('National Cyber Crime Helpline ', '')} promptly.</li>}
          </ul>
          <button className="btn-amber" onClick={onReport}>
            <FileText size={15} /> Go to Evidence & report
          </button>
          <Sources list={[...REPORTING.portal.sources, REPORTING.identity.source]} />
        </section>
      )}

      {which === 'anonymous' && (
        <section className="help-card wide">
          <h3>Check anonymous reporting eligibility</h3>
          <p className="help-p">
            Eligibility depends on the kind of content, not on RAKSHAK’s risk level. Does this concern involve sexually explicit images or videos of a child, including a threat to share them?
          </p>
          <div className="help-choice small">
            {(['yes', 'no', 'unsure'] as const).map((a) => (
              <button key={a} className={answer === a ? 'on' : ''} onClick={() => setAnswer(a)}>
                {a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not sure'}
              </button>
            ))}
          </div>
          {answer === 'yes' && (
            <p className="help-p">
              The portal’s “Report Anonymously” option under “Report Women/Child Related Crime” is described for this kind of content. The portal decides what it accepts, so check the options shown there. An anonymous complaint cannot be tracked, and the police cannot contact you about it.
            </p>
          )}
          {answer === 'no' && (
            <p className="help-p">
              Anonymous reporting is described only for certain categories (child sexual abuse material, rape/gang-rape imagery, sexually explicit content). For bullying, harassment or threats without such content, use “Report and Track”, talk to the school, or contact the police. Asking for the child’s identity to be protected is still possible.
            </p>
          )}
          {answer === 'unsure' && (
            <p className="help-p">
              If you are not sure, you can call 1930 for help with lodging the complaint, or use “Report and Track”. Do not share or forward any explicit image to anyone, including to check it.
            </p>
          )}
          <div className="help-note">{REPORTING.anonymous.what}</div>
          <div className="help-note">
            Different things: an <b>anonymous complainant</b> (your identity is not given), a <b>redacted report copy</b> (identifiers hidden in a document you share), and <b>confidential handling of the child’s identity</b> (protected by law in media reports). Authorities may still need full details to act.
          </div>
          <Sources list={[...REPORTING.anonymous.sources, REPORTING.identity.source]} />
        </section>
      )}

      {which === 'portal' && (
        <section className="help-card wide">
          <h3>Open official reporting portal</h3>
          <p className="help-p">{REPORTING.portal.what}</p>
          <p className="help-p">
            <b>{REPORTING.helpline1930.name}:</b> {REPORTING.helpline1930.what}
          </p>
          <p className="help-p">
            <b>{REPORTING.takeItDown.name}:</b> {REPORTING.takeItDown.what}
          </p>
          <div className="pop-inline">
            <button className="chip-btn" onClick={() => openExternal('tel:1930') && respond('guardian_call', alert.id)}>
              <Phone size={12} /> Call 1930
            </button>
            <a className="btn-amber link-btn" href={REPORTING.portal.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> Open cybercrime.gov.in
            </a>
            <a className="chip-btn" href={REPORTING.takeItDown.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> Take It Down
            </a>
          </div>
          <p className="help-note">The link opens the official site in a new tab. No case data is attached or sent; you fill in the complaint yourself. RAKSHAK records the report as “Not submitted”.</p>
          <Sources list={[...REPORTING.portal.sources, ...REPORTING.helpline1930.sources, REPORTING.takeItDown.source]} />
        </section>
      )}

      {alert.level === 3 && (
        <section className="help-card wide">
          <h3>When you have done what you need to</h3>
          <p className="help-p muted">Closes the critical alert on every phone. The alert stays in the guardian's history and report.</p>
          <button
            className="chip-btn"
            onClick={() => {
              respond('report_done', alert.id);
              onDone();
            }}
          >
            <Check size={12} /> Mark as handled
          </button>
        </section>
      )}
    </div>
  );
}

function Sources({ list }: { list: { label: string; url: string }[] }): ReactNode {
  return (
    <div className="help-sources">
      Sources:{' '}
      {list.map((s, i) => (
        <span key={s.url + i}>
          {i > 0 && ' · '}
          <a href={s.url} target="_blank" rel="noopener noreferrer">
            {s.label}
          </a>
        </span>
      ))}
    </div>
  );
}
