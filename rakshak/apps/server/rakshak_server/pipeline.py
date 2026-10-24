"""Analysis orchestration: context retrieval -> models -> validation -> fusion -> evidence reconciliation.

Concurrency and staleness:
- Local runs are serialised (one GPU). A queued request is coalesced away if a newer request for the same
  conversation arrived meanwhile; the newer run's focus covers its messages.
- A run is applied only if the case generation (bumped on reset) is unchanged and no newer run for the same
  conversation has already been applied (watermark). Otherwise the result is returned marked `stale`.

Reconciliation (idempotent):
- Evidence rows have stable keys; re-analysing unchanged evidence updates rows in place.
- Rows on the focus messages that the new run does not reproduce are marked superseded.
- Rows on older messages change only when the model explicitly retracts them.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from .analyzers import AnalyzerError, ChatGPTAnalyzer, QwenAnalyzer
from .config import Settings
from .context import build_context
from .contract import CUE_CATEGORY, AnalysisError, AnalysisResult, AnalyzeRequest, ContextStats, Latency, RobertaScore
from .prompting import CUE_DEFINITIONS
from .db import Store
from .fusion import fuse
from .roberta import RobertaClassifier
from .validation import InvalidModelOutput, Validated, validate

log = logging.getLogger("rakshak.pipeline")


class AnalysisRejected(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class Pipeline:
    def __init__(self, settings: Settings, store: Store, roberta: Optional[RobertaClassifier], qwen: QwenAnalyzer, chatgpt: ChatGPTAnalyzer):
        self.s = settings
        self.store = store
        self.roberta = roberta
        self.qwen = qwen
        self.chatgpt = chatgpt
        self.locks = {"local_hybrid": asyncio.Lock(), "chatgpt_cloud": asyncio.Lock()}
        self.latest_requested: dict[tuple[str, str], int] = {}
        self.chatgpt_consent: Optional[float] = None

    async def analyze(self, req: AnalyzeRequest) -> dict:
        conv = self.store.conversation(req.conversation_id)
        if not conv:
            raise AnalysisRejected(404, "not_found", "Unknown conversation")
        if req.backend == "chatgpt_cloud":
            if req.trigger != "owner_button":
                raise AnalysisRejected(403, "owner_action_required", "ChatGPT analysis runs only from the owner's explicit 'Analyze with ChatGPT' action.")
            if not self.chatgpt_consent:
                raise AnalysisRejected(403, "consent_required", "Acknowledge the cloud-processing disclosure before using ChatGPT.")

        child_id = conv.child_id
        gen = self.store.generation(child_id)
        all_msgs = self.store.conversation_messages(conv.id)
        if not all_msgs:
            raise AnalysisRejected(400, "empty", "Conversation has no messages")
        if req.upto_message_id:
            upto = next((m for m in all_msgs if m.id == req.upto_message_id), None)
            if not upto:
                raise AnalysisRejected(404, "not_found", "Unknown message")
        else:
            upto = all_msgs[-1]
        k = (req.backend, conv.id)
        self.latest_requested[k] = max(self.latest_requested.get(k, 0), upto.seq)

        async with self.locks[req.backend]:
            if upto.seq < self.latest_requested.get(k, 0) and req.trigger == "auto":
                return self._stale(req, conv.id, child_id, "coalesced into a newer analysis of this conversation")
            watermark = self.store.watermark(conv.id, req.backend)
            if upto.seq < watermark:
                return self._stale(req, conv.id, child_id, "a newer analysis of this conversation was already applied")
            return await self._run(req, conv, child_id, gen, [m for m in all_msgs if m.seq <= upto.seq], watermark)

    def _stale(self, req: AnalyzeRequest, conv_id: str, child_id: str, why: str) -> dict:
        res = AnalysisResult(
            analysis_id=f"run-{uuid.uuid4().hex[:10]}", request_id=req.request_id, backend=req.backend, models={"contextual": None, "classifier": None},
            child_id=child_id, conversation_id=conv_id, analyzed_message_ids=[], focus_message_ids=[],
            latency=Latency(total_ms=0), context_stats=ContextStats(messages=0, related_evidence=0, approx_tokens=0, truncated=False),
            error=AnalysisError(code="stale", message=why), stale=True, created_at=_now(),
        )
        return {"result": res.dump(), "evidence": None, "firstSeen": None}

    async def _run(self, req, conv, child_id, gen, history, watermark) -> dict:
        t0 = time.perf_counter()
        run_id = f"run-{uuid.uuid4().hex[:10]}"
        backend = req.backend
        focus = [m for m in history if m.seq > watermark] or [history[-1]]
        focus_ids = [m.id for m in focus]

        participants = {p.id: p for p in self.store.participants(child_id)}
        child = participants[child_id]
        conv_titles = {c.id: c.title for c in self.store.conversations(child_id)}
        conv_ev = self.store.evidence(child_id, backend, conv.id)
        other_ev = [e for e in self.store.evidence(child_id, backend, statuses=("active", "needs_review")) if e.conversation_id != conv.id]
        all_by_id = {m.id: m for m in self.store.messages(child_id)}
        ctx = build_context(child, conv, participants, history, focus_ids, conv_ev, other_ev, all_by_id, conv_titles, self.s.context_token_budget, self.s.related_evidence_limit)

        warnings: list[str] = []
        if ctx.truncated:
            warnings.append(f"context: {ctx.omitted} older plain messages omitted to fit the token budget (evidence-bearing messages kept)")
        error: Optional[AnalysisError] = None
        roberta_scores: dict[str, RobertaScore] = {}
        roberta_ms: Optional[float] = None
        validated: Optional[Validated] = None
        contextual_ms: Optional[float] = None
        contextual_model: Optional[str] = None
        meta: dict = {}

        async def run_roberta():
            nonlocal roberta_ms
            if backend != "local_hybrid":
                return
            if not self.roberta or not self.roberta.ready:
                warnings.append("RoBERTa unavailable: " + ((self.roberta and self.roberta.error) or "still loading"))
                return
            r0 = time.perf_counter()
            loop = asyncio.get_running_loop()
            scores = await loop.run_in_executor(None, self.roberta.classify, [(m.id, m.text) for m in focus])
            roberta_ms = round((time.perf_counter() - r0) * 1000, 1)
            roberta_scores.update({s.message_id: s for s in scores})

        async def run_contextual():
            nonlocal validated, contextual_ms, contextual_model, error, meta
            analyzer = self.qwen if backend == "local_hybrid" else self.chatgpt
            try:
                raw = await analyzer.analyze(ctx, req.model)
                contextual_ms, contextual_model, meta = round(raw.latency_ms, 1), raw.model_id, raw.meta
                validated = validate(raw.data, ctx)
                warnings.extend(validated.warnings)
            except AnalyzerError as e:
                error = AnalysisError(code=e.code, message=e.message)
            except InvalidModelOutput as e:
                error = AnalysisError(code="invalid_model_output", message=str(e))

        await asyncio.gather(run_roberta(), run_contextual())

        verify_ms: Optional[float] = None
        if backend == "local_hybrid" and validated is not None and self.s.verify_findings:
            verify_ms = await self._verify(validated, ctx, conv_ev, roberta_scores, participants, warnings)

        if backend == "chatgpt_cloud" and validated is None:
            # Never fabricate cloud predictions: nothing is written.
            return self._finish(req, run_id, child_id, conv, ctx, history, focus_ids, None, roberta_scores, [], [], [], error, warnings, t0, roberta_ms, contextual_ms, contextual_model, meta, status="error")

        by_id = {m.id: m for m in history}
        prior_objectors = frozenset(e.sender_id for e in conv_ev if e.modifier == "counterspeech" and e.status != "superseded")
        events, decisions = fuse(
            backend=backend, child_id=child_id, conv=conv, messages=by_id, focus_ids=focus_ids, roberta=roberta_scores,
            validated=validated, contextual_source=self.qwen.source if backend == "local_hybrid" else self.chatgpt.source,
            roberta_threshold=self.s.roberta_threshold, run_id=run_id, prior_objectors=prior_objectors,
        )

        # Apply only if nothing newer happened while the models were running.
        if self.store.generation(child_id) != gen or not self.store.conversation(conv.id):
            return self._stale(req, conv.id, child_id, "case was reset while the analysis was running")
        if self.store.watermark(conv.id, backend) > watermark:
            return self._stale(req, conv.id, child_id, "a newer analysis of this conversation was applied first")

        superseded: list[str] = []
        with self.store.tx():
            if validated is not None:
                new_keys = {e.key for e in events}
                existing = self.store.evidence(child_id, backend, conv.id)
                retract = {(m, c): r for m, c, r in validated.retractions}
                for e in existing:
                    if e.status == "superseded" or e.key in new_keys:
                        continue
                    if e.message_id in focus_ids:
                        self.store.set_evidence_status(e.key, "superseded", "re-assessed: not confirmed by the latest analysis", run_id)
                        superseded.append(e.key)
                    elif (e.message_id, e.cue) in retract:
                        self.store.set_evidence_status(e.key, "superseded", f"retracted: {retract[(e.message_id, e.cue)]}", run_id)
                        superseded.append(e.key)
            existing_by_key = {e.key: e for e in self.store.evidence(child_id, backend, conv.id)}
            for e in events:
                self.store.upsert_evidence(merge_evidence(existing_by_key.get(e.key), e))
            if validated is not None:
                # New evidence can change an old interpretation: once a target objects, earlier "banter" aimed at
                # them in this chat is no longer read as mutual.
                now_objecting = {e.sender_id for e in events if e.modifier == "counterspeech"} | set(prior_objectors)
                for e in self.store.evidence(child_id, backend, conv.id):
                    if e.modifier == "banter" and e.status in ("active", "needs_review") and e.target_id in now_objecting and e.sender_id != e.target_id:
                        upd = e.model_copy(update={"modifier": "none", "status": "active", "rationale": "reinterpreted: target objected, so not mutual banter", "run_id": run_id})
                        self.store.upsert_evidence(upd)

        status = "ok" if validated is not None else "degraded"
        if verify_ms is not None:
            meta = {**meta, "verifyMs": verify_ms}
            contextual_ms = round((contextual_ms or 0) + verify_ms, 1)
        return self._finish(req, run_id, child_id, conv, ctx, history, focus_ids, validated, roberta_scores, events, decisions, superseded, error, warnings, t0, roberta_ms, contextual_ms, contextual_model, meta, status=status)

    async def _verify(self, validated: Validated, ctx, conv_ev, roberta_scores, participants, warnings: list[str]) -> Optional[float]:
        """Re-check new, uncorroborated findings against the whole transcript. Drops unsupported claims."""
        known = {(e.message_id, e.cue) for e in conv_ev if e.status in ("active", "needs_review")}
        name = lambda pid: participants[pid].display_name if pid in participants else pid  # noqa: E731
        by_id = {m.id: m for m in ctx.messages}
        claims, index = [], {}
        for f in validated.findings:
            r = roberta_scores.get(f.message_id)
            if f.modifier != "none":
                continue
            if (f.message_id, f.cue) in known:
                f.verification = "known"
                continue
            if r is not None and CUE_CATEGORY[f.cue] == "bullying" and r.bullying >= self.s.roberta_threshold:
                f.verification = "corroborated"
                continue
            m = by_id.get(f.message_id)
            if not m:
                continue
            cid = f"c{len(claims) + 1}"
            index[cid] = f
            claims.append(
                {
                    "claim_id": cid,
                    "cue": f.cue,
                    "definition": CUE_DEFINITIONS[f.cue],
                    "claimed_target": name(f.target_id) if f.target_id else None,
                    "message_id": ctx.id_to_alias[m.id],
                    "sender": name(m.sender_id),
                    "text": m.text,
                    "analyser_context_basis": f.context_basis,
                }
            )
        if not claims:
            return None
        # The verifier sees the same whole chat the analyser saw, so it can judge each claim in context.
        transcript = [{"id": ctx.id_to_alias[x.id], "sender": name(x.sender_id), "day": x.day, "text": x.text} for x in ctx.messages]
        try:
            verdicts, ms = await self.qwen.verify(claims, transcript)
        except AnalyzerError as e:
            warnings.append(f"{e.message}; findings kept unverified")
            return None
        kept = []
        for f in validated.findings:
            cid = next((k for k, v in index.items() if v is f), None)
            if cid is None:
                kept.append(f)
                continue
            verdict, reason = verdicts.get(cid, ("unclear", "no verdict returned"))
            if verdict == "not_supported":
                warnings.append(f"verifier rejected {f.cue} on {ctx.id_to_alias.get(f.message_id, f.message_id)}: {reason}")
                continue
            f.verification = verdict
            kept.append(f)
        validated.findings = kept
        return round(ms, 1)

    def _finish(self, req, run_id, child_id, conv, ctx, history, focus_ids, validated, roberta_scores, events, decisions, superseded, error, warnings, t0, roberta_ms, contextual_ms, contextual_model, meta, status) -> dict:
        backend = req.backend
        upto_seq = history[-1].seq
        res = AnalysisResult(
            analysis_id=run_id,
            request_id=req.request_id,
            backend=backend,
            models={"contextual": contextual_model or (self.s.qwen_model if backend == "local_hybrid" else req.model), "classifier": self.roberta.model_id if (backend == "local_hybrid" and self.roberta) else None},
            child_id=child_id,
            conversation_id=conv.id,
            analyzed_message_ids=[m.id for m in ctx.messages],
            focus_message_ids=focus_ids,
            target_participant_id=validated.target_id if validated else None,
            categories=validated.categories if validated else [],
            assessment=validated.assessment if validated else "uncertain",
            findings=validated.findings if validated else [],
            patterns=validated.patterns if validated else [],
            explanation=validated.explanation if validated else "",
            conversation_reading=validated.reading if validated else "",
            uncertain_reason=(validated.uncertain_reason if validated else (error.message if error else None)),
            roberta=list(roberta_scores.values()),
            fusion=decisions,
            touched_evidence=[e.key for e in events],
            superseded_evidence=superseded,
            latency=Latency(total_ms=round((time.perf_counter() - t0) * 1000, 1), roberta_ms=roberta_ms, contextual_ms=contextual_ms),
            context_stats=ContextStats(messages=len(ctx.messages), related_evidence=len(ctx.related), approx_tokens=ctx.approx_tokens, truncated=ctx.truncated),
            error=error,
            warnings=warnings,
            created_at=_now(),
        )
        out = res.dump()
        out["meta"] = meta
        out["status"] = status
        self.store.save_run(run_id, child_id, backend, conv.id, req.request_id, upto_seq, status, out)
        if self.s.log_text:
            log.info("run %s %s focus=%s", run_id, status, [m.text for m in history if m.id in focus_ids])
        else:
            log.info("run %s %s backend=%s conv=%s focus=%d findings=%d ms=%.0f", run_id, status, backend, conv.id, len(focus_ids), len(res.findings), res.latency.total_ms)
        return {
            "result": out,
            "evidence": [e.dump() for e in self.store.evidence(child_id, backend)],
            "firstSeen": self.store.first_seen(child_id),
        }


def merge_evidence(old, new):
    """Re-mentions of an existing finding must not erase what an earlier run established (e.g. RoBERTa agreement)."""
    if old is None or old.status == "superseded" or old.modifier != new.modifier:
        return new
    sources = list(dict.fromkeys([*old.sources, *new.sources]))
    if old.agreement == "agree" and old.status == "active" and "roberta" not in new.sources:
        return new.model_copy(update={"sources": sources, "p": max(old.p, new.p), "agreement": "agree", "status": "active", "rationale": new.rationale or old.rationale})
    return new.model_copy(update={"sources": sources, "p": max(old.p, new.p) if new.status == old.status else new.p})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
