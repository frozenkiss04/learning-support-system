"""AI chatbot endpoints — 2 vai: tutor cho học viên, trợ lý cho admin.

- ``POST /api/ai/chat``        — hỏi/đáp thường (JSON), lưu session + message.
- ``POST /api/ai/chat/stream`` — cùng luồng nhưng trả SSE cho panel AI ở FE.
- ``GET  /api/ai/sessions``    — lịch sử phiên chat của chính user.
- ``GET  /api/ai/sessions/<id>`` — nội dung 1 phiên chat của chính user.

Quyền: mọi endpoint cần JWT. Nhánh ``context_type=ADMIN`` chỉ dành cho
ADMIN/TEACHER và được kiểm tra *trước khi* tạo session/lưu message; system
prompt của nhánh này chỉ cho phép dùng số liệu do backend cung cấp kèm theo.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, current_app, request, stream_with_context
from flask_jwt_extended import jwt_required
from sqlalchemy import case, func

from ..extensions import db, limiter
from ..models.chat import ChatMessage, ChatSession
from ..models.course import Course
from ..models.learning import Attempt, Exercise, Lesson, UserProgress
from ..models.user import ROLE_ADMIN, ROLE_LEARNER, ROLE_TEACHER, User
from ..services import rag_service
from ..services.ai_service import SYSTEM_ADMIN, SYSTEM_TUTOR, AiProviderError, AiService
from ..utils.responses import fail, ok
from ..utils.security import current_user

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__)

CONTEXT_TYPES = ("LESSON", "ADMIN")
ADMIN_ROLES = (ROLE_ADMIN, ROLE_TEACHER)
MAX_MESSAGE_CHARS = 4000
HISTORY_LIMIT = 20  # chỉ gửi 20 lượt gần nhất cho AI để khống chế token/chi phí


def _daily_limit():
    return f"{current_app.config.get('AI_DAILY_LIMIT', 50)} per day"


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _history(session, limit=HISTORY_LIMIT):
    messages = session.messages[-limit:] if session.messages else []
    return [{"role": m.role, "content": m.content} for m in messages]


def _lesson_context(session) -> str:
    """Chèn tiêu đề/mô tả bài học vào system prompt cho nhánh tutor."""
    if not session.context_id:
        return ""
    lesson = db.session.get(Lesson, session.context_id)
    if not lesson:
        return ""
    lines = [f'Ngữ cảnh bài học: học viên đang học bài "{lesson.title}".']
    if lesson.description:
        lines.append(f"Mô tả bài: {lesson.description}")
    unit = lesson.unit
    if unit:
        lines.append(f"Thuộc chương: {unit.title}")
        if unit.course:
            lines.append(f"Thuộc khóa học: {unit.course.title}")
    lines.append("Hãy ưu tiên giải thích trong phạm vi bài học này.")
    return "\n".join(lines)


def _admin_stats_context() -> str:
    """Snapshot số liệu thật từ DB — nguồn duy nhất trợ lý admin được trích dẫn."""
    try:
        total_attempts = Attempt.query.count()
        correct = Attempt.query.filter_by(is_correct=True).count()
        accuracy = round(correct * 100 / total_attempts, 1) if total_attempts else 0
        since = datetime.now(timezone.utc) - timedelta(days=7)
        active_7d = (db.session.query(func.count(func.distinct(Attempt.user_id)))
                     .filter(Attempt.created_at >= since).scalar() or 0)
        weakest = (
            db.session.query(
                Lesson.title,
                func.count(Attempt.id).label("attempts"),
                func.avg(case((Attempt.is_correct.is_(True), 1), else_=0)).label("acc"),
            )
            .join(Exercise, Exercise.lesson_id == Lesson.id)
            .join(Attempt, Attempt.exercise_id == Exercise.id)
            .group_by(Lesson.id)
            .having(func.count(Attempt.id) >= 3)
            .order_by(func.avg(case((Attempt.is_correct.is_(True), 1), else_=0)).asc())
            .limit(5)
            .all()
        )
        lines = [
            "Số liệu hệ thống (nguồn duy nhất được phép trích dẫn):",
            f"- Tổng học viên: {User.query.filter_by(role=ROLE_LEARNER).count()}",
            f"- Tổng khóa học: {Course.query.count()} "
            f"(đang mở: {Course.query.filter_by(is_published=True).count()})",
            f"- Tổng bài học: {Lesson.query.count()}",
            f"- Tổng lượt làm bài (attempts): {total_attempts}",
            f"- Tỉ lệ trả lời đúng: {accuracy}%",
            f"- Bài học đã hoàn thành (lượt): "
            f"{UserProgress.query.filter_by(status='COMPLETED').count()}",
            f"- Học viên hoạt động 7 ngày qua: {active_7d}",
        ]
        if weakest:
            lines.append("- Bài học tỉ lệ đúng thấp nhất (tối thiểu 3 lượt làm):")
            for title, attempts, acc in weakest:
                lines.append(f"  + {title}: {round((acc or 0) * 100, 1)}% "
                             f"qua {attempts} lượt làm")
        return "\n".join(lines)
    except Exception:
        logger.exception("Không lấy được số liệu cho trợ lý admin")
        return ("Số liệu hệ thống: hiện không lấy được số liệu. "
                "Hãy nói rõ điều này, không tự đưa ra con số nào.")


def _rag_context(session, history) -> tuple[str, list[str]]:
    """RAG cho nhánh TUTOR: (khối bổ sung vào system prompt, tiêu đề nguồn).

    Truy vấn bằng câu hỏi mới nhất của học viên; có lesson context thì giới
    hạn trong khóa của bài đó. Mọi lỗi retrieval đều bị nuốt im lặng (trả
    rỗng) — RAG là lớp tăng cường, không bao giờ được làm hỏng luồng chat.
    Nhánh ADMIN không đi qua đây (đã có snapshot số liệu riêng).
    """
    if session.context_type != "LESSON":
        return "", []
    question = next((m["content"] for m in reversed(history)
                     if m["role"] == "user"), "")
    if not question:
        return "", []
    course_id = None
    if session.context_id:
        lesson = db.session.get(Lesson, session.context_id)
        if lesson is not None and lesson.unit is not None:
            course_id = lesson.unit.course_id
    try:
        hits = rag_service.retrieve(question, top_k=4, course_id=course_id)
    except Exception:
        logger.exception("RAG retrieve thất bại — bỏ qua ngữ cảnh tài liệu")
        return "", []
    if not hits:
        return "", []
    block = "\n\n".join(f"[{h['title']}]\n{h['content']}" for h in hits)
    system_extra = ("TÀI LIỆU KHÓA HỌC LIÊN QUAN (ưu tiên dựa vào đây, "
                    f"trích nguồn khi dùng):\n{block}")
    return system_extra, [h["title"] for h in hits]


def _build_system_prompt(user, session) -> str:
    if session.context_type == "ADMIN":
        return SYSTEM_ADMIN + "\n\n" + _admin_stats_context()
    system = SYSTEM_TUTOR
    context = _lesson_context(session)
    if context:
        system += "\n\n" + context
    return system


def _prepare_turn(user, body):
    """Validate + create/load session + persist the user message.

    Returns ``(session, system_prompt, error_response)`` — exactly one of
    ``session`` / ``error_response`` is set. Quyền ADMIN và validate input
    đều chạy *trước* mọi thao tác ghi DB.
    """
    message = (body.get("message") or "").strip()
    if not message:
        return None, None, fail("Nội dung tin nhắn là bắt buộc")
    if len(message) > MAX_MESSAGE_CHARS:
        return None, None, fail(f"Tin nhắn tối đa {MAX_MESSAGE_CHARS} ký tự")

    session_id = body.get("session_id")
    if session_id:
        # Ownership check: user không đọc/ghi được session của người khác.
        session = ChatSession.query.filter_by(id=session_id, user_id=user.id).first()
        if not session:
            return None, None, fail("Không tìm thấy phiên chat", 404)
        context_type = session.context_type
    else:
        context_type = (body.get("context_type") or "LESSON").strip().upper()
        if context_type not in CONTEXT_TYPES:
            return None, None, fail(
                f"context_type phải là một trong: {', '.join(CONTEXT_TYPES)}")
        session = None

    if context_type == "ADMIN" and user.role not in ADMIN_ROLES:
        return None, None, fail("Bạn không có quyền dùng trợ lý quản lý", 403)

    if session is None:
        context_id = body.get("context_id")
        if context_id is not None:
            try:
                context_id = int(context_id)
            except (TypeError, ValueError):
                return None, None, fail("context_id phải là số nguyên")
        if context_type == "LESSON" and context_id is not None:
            if not db.session.get(Lesson, context_id):
                return None, None, fail("Bài học không tồn tại", 404)
        session = ChatSession(user_id=user.id, context_type=context_type,
                              context_id=context_id, title=message[:80])
        db.session.add(session)
        db.session.commit()

    db.session.add(ChatMessage(session_id=session.id, role="user", content=message))
    db.session.commit()
    return session, _build_system_prompt(user, session), None


def _save_assistant(session, content):
    db.session.add(ChatMessage(session_id=session.id, role="assistant",
                               content=content))
    db.session.commit()


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@ai_bp.post("/chat")
@jwt_required()
@limiter.limit("30 per hour")
@limiter.limit(_daily_limit)
def chat():
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    body = request.get_json(silent=True) or {}
    session, system, error = _prepare_turn(user, body)
    if error:
        return error
    history = _history(session)
    rag_extra, rag_titles = _rag_context(session, history)
    if rag_extra:
        system = system + "\n\n" + rag_extra
    service = AiService()
    try:
        reply = service.chat(history, system, sources=rag_titles)
    except AiProviderError as exc:
        # Tin nhắn user đã lưu; không lưu "trả lời" giả khi provider lỗi.
        return fail(str(exc), 502, code="AI_PROVIDER_ERROR")
    _save_assistant(session, reply)
    return ok({
        "session_id": session.id,
        "context_type": session.context_type,
        "reply": reply,
        "provider": service.provider,
        "stub": service.is_stub,
    })


@ai_bp.post("/chat/stream")
@jwt_required()
@limiter.limit("30 per hour")
@limiter.limit(_daily_limit)
def chat_stream():
    """SSE variant used by the learner AI panel (dùng chung cho cả ADMIN).

    Events: ``{"type": "meta", "session_id": ...}`` →
    ``{"type": "delta", "delta": "..."}`` * n →
    ``{"type": "error", "message": "..."}`` khi provider lỗi, cuối là
    ``data: [DONE]``.
    """
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    body = request.get_json(silent=True) or {}
    session, system, error = _prepare_turn(user, body)
    if error:
        return error
    service = AiService()
    history = _history(session)
    rag_extra, rag_titles = _rag_context(session, history)
    if rag_extra:
        system = system + "\n\n" + rag_extra
    session_id = session.id

    @stream_with_context
    def generate():
        yield f"data: {json.dumps({'type': 'meta', 'session_id': session_id})}\n\n"
        parts = []
        try:
            for chunk in service.stream(history, system, sources=rag_titles):
                parts.append(chunk)
                yield f"data: {json.dumps({'type': 'delta', 'delta': chunk})}\n\n"
        except AiProviderError as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"
            return
        content = "".join(parts).strip()
        if content:
            _save_assistant(session, content)
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


@ai_bp.get("/sessions")
@jwt_required()
def sessions():
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    limit = min(request.args.get("limit", 20, type=int) or 20, 50)
    rows = (ChatSession.query.filter_by(user_id=user.id)
            .order_by(ChatSession.id.desc()).limit(limit).all())
    return ok([{
        "id": s.id, "title": s.title, "context_type": s.context_type,
        "context_id": s.context_id,
        "message_count": len(s.messages),
        "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s in rows])


@ai_bp.get("/sessions/<int:session_id>")
@jwt_required()
def session_detail(session_id):
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    session = ChatSession.query.filter_by(id=session_id, user_id=user.id).first()
    if not session:
        return fail("Không tìm thấy phiên chat", 404)
    return ok({
        "id": session.id, "title": session.title,
        "context_type": session.context_type, "context_id": session.context_id,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [{
            "id": m.id, "role": m.role, "content": m.content,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in session.messages],
    })
