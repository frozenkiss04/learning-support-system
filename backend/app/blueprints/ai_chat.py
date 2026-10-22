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
import re
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, Response, current_app, request, stream_with_context
from flask_jwt_extended import jwt_required
from sqlalchemy import case, func

from ..extensions import db, limiter
from ..models.chat import ChatMessage, ChatSession
from ..models.course import Course, Unit
from ..models.learning import Attempt, Exercise, Lesson, UserProgress
from ..models.practice import AiPracticeSet
from ..models.review import ReviewCard
from ..models.user import ROLE_ADMIN, ROLE_LEARNER, ROLE_TEACHER, User
from ..services import rag_service
from ..services.ai_service import SYSTEM_ADMIN, SYSTEM_TUTOR, AiProviderError, AiService
from ..services.progress_service import _normalize_answer
from ..utils.responses import fail, ok
from ..utils.security import current_user

logger = logging.getLogger(__name__)

ai_bp = Blueprint("ai", __name__)

CONTEXT_TYPES = ("LESSON", "ADMIN", "ROLEPLAY")

# ---------------------------------------------------------------------------
# Chat nhập vai (ROLEPLAY): AI đóng vai nhân vật trong tình huống giao tiếp.
# context_id là cột Integer (id bài học) nên không mã hóa scenario vào đó —
# session lưu context_type="ROLEPLAY", context_id=NULL; scenario được gửi
# kèm từng lượt chat và chỉ dùng khi dựng system prompt.
# ---------------------------------------------------------------------------
_ROLEPLAY_RULES = (
    " Hãy hội thoại HOÀN TOÀN bằng tiếng Anh ở trình độ A1–A2: câu ngắn, từ "
    "vựng đơn giản. Nếu học viên mắc lỗi ngữ pháp hoặc dùng sai từ, hãy nhẹ "
    "nhàng sửa bằng một ghi chú ngắn trong ngoặc đơn ở cuối câu trả lời, ví "
    "dụ: (Small correction: say 'a coffee', not 'one coffee'). Mỗi lượt trả "
    "lời tối đa 2–3 câu và luôn kết thúc bằng một câu hỏi để học viên nói "
    "tiếp. Tuyệt đối không thoát vai, không giải thích dài dòng bằng tiếng Việt."
)
ROLEPLAY_SCENARIOS = {
    "cafe": {
        "title": "Quán cà phê",
        "system": (
            "Bạn đang đóng vai nhân viên pha chế (barista) thân thiện tại một "
            "quán cà phê. Học viên là khách hàng đang luyện tiếng Anh. Hãy giữ "
            "đúng vai: chào khách, hỏi khách muốn uống gì, hỏi size nóng/đá, "
            "lượng đường, gợi ý món bán chạy, xác nhận đơn và báo giá."
            + _ROLEPLAY_RULES
        ),
    },
    "hotel": {
        "title": "Khách sạn",
        "system": (
            "Bạn đang đóng vai lễ tân khách sạn lịch sự. Học viên là khách đang "
            "luyện tiếng Anh. Hãy giữ đúng vai: chào khách, hỏi tên và thông tin "
            "đặt phòng, số đêm lưu trú, loại phòng, hỏi giấy tờ tùy thân, giới "
            "thiệu giờ ăn sáng và các dịch vụ của khách sạn."
            + _ROLEPLAY_RULES
        ),
    },
    "airport": {
        "title": "Sân bay",
        "system": (
            "Bạn đang đóng vai nhân viên quầy check-in tại sân bay. Học viên là "
            "hành khách đang luyện tiếng Anh. Hãy giữ đúng vai: chào hành khách, "
            "hỏi hộ chiếu và vé, điểm đến, hành lý ký gửi/xách tay, chọn ghế "
            "cạnh cửa sổ hay lối đi, và thông báo cổng khởi hành."
            + _ROLEPLAY_RULES
        ),
    },
    "interview": {
        "title": "Phỏng vấn xin việc",
        "system": (
            "Bạn đang đóng vai nhà tuyển dụng thân thiện trong một buổi phỏng "
            "vấn xin việc đơn giản. Học viên là ứng viên đang luyện tiếng Anh. "
            "Hãy giữ đúng vai: chào ứng viên, mời giới thiệu bản thân, hỏi về "
            "điểm mạnh, kinh nghiệm học tập/làm việc và lý do ứng tuyển, mỗi "
            "lượt chỉ hỏi một câu."
            + _ROLEPLAY_RULES
        ),
    },
}
SYSTEM_ROLEPLAY_GENERIC = (
    "Bạn đang nhập vai một nhân vật trong tình huống giao tiếp tiếng Anh với "
    "học viên (vai cụ thể đã được thiết lập trong các lượt trò chuyện trước). "
    "Hãy tiếp tục giữ đúng vai đó." + _ROLEPLAY_RULES
)


