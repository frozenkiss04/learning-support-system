"""Tutor agent — agentic loop for the LESSON chat turn.

One turn runs three steps, each timed and logged as a trace so a slow turn
can be diagnosed from the logs instead of guessed at:

1. ROUTE (rule-based, no LLM call): small talk — greetings, thanks,
   farewells, "bạn là ai" — skips retrieval entirely: those turns need no
   course context, so they answer faster and cost no embedding call.
   Everything else goes to retrieval, including short follow-ups like
   "tại sao?" (they refer to earlier context).
2. RETRIEVE: :func:`rag_service.retrieve` over the course's chunks —
   pgvector ANN search on Postgres/Neon, cached embeddings + cached
   results, JSON cosine fallback on SQLite. Any retrieval failure is
   swallowed (the tutor still answers, just without document context).
3. ANSWER: :class:`AiService` generation with the retrieved chunks woven
   into the system prompt, plus their titles as sources.

The blueprint keeps session/message/rate-limit logic; the agent owns
routing, retrieval and prompt assembly so ``/chat`` and ``/chat/stream``
share one decision path. ROLEPLAY and ADMIN turns do not go through the
agent (roleplay has canned replies + its own prompt; admin has its stats
snapshot instead of RAG).
"""
from __future__ import annotations

import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field

from ..extensions import db
from ..models.learning import Lesson
from . import rag_service
from .ai_service import AiService

logger = logging.getLogger(__name__)

# Small talk, matched on folded (diacritic-free, lowercased) text.
_SMALL_TALK = {
    "xin chao", "chao ban", "chao em", "chao anh", "chao chi", "chao",
    "hello", "hi", "hey", "good morning", "good afternoon", "good evening",
    "cam on", "cam on ban", "cam on em", "cam on anh", "cam on nhieu",
    "thank you", "thanks", "thank",
    "tam biet", "bye", "goodbye", "see you",
    "ban la ai", "ban ten gi", "ban la gi",
    "ban khoe khong", "ban co khoe khong", "how are you",
    "ok", "okay", "duoc roi", "vang", "u", "uh",
}
# Greeting + short tail ("xin chao ban nhe", "cam on ban nhieu") also skips
# retrieval; the trailing space forces a word boundary ("history" must not
# match "hi").
_SMALL_TALK_PREFIXES = (
    "xin chao", "chao ban", "hello", "hi", "hey",
    "cam on", "thank you", "thanks", "tam biet", "bye",
)
_SMALL_TALK_MAX_LEN = 30


def _fold(text: str) -> str:
    text = (text or "").lower().replace("đ", "d")
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def is_small_talk(message: str) -> bool:
    """True when the message is pure small talk needing no course context."""
    text = re.sub(r"\s+", " ", _fold(message)).strip(" .!?,:;\"'()[]")
    if not text:
        return True
    if text in _SMALL_TALK:
        return True
    if len(text) <= _SMALL_TALK_MAX_LEN:
        return any(text.startswith(p + " ") for p in _SMALL_TALK_PREFIXES)
    return False


@dataclass
class TurnContext:
    system: str
    sources: list[str] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)


class TutorAgent:
    """Owns route → retrieve → answer for one LESSON turn."""

    def __init__(self, service: AiService | None = None):
        self.service = service or AiService()

    @staticmethod
    def needs_retrieval(message: str) -> bool:
        return not is_small_talk(message)

    @staticmethod
    def _course_id_for(session) -> int | None:
        if not session.context_id:
            return None
        lesson = db.session.get(Lesson, session.context_id)
        if lesson is not None and lesson.unit is not None:
            return lesson.unit.course_id
        return None

    def prepare(self, session, history, base_system: str) -> TurnContext:
        """Run route + retrieve; return the grounded system prompt.

        Only LESSON turns retrieve: ROLEPLAY has its own prompt (and canned
        replies) and ADMIN has its stats snapshot instead of RAG.
        """
        if session.context_type != "LESSON":
            return TurnContext(
                system=base_system,
                trace=[{"step": "route", "ms": 0.0,
                        "detail": "skip (not LESSON)"}])
        trace: list[dict] = []
        question = next((m["content"] for m in reversed(history)
                         if m["role"] == "user"), "")
        t0 = time.monotonic()
        route = "retrieve" if question and self.needs_retrieval(question) else "skip"
        trace.append({"step": "route", "ms": round((time.monotonic() - t0) * 1000, 1),
                      "detail": route})
        system = base_system
        sources: list[str] = []
        if route == "retrieve":
            t1 = time.monotonic()
            backend = rag_service.search_backend()
            try:
                hits = rag_service.retrieve(
                    question, top_k=4, course_id=self._course_id_for(session))
            except Exception:
                logger.exception("Tutor agent retrieve failed — answering "
                                 "without document context")
                hits = []
            trace.append({
                "step": "retrieve",
                "ms": round((time.monotonic() - t1) * 1000, 1),
                "detail": f"{len(hits)} hits via {backend}",
            })
            if hits:
                block = "\n\n".join(
                    f"[{h['title']}]\n{h['content']}" for h in hits)
                system += ("\n\nTÀI LIỆU KHÓA HỌC LIÊN QUAN (ưu tiên dựa vào "
                           f"đây, trích nguồn khi dùng):\n{block}")
                sources = [h["title"] for h in hits]
        logger.info("tutor agent prepare: ctx=%s route=%s %s",
                    session.context_type, route,
                    " ".join(f"{s['step']}={s['ms']}ms({s['detail']})"
                             for s in trace))
        return TurnContext(system=system, sources=sources, trace=trace)

    def answer(self, session, history, base_system: str,
               max_tokens: int | None = None):
        """Full turn (non-streaming): prepare + generate.

        Returns ``(reply, sources, trace)``. Provider failures raise
        :class:`AiProviderError` like :meth:`AiService.chat`.
        """
        ctx = self.prepare(session, history, base_system)
        t0 = time.monotonic()
        reply = self.service.chat(history, ctx.system, sources=ctx.sources,
                                  max_tokens=max_tokens)
        ctx.trace.append({
            "step": "answer",
            "ms": round((time.monotonic() - t0) * 1000, 1),
            "detail": f"{len(reply)} chars via {self.service.provider}",
        })
        return reply, ctx.sources, ctx.trace
