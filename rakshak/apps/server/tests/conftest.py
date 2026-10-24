"""Test doubles for the model adapters, so pipeline logic is tested deterministically without GPU or network."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Optional

import pytest
from fastapi.testclient import TestClient

from rakshak_server.analyzers import AnalyzerError, RawAnalysis
from rakshak_server.app import create_app
from rakshak_server.config import Settings
from rakshak_server.contract import RobertaScore
from rakshak_server.context import Context


class FakeRoberta:
    model_id = "fake/roberta"
    error = None
    device = "cpu"
    load_ms = 1.0

    def __init__(self, scores: Optional[dict[str, float]] = None, ready: bool = True):
        self.scores = scores or {}
        self._ready = ready
        self.calls = 0

    @property
    def ready(self) -> bool:
        return self._ready

    def load(self) -> None:
        self._ready = True

    def classify(self, items):
        self.calls += 1
        out = []
        for mid, text in items:
            b = next((v for k, v in self.scores.items() if k in text.lower()), 0.05)
            out.append(RobertaScore(message_id=mid, model=self.model_id, not_bullying=1 - b, bullying=b, predicted="bullying" if b >= 0.5 else "not_bullying", latency_ms=1.0))
        return out


Responder = Callable[[Context], dict]


class FakeContextual:
    """Returns whatever the responder builds from the real Context (aliases, participants)."""

    def __init__(self, source: str, responder: Optional[Responder] = None, error: Optional[AnalyzerError] = None, raw_text: Optional[str] = None, delay: float = 0.0, verdict: str = "supported"):
        self.source = source
        self.verdict = verdict
        self.verified: list[dict] = []
        self.transcripts: list[list[dict]] = []
        self.responder = responder or (lambda ctx: empty())
        self.error = error
        self.calls: list[Context] = []
        self.delay = delay

    async def analyze(self, ctx: Context, model=None) -> RawAnalysis:
        import asyncio

        self.calls.append(ctx)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return RawAnalysis(data=self.responder(ctx), model_id=f"fake-{self.source}", latency_ms=2.0, meta={})

    async def verify(self, claims, transcript=None):
        self.verified.extend(claims)
        self.transcripts.append(transcript or [])
        return {c["claim_id"]: (self.verdict, "fake verdict") for c in claims}, 1.0

    async def status(self):
        return {"reachable": True, "modelPresent": True, "loaded": True, "model": "fake", "numCtx": 8192, "status": "connected", "sharing": True}

    async def warmup(self):
        return None

    async def call(self, method, path, body=None, timeout=10):
        if self.error:
            raise self.error
        return {"status": "connected", "sharing": True}


def empty(assessment: str = "harmless") -> dict:
    return {"conversation_reading": "test reading", "assessment": assessment, "categories": [], "target_participant_id": None, "findings": [], "retractions": [], "patterns": [], "explanation": "", "uncertain_reason": None}


def finding(alias: str, cue: str, target: Optional[str] = "p-meera", modifier: str = "none", confidence: str = "high") -> dict:
    return {"message_id": alias, "context_basis": "test basis", "cue": cue, "target_id": target, "modifier": modifier, "confidence": confidence, "rationale": "test"}


def alias_of(ctx: Context, text_part: str) -> str:
    for a, mid in ctx.alias_to_id.items():
        m = next(x for x in ctx.messages if x.id == mid)
        if text_part in m.text:
            return a
    raise KeyError(text_part)


@pytest.fixture
def make_client(tmp_path: Path):
    def _make(qwen=None, chatgpt=None, roberta=None):
        s = Settings(data_dir=tmp_path, chatgpt_enabled=True)
        app = create_app(s, roberta=roberta or FakeRoberta(), qwen=qwen or FakeContextual("qwen"), chatgpt=chatgpt or FakeContextual("chatgpt"), load_models=False)
        return TestClient(app)

    return _make


def post_msg(c: TestClient, conv: str, sender: str, text: str, day: int = 1, mid: Optional[str] = None) -> str:
    r = c.post("/api/messages", json={"id": mid or f"m-{time.perf_counter_ns()}", "conversationId": conv, "senderId": sender, "day": day, "time": "1:00 PM", "text": text})
    r.raise_for_status()
    return r.json()["id"]


def analyze(c: TestClient, conv: str, upto: Optional[str] = None, backend: str = "local_hybrid", trigger: str = "auto", model: Optional[str] = None) -> dict:
    r = c.post("/api/analyze", json={"backend": backend, "conversationId": conv, "uptoMessageId": upto, "requestId": f"r-{time.perf_counter_ns()}", "trigger": trigger, "model": model})
    return r