def _clean_scenario(value):
    """Trả về key scenario hợp lệ (lowercase) hoặc None nếu sai/thiếu."""
    if not isinstance(value, str):
        return None
    key = value.strip().lower()
    return key if key in ROLEPLAY_SCENARIOS else None
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
    if session.context_type == "ROLEPLAY":
        info = ROLEPLAY_SCENARIOS.get(getattr(session, "_roleplay_scenario", None) or "")
        return info["system"] if info else SYSTEM_ROLEPLAY_GENERIC
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

    # Scenario nhập vai: nếu client gửi kèm thì phải thuộc danh sách hợp lệ.
    scenario = None
    if body.get("scenario") is not None:
        scenario = _clean_scenario(body.get("scenario"))
        if scenario is None:
            return None, None, fail(
                "scenario phải là một trong: " + ", ".join(sorted(ROLEPLAY_SCENARIOS)))

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
        if context_type == "ROLEPLAY" and scenario is None:
            # Phiên nhập vai mới bắt buộc chọn một tình huống hợp lệ.
            return None, None, fail(
                "scenario phải là một trong: " + ", ".join(sorted(ROLEPLAY_SCENARIOS)))
        session = None

    if context_type == "ADMIN" and user.role not in ADMIN_ROLES:
        return None, None, fail("Bạn không có quyền dùng trợ lý quản lý", 403)

    if session is None:
        context_id = body.get("context_id")
        if context_type == "ROLEPLAY":
            context_id = None  # scenario không mã hóa vào context_id (cột Integer)
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

    if session.context_type == "ROLEPLAY":
        # Thuộc tính tạm trên object phiên (không lưu DB): lượt tạo phiên dùng
        # scenario đã validate; lượt nối tiếp không gửi scenario thì None và
        # prompt nhập vai chung sẽ giữ vai theo lịch sử hội thoại.
        session._roleplay_scenario = scenario

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


# --------------------------------------------------------------------------
# Bộ bài luyện tập AI cá nhân hóa (mỗi user một bộ mỗi ngày)
# --------------------------------------------------------------------------
PRACTICE_SET_SIZE = 5
PRACTICE_XP_PER_CORRECT = 4  # 5 câu đúng hết = tối đa 20 XP

PRACTICE_SYSTEM = (
    "Bạn là hệ thống sinh bài luyện tập tiếng Anh cho học viên Việt Nam trình "
    "độ A1–A2. Chỉ trả về JSON thuần (không markdown, không giải thích thêm) "
    "theo đúng cấu trúc: {\"exercises\": [{\"type\": \"MULTIPLE_CHOICE\" hoặc "
    "\"FILL_BLANK\", \"question\": \"...\", \"options\": [4 lựa chọn — chỉ với "
    "MULTIPLE_CHOICE], \"correct_answer\": \"...\", \"explanation\": \"giải "
    "thích ngắn bằng tiếng Việt\"}]}."
)


def _weak_lesson_ids(user, limit=3) -> list[int]:
    """Bài học user yếu nhất: thẻ ôn sắp đến hạn nhất + attempt sai gần nhất."""
    ordered: list[int] = []

    def _add(lesson_id):
        if lesson_id and lesson_id not in ordered:
            ordered.append(lesson_id)

    cards = (ReviewCard.query.filter_by(user_id=user.id)
             .order_by(ReviewCard.next_review_at.asc()).limit(10).all())
    for card in cards:
        exercise = db.session.get(Exercise, card.exercise_id)
        if exercise is not None:
            _add(exercise.lesson_id)
    wrong = (Attempt.query.filter_by(user_id=user.id, is_correct=False)
             .order_by(Attempt.created_at.desc(), Attempt.id.desc()).limit(10).all())
    for attempt in wrong:
        exercise = db.session.get(Exercise, attempt.exercise_id)
        if exercise is not None:
            _add(exercise.lesson_id)
    return ordered[:limit]


