"""Rules fallback: a keyword reader used only when Qwen (Ollama) is not available on this machine.

It returns the same raw JSON shape as the models, so validation, fusion, case memory and the engine run unchanged.
It reads one message at a time with fixed phrase lists, so it misses context (banter, quoting, sarcasm) that Qwen
catches. Every result says it came from the rules fallback, never from an AI model.

The phrase lists are explicit, so a match is reported at high confidence and passes fusion's confirmation gate the way
a high-confidence model finding does. A request matched here names the child ("send me a pic of you", "where do you
live"), so request cues say so (requested_subject "child"). It never re-reads earlier messages, so the gate's "still
supported after later messages" path does not apply to it.
"""

from __future__ import annotations

import re
import time
from typing import Optional

from .analyzers import RawAnalysis
from .contract import REQUEST_CUES
from .context import Context

MODEL_ID = "rules-fallback"
# Cues that make a whole conversation "harmful" rather than "concerning".
SERIOUS_CUES = frozenset({"threat_payment", "intimidation", "image_request", "meeting_request", "disable_protection"})

_P = {
    "flattery_age": r"mature for (your|ur) age|so mature|you'?re (so |really )?(cute|pretty|beautiful|hot|special|gorgeous)|not like (other|the other) (girls|boys|kids)|look older than|how old are (you|u)",
    "secrecy": r"(don'?t|do not|never) tell (anyone|any ?one|your (mom|mum|dad|parents|amma|appa|friends|family|teacher))|our (little )?secret|keep (this|it) (between us|secret|to yourself)|delete (this|the|our) (chat|messages?)",
    "isolation": r"(they|your (parents|friends|family)) (don'?t|do not|never|wouldn'?t) (understand|get) you|only i (understand|get) you|you don'?t need (them|anyone)|i'?m the only one (who|that)",
    "platform_move": r"(add|text|dm|message|talk to|call) me on|(move|switch|come|chat) (to|on) (snap|snapchat|telegram|whatsapp|insta|instagram|discord|signal)|\b(snap|telegram|discord) (id|username|me)\b",
    "manipulation": r"if you (really |truly )?(loved|cared|trusted|liked) me|after (all|everything) i('?ve)? (did|done)|you owe me|prove (it|that you)|i thought you were (mature|different)",
    "personal_info_request": r"where do you live|(what|which) (school|area|class)|your (home )?address|send (me )?your (number|location|address)|are you (home )?alone|when (are|do) your parents",
    "image_request": r"(send|share|show) (me )?(a |some |one |another )?(pic|pics|photo|photos|picture|pictures|selfie|video|nudes?)\b|show me (yourself|your body)|(pic|photo|picture) of (you|yourself)",
    "meeting_request": r"(let'?s|lets|we should|can we|wanna|want to) meet|meet (up|me)\b|come (over|to my)|i('?ll| will) pick you up",
    "disable_protection": r"(turn off|disable|uninstall|delete|remove) (the |that |this )?(app|rakshak|parental|location|tracking|safety)|incognito|clear your (history|chats?)",
    "threat_payment": r"(pay|send|transfer) (me )?(₹|rs\.?|inr|money|cash|\d{3,})|or (else )?(i'?ll|i will) (post|share|send|leak|show|tell)|(post|share|leak|send|show) (your|the|those) (pics|photos|pictures|video)|everyone will see|\bupi\b|gift ?card",
    "insult_harassment": r"\b(idiot|stupid|loser|ugly|fatso|dumb|freak|pathetic|worthless|moron)\b|shut up|nobody likes you",
    "humiliation": r"(everyone|whole class|they) (is |are )?laugh(ing)? at you|so embarrassing|(posting|posted|sharing|screenshotted) (your|this|it)",
    "exclusion": r"(don'?t|do not|no one|nobody) (add|invite|sit with)|you'?re not (invited|welcome)|leave the group|kick (her|him|them|you) out|nobody wants you",
    "intimidation": r"(i'?ll|i will|gonna|going to) (hurt|beat|get|find|ruin) you|watch your back|you('?ll| will) regret|or else\b",
}
_RULES = {cue: re.compile(p, re.IGNORECASE) for cue, p in _P.items()}
# Laughter next to an insult: the fallback marks it as possible banter and lets fusion check whether it is mutual.
_BANTER = re.compile(r"\b(lol|lmao|jk|haha+|bro)\b|😂|🤣", re.IGNORECASE)


class RulesAnalyzer:
    source = "rules"

    async def analyze(self, ctx: Context, model: Optional[str] = None) -> RawAnalysis:
        t0 = time.perf_counter()
        child = ctx.payload["protected_child"]["id"]
        focus = set(ctx.focus_ids)
        findings, matched = [], []
        for m in ctx.messages:
            if m.id not in focus or m.sender_id == child:
                continue
            for cue, rx in _RULES.items():
                hit = rx.search(m.text)
                if not hit:
                    continue
                banter = cue == "insult_harassment" and bool(_BANTER.search(m.text))
                findings.append(
                    {
                        "message_id": ctx.id_to_alias[m.id],
                        "cue": cue,
                        "target_id": child if child in ctx.participant_ids else None,
                        "modifier": "banter" if banter else "none",
                        "confidence": "medium" if banter else "high",
                        "rationale": f"rules fallback matched “{hit.group(0)[:60]}”",
                        "context_basis": "rules fallback: this message only",
                        "requested_subject": "child" if cue in REQUEST_CUES else None,
                    }
                )
                matched.append(cue)
        harmful = any(c in SERIOUS_CUES for c in matched)
        data = {
            "assessment": "harmful" if harmful else "concerning" if matched else "harmless",
            "categories": sorted({"bullying" if c in ("insult_harassment", "humiliation", "exclusion", "intimidation") else "grooming" for c in matched}) or ["none"],
            "target_participant_id": child if child in ctx.participant_ids else None,
            "findings": findings,
            "retractions": [],
            "patterns": [],
            "conversation_reading": (
                "Rules fallback (no AI model on this machine): new messages were checked one by one against fixed warning phrases; "
                + (f"matched {', '.join(dict.fromkeys(matched))}." if matched else "none matched.")
            ),
            "explanation": ("Rules fallback (no AI model on this machine) matched: " + ", ".join(dict.fromkeys(matched))) if matched else "Rules fallback (no AI model on this machine): no warning phrases.",
            "uncertain_reason": None,
        }
        return RawAnalysis(data=data, model_id=MODEL_ID, latency_ms=(time.perf_counter() - t0) * 1000, meta={"fallback": True})
