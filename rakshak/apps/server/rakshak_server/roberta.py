"""RoBERTa per-message cyberbullying classifier (nayan90k/roberta-finetuned-cyberbullying-detection).

Binary only: bullying vs not bullying for one message. It never predicts grooming, targets or cross-chat links.
Pretrained weights are used as-is (not trained by us). Loaded once at startup.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional, Protocol

from .contract import RobertaScore

log = logging.getLogger("rakshak.roberta")


class MessageClassifier(Protocol):
    """Swappable per-message classifier interface."""

    model_id: str

    @property
    def ready(self) -> bool: ...

    def classify(self, items: list[tuple[str, str]]) -> list[RobertaScore]: ...


class RobertaClassifier:
    def __init__(self, model_id: str, device: str = "cpu"):
        self.model_id = model_id
        self.requested_device = device
        self.device: Optional[str] = None
        self.error: Optional[str] = None
        self.load_ms: Optional[float] = None
        self._ready = threading.Event()
        self._lock = threading.Lock()
        self._tok = None
        self._model = None
        self.label_map: dict[int, str] = {}

    @property
    def ready(self) -> bool:
        return self._ready.is_set()

    def load(self) -> None:
        t0 = time.perf_counter()
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            dev = self.requested_device
            if dev == "auto":
                dev = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
            self._tok = AutoTokenizer.from_pretrained(self.model_id)
            model = AutoModelForSequenceClassification.from_pretrained(self.model_id)
            model.eval().to(dev)
            self._model = model
            self.device = dev
            # The checkpoint's config only carries generic LABEL_0 / LABEL_1 names. The model card documents
            # LABEL_0 = not cyberbullying and LABEL_1 = cyberbullying, so we map indices explicitly.
            id2label = getattr(model.config, "id2label", {}) or {}
            self.label_map = {0: "not_bullying", 1: "bullying"}
            if id2label and {str(v).upper() for v in id2label.values()} - {"LABEL_0", "LABEL_1"}:
                log.warning("Unexpected id2label %s; keeping documented mapping 0=not_bullying, 1=bullying", id2label)
            self.load_ms = (time.perf_counter() - t0) * 1000
            self._ready.set()
            log.info("RoBERTa loaded on %s in %.0f ms", dev, self.load_ms)
        except Exception as e:  # pragma: no cover - depends on local install
            self.error = f"{type(e).__name__}: {e}"
            log.error("RoBERTa failed to load: %s", self.error)

    def classify(self, items: list[tuple[str, str]]) -> list[RobertaScore]:
        """items: (message_id, text). Returns raw softmax scores per message with measured latency."""
        if not self.ready:
            raise RuntimeError(self.error or "RoBERTa is still loading")
        import torch

        out: list[RobertaScore] = []
        with self._lock:
            for mid, text in items:
                t0 = time.perf_counter()
                enc = self._tok(text, return_tensors="pt", truncation=True, max_length=256).to(self.device)
                with torch.inference_mode():
                    logits = self._model(**enc).logits[0]
                probs = torch.softmax(logits.float(), dim=-1).tolist()
                ms = (time.perf_counter() - t0) * 1000
                bullying, not_bullying = float(probs[1]), float(probs[0])
                out.append(
                    RobertaScore(
                        message_id=mid,
                        model=self.model_id,
                        not_bullying=round(not_bullying, 4),
                        bullying=round(bullying, 4),
                        predicted="bullying" if bullying >= not_bullying else "not_bullying",
                        latency_ms=round(ms, 1),
                    )
                )
        return out