def _bank_exercises(user, weak_lesson_ids, size=PRACTICE_SET_SIZE) -> list[dict]:
    """Fallback: lấy bài tập thật từ DB — bài yếu trước, rồi bài đã học, rồi bất kỳ."""
    picked: list[Exercise] = []
    seen: set[int] = set()

    def _take(exercises):
        for ex in exercises:
            if len(picked) >= size:
                return
            if ex.id not in seen:
                seen.add(ex.id)
                picked.append(ex)

    if weak_lesson_ids:
        _take(Exercise.query.filter(Exercise.lesson_id.in_(weak_lesson_ids))
              .order_by(Exercise.id).all())
    if len(picked) < size:
        attempted_lesson_ids = [
            row[0] for row in
            db.session.query(Exercise.lesson_id)
            .join(Attempt, Attempt.exercise_id == Exercise.id)
            .filter(Attempt.user_id == user.id).distinct().all()
        ]
        if attempted_lesson_ids:
            _take(Exercise.query.filter(Exercise.lesson_id.in_(attempted_lesson_ids))
                  .order_by(Exercise.id).all())
    if len(picked) < size:
        _take(Exercise.query.order_by(Exercise.id).all())

    result = []
    for idx, ex in enumerate(picked):
        item = {"id": idx + 1, "type": ex.type, "question": ex.question,
                "correct_answer": ex.correct_answer,
                "explanation": ex.explanation or ""}
        if ex.options:
            item["options"] = ex.options
        result.append(item)
    return result


def _extract_json_object(text):
    """Lấy object JSON từ câu trả lời của AI (chịu được markdown fence)."""
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?", "", str(text)).strip()
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else None
    except ValueError:
        pass
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else None
        except ValueError:
            return None
    return None


def _validate_ai_exercises(data, size=PRACTICE_SET_SIZE):
    """Validate chặt output AI; không đủ câu hợp lệ thì trả None (fallback)."""
    if not isinstance(data, dict) or not isinstance(data.get("exercises"), list):
        return None
    valid = []
    for raw in data["exercises"]:
        if not isinstance(raw, dict):
            continue
        ex_type = str(raw.get("type") or "").strip().upper()
        question = str(raw.get("question") or "").strip()
        answer = str(raw.get("correct_answer") or "").strip()
        if ex_type not in ("MULTIPLE_CHOICE", "FILL_BLANK") or not question or not answer:
            continue
        item = {"type": ex_type, "question": question, "correct_answer": answer,
                "explanation": str(raw.get("explanation") or "").strip()}
        if ex_type == "MULTIPLE_CHOICE":
            options = raw.get("options")
            if (not isinstance(options, list) or len(options) < 2
                    or any(not isinstance(o, str) or not o.strip() for o in options)):
                continue
            options = [o.strip() for o in options]
            # Đáp án phải chọn được trong danh sách lựa chọn.
            if not any(_normalize_answer(o) == _normalize_answer(answer) for o in options):
                continue
            item["options"] = options
        valid.append(item)
    if len(valid) < size:
        return None
    return [dict(item, id=idx + 1) for idx, item in enumerate(valid[:size])]


def _ai_exercises(service, lessons):
    """Nhờ provider thật sinh bộ bài bám các bài học yếu; None nếu không dùng được."""
    material = []
    for lesson in lessons:
        lines = [f'Bài học "{lesson.title}": {lesson.description or ""}']
        for ex in lesson.exercises[:4]:
            lines.append(f"- ({ex.type}) {ex.question} → đáp án: {ex.correct_answer}")
        material.append("\n".join(lines))
    prompt = (
        f"Hãy sinh đúng {PRACTICE_SET_SIZE} câu luyện tập MỚI (không sao chép "
        "nguyên văn các câu mẫu) bám sát nội dung các bài học sau, hỗn hợp "
        "MULTIPLE_CHOICE (4 lựa chọn) và FILL_BLANK:\n\n" + "\n\n".join(material)
    )
    raw = service.chat([{"role": "user", "content": prompt}], PRACTICE_SYSTEM)
    return _validate_ai_exercises(_extract_json_object(raw))


@ai_bp.post("/practice/generate")
@jwt_required()
@limiter.limit(_daily_limit)
def practice_generate():
    """Tạo (hoặc trả lại) bộ bài luyện tập AI của user trong ngày hôm nay."""
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    today = date.today()
    existing = (AiPracticeSet.query.filter_by(user_id=user.id, set_date=today)
                .order_by(AiPracticeSet.id.desc()).first())
    if existing is not None:
        return ok({"set_id": existing.id, "generated_by": existing.generated_by,
                   "exercises": existing.public_exercises()})

    weak_ids = _weak_lesson_ids(user)
    lessons = [lesson for lesson in
               (db.session.get(Lesson, lid) for lid in weak_ids) if lesson]
    if not lessons:
        # Học viên mới chưa có dữ liệu điểm yếu: vẫn sinh bài bằng AI dựa trên
        # các bài đầu của lộ trình đã xuất bản thay vì bỏ qua AI.
        lessons = (Lesson.query.join(Unit, Lesson.unit_id == Unit.id)
                   .join(Course, Unit.course_id == Course.id)
                   .filter(Course.is_published.is_(True))
                   .order_by(Course.id, Unit.order_index, Lesson.order_index)
                   .limit(2).all())
        weak_ids = [lesson.id for lesson in lessons]
    service = AiService()
    exercises, generated_by = None, "bank"
    if lessons and not service.is_stub:
        try:
            exercises = _ai_exercises(service, lessons)
        except AiProviderError:
            logger.warning("AI sinh bài luyện tập thất bại — dùng ngân hàng câu hỏi")
            exercises = None
        if exercises:
            generated_by = "ai"
    if not exercises:
        exercises = _bank_exercises(user, weak_ids)

    practice_set = AiPracticeSet(
        user_id=user.id, set_date=today,
        payload=json.dumps({"generated_by": generated_by, "exercises": exercises},
                           ensure_ascii=False),
    )
    db.session.add(practice_set)
    db.session.commit()
    return ok({"set_id": practice_set.id, "generated_by": generated_by,
               "exercises": practice_set.public_exercises()})


@ai_bp.post("/practice/submit")
@jwt_required()
def practice_submit():
    """Chấm bộ bài luyện tập: 4 XP/câu đúng (tối đa 20 XP), chỉ chấm một lần."""
    user = current_user()
    if not user:
        return fail("Phiên đăng nhập không hợp lệ", 401)
    body = request.get_json(silent=True) or {}
    try:
        set_id = int(body.get("set_id"))
    except (TypeError, ValueError):
        return fail("Không tìm thấy bộ bài luyện tập", 404)
    practice_set = (AiPracticeSet.query.filter_by(id=set_id, user_id=user.id).first())
    if practice_set is None:
        return fail("Không tìm thấy bộ bài luyện tập", 404)
    if practice_set.graded:
        return fail("Bộ bài luyện tập này đã được chấm rồi", 409)
    answers = body.get("answers")
    if answers is None:
        answers = {}
    if not isinstance(answers, dict):
        return fail("Trường 'answers' phải là object {exercise_id: đáp án}")

    details, correct = [], 0
    for ex in practice_set.exercises():
        submitted = str(answers.get(str(ex.get("id")), answers.get(ex.get("id"), "")))
        is_correct = _normalize_answer(submitted) == _normalize_answer(ex.get("correct_answer"))
        correct += int(is_correct)
        details.append({
            "exercise_id": ex.get("id"), "is_correct": is_correct,
            "correct_answer": ex.get("correct_answer"),
            "explanation": ex.get("explanation") or "",
        })
    xp_awarded = PRACTICE_XP_PER_CORRECT * correct
    practice_set.graded = True
    practice_set.xp_awarded = xp_awarded
    user.xp = (user.xp or 0) + xp_awarded
    db.session.commit()
    return ok({"set_id": practice_set.id, "correct": correct,
               "total": len(details), "xp_awarded": xp_awarded,
               "details": details})


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
