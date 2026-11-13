"""Trả lời sẵn (canned responses) cho chat nhập vai AI.

Gồm 2 tầng: test matching thuần (không cần app) và test endpoint chat
(JSON + SSE) — canned thì KHÔNG gọi provider AI, ngoài list thì vẫn đi
qua provider như cũ.
"""
from unittest.mock import patch

import pytest

from app.services.canned_responses import (
    COMMON_CANNED,
    FUZZY_THRESHOLD,
    find_canned_response,
    match_canned_response,
    normalize_message,
    scenario_entries,
)


# ---------------------------------------------------------------------------
# Chuẩn hóa input
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    ("Hello!", "hello"),
    ("  HOW   ARE   YOU?  ", "how are you"),
    ("I don't understand.", "i dont understand"),
    ("Can you repeat that, please?", "can you repeat that please"),
    ("What's your name?", "whats your name"),
    ("", ""),
    (None, ""),
])
def test_normalize_message(raw, expected):
    assert normalize_message(raw) == expected


# ---------------------------------------------------------------------------
# Matching: chính xác / hoa-thường / dấu câu
# ---------------------------------------------------------------------------
def test_exact_match_scenario_reply():
    reply = find_canned_response("I would like a coffee", "cafe")
    assert reply == "Sure! One coffee. Would you like it hot or iced?"


def test_exact_match_case_and_punctuation_insensitive():
    reply = find_canned_response("HELLO!!!", "cafe")
    assert reply == "Hello! Welcome to our café. What would you like today?"
    assert find_canned_response("Hello...", "hotel") == (
        "Hello! Welcome to our hotel. How can I help you today?")


def test_exact_match_common_list_when_no_scenario():
    # Không có scenario (lượt nối tiếp không gửi scenario): chỉ xét list chung.
    assert find_canned_response("Thank you") == (
        "You're welcome! Is there anything else I can help you with?")
    # Câu riêng của scenario thì không khớp khi thiếu scenario.
    assert find_canned_response("I would like a coffee") is None


def test_scenario_list_wins_over_common_list():
    # "hello" có ở cả 2 list: scenario được ưu tiên nên câu trả lời đúng vai.
    assert find_canned_response("hello", "cafe").startswith(
        "Hello! Welcome to our café.")
    assert find_canned_response("hello", "airport").startswith(
        "Hello! Welcome. May I see your passport")
    assert find_canned_response("hello", "interview").startswith(
        "Good morning! Welcome. Please sit down.")
    # Không scenario -> câu chào chung.
    assert find_canned_response("hello").startswith("Hello! Nice to see you.")


def test_scenario_specific_question_does_not_leak_to_other_scenario():
    assert find_canned_response("I have a reservation", "hotel") is not None
    assert find_canned_response("I have a reservation", "cafe") is None
    assert find_canned_response("Can I have a window seat?", "airport") is not None
    assert find_canned_response("Can I have a window seat?", "hotel") is None


# ---------------------------------------------------------------------------
# Matching: chứa cụm từ khóa
# ---------------------------------------------------------------------------
def test_keyword_match_inside_longer_sentence():
    match = match_canned_response("Hi, I would like a coffee", "cafe")
    assert match is not None
    assert match.method == "keyword"
    assert match.trigger == "i would like a coffee"
    assert match.reply.startswith("Sure! One coffee.")


def test_keyword_match_common_phrase():
    match = match_canned_response("Thank you very much for your help", "cafe")
    assert match is not None
    assert match.method == "keyword"
    assert match.source == "common"


def test_single_word_trigger_does_not_hijack_sentence():
    # "hi" là trigger 1 token: chỉ khớp chính xác, không cướp câu gọi món.
    match = match_canned_response("Hi, I would like a coffee", "cafe")
    assert match.trigger != "hi"
    # "this" chứa "hi" nhưng không phải token "hi" -> không khớp chào hỏi.
    assert match_canned_response("This is my first time here", "cafe") is None


# ---------------------------------------------------------------------------
# Matching: fuzzy
# ---------------------------------------------------------------------------
def test_fuzzy_match_missing_word():
    match = match_canned_response("I would like coffee", "cafe")
    assert match is not None
    assert match.method == "fuzzy"
    assert match.trigger == "i would like a coffee"


def test_fuzzy_match_light_typo():
    assert match_canned_response("I would like a coffe", "cafe").method == "fuzzy"
    assert match_canned_response("Where is the bathrom?", "cafe").method == "fuzzy"
    assert match_canned_response("thank yuo", "cafe").method == "fuzzy"
    assert match_canned_response("good mornig", "cafe").method == "fuzzy"
    assert match_canned_response("helo", "cafe").method == "fuzzy"


def test_fuzzy_rejects_two_token_differences():
    # Sai 2 token trở lên là câu khác nghĩa -> fallback sang Gemini.
    assert find_canned_response("wher is the bathrom", "cafe") is None
    # "two coffees" khác hẳn "one coffee" (số lượng) dù tỉ lệ giống cao.
    assert find_canned_response("two coffees please", "cafe") is None
    assert find_canned_response("I want two lattes please", "cafe") is None
    # Hỏi giá trà nhưng trigger là giá cà phê -> không được trả sai giá.
    assert find_canned_response("how much is a tea", "cafe") is None


def test_fuzzy_threshold_is_high():
    assert FUZZY_THRESHOLD >= 0.8


# ---------------------------------------------------------------------------
# Matching: ngoài list -> None (fallback sang Gemini)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("message", [
    "What does cappuccino mean?",  # hỏi nghĩa từ: nội dung động, không canned
    "Tell me about the history of coffee",
    "Yes",  # câu trả lời 1 từ phụ thuộc ngữ cảnh, không canned
    "No, just looking around",
    "I am flying to London tomorrow",
    "My name is Anna and I am from Hanoi",
])
def test_no_match_returns_none(message):
    assert find_canned_response(message, "cafe") is None


# ---------------------------------------------------------------------------
# Nội dung danh sách: đủ cặp, đúng định dạng A1/A2 ngắn gọn
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("scenario", ["cafe", "hotel", "airport", "interview"])
def test_each_scenario_has_8_to_12_pairs(scenario):
    entries = scenario_entries(scenario)
    assert 8 <= len(entries) <= 12
    for entry in entries:
        assert entry.triggers
        assert entry.reply
        # Trả lời nhập vai tối đa 2-3 câu (quy tắc _ROLEPLAY_RULES);
        # "a.m."/"p.m." không tính là hết câu.
        squashed = entry.reply.replace("a.m.", "am").replace("p.m.", "pm")
        assert squashed.count(".") + squashed.count("?") <= 3


def test_common_list_covers_greetings_and_politeness():
    assert len(COMMON_CANNED) >= 8
    triggers = {t for e in COMMON_CANNED for t in e.triggers}
    for phrase in ("hello", "thank you", "goodbye", "i dont understand",
                   "can you repeat that please", "how are you", "sorry"):
        assert phrase in triggers


def test_unknown_scenario_falls_back_to_common_only():
    assert find_canned_response("hello", "unknown-scenario").startswith(
        "Hello! Nice to see you.")
    assert find_canned_response("I would like a coffee",
                                "unknown-scenario") is None


# ---------------------------------------------------------------------------
# Endpoint JSON: POST /api/ai/chat
# ---------------------------------------------------------------------------
def _roleplay_chat(client, headers, message, scenario="cafe", session_id=None):
    body = {"message": message, "context_type": "ROLEPLAY",
            "scenario": scenario}
    if session_id is not None:
        body["session_id"] = session_id
    return client.post("/api/ai/chat", json=body, headers=headers)


@patch("app.blueprints.ai_chat.AiService")
def test_chat_canned_reply_does_not_call_provider(mock_ai_cls, client,
                                                  learner_headers):
    resp = _roleplay_chat(client, learner_headers, "Hello!", scenario="cafe")
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["reply"] == "Hello! Welcome to our café. What would you like today?"
    assert data["source"] == "canned"
    assert data["provider"] == "canned"
    # AiService không được khởi tạo, càng không gọi chat/stream.
    mock_ai_cls.assert_not_called()
    mock_ai_cls.return_value.chat.assert_not_called()
    mock_ai_cls.return_value.stream.assert_not_called()


@patch("app.blueprints.ai_chat.AiService")
def test_chat_canned_reply_is_saved_in_session(mock_ai_cls, client,
                                               learner_headers):
    resp = _roleplay_chat(client, learner_headers, "Thank you", scenario="hotel")
    session_id = resp.get_json()["data"]["session_id"]
    detail = client.get(f"/api/ai/sessions/{session_id}",
                        headers=learner_headers)
    messages = detail.get_json()["data"]["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"].startswith("You're welcome!")


@patch("app.blueprints.ai_chat.AiService")
def test_chat_non_canned_goes_through_provider(mock_ai_cls, client,
                                               learner_headers):
    service = mock_ai_cls.return_value
    service.chat.return_value = "FAKE GEMINI REPLY"
    service.provider = "gemini"
    service.is_stub = False
    resp = _roleplay_chat(client, learner_headers,
                          "What does cappuccino mean?", scenario="cafe")
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["reply"] == "FAKE GEMINI REPLY"
    assert data["source"] == "ai"
    service.chat.assert_called_once()


@patch("app.blueprints.ai_chat.AiService")
def test_chat_lesson_context_never_uses_canned(mock_ai_cls, client,
                                               learner_headers, sample_course):
    service = mock_ai_cls.return_value
    service.chat.return_value = "FAKE TUTOR REPLY"
    service.provider = "gemini"
    service.is_stub = False
    resp = client.post("/api/ai/chat",
                       json={"message": "Hello!", "context_type": "LESSON",
                             "context_id": sample_course["lesson_id"]},
                       headers=learner_headers)
    assert resp.status_code == 200
    assert resp.get_json()["data"]["reply"] == "FAKE TUTOR REPLY"
    service.chat.assert_called_once()


@patch("app.blueprints.ai_chat.AiService")
def test_chat_continuation_without_scenario_uses_common_only(
        mock_ai_cls, client, learner_headers):
    # Lượt 1 tạo phiên cafe (câu ngoài list -> đi qua provider).
    service = mock_ai_cls.return_value
    service.chat.return_value = "FAKE GEMINI REPLY"
    service.provider = "gemini"
    service.is_stub = False
    first = _roleplay_chat(client, learner_headers,
                           "Tell me about this café", scenario="cafe")
    session_id = first.get_json()["data"]["session_id"]
    assert service.chat.call_count == 1

    # Lượt 2 không gửi scenario: câu chung vẫn canned, câu riêng cafe thì không.
    resp = client.post("/api/ai/chat",
                       json={"message": "Thank you", "session_id": session_id},
                       headers=learner_headers)
    assert resp.get_json()["data"]["source"] == "canned"
    assert service.chat.call_count == 1  # không gọi thêm provider

    resp = client.post("/api/ai/chat",
                       json={"message": "I would like a coffee",
                             "session_id": session_id},
                       headers=learner_headers)
    assert resp.get_json()["data"]["reply"] == "FAKE GEMINI REPLY"
    assert service.chat.call_count == 2


# ---------------------------------------------------------------------------
# Endpoint SSE: POST /api/ai/chat/stream
# ---------------------------------------------------------------------------
def _roleplay_stream(client, headers, message, scenario="cafe"):
    return client.post("/api/ai/chat/stream",
                       json={"message": message, "context_type": "ROLEPLAY",
                             "scenario": scenario},
                       headers=headers)


@patch("app.blueprints.ai_chat.AiService")
def test_stream_canned_reply_same_sse_format_no_provider_call(
        mock_ai_cls, client, learner_headers):
    resp = _roleplay_stream(client, learner_headers, "Hello!", scenario="cafe")
    assert resp.status_code == 200
    assert resp.mimetype == "text/event-stream"
    body = resp.get_data(as_text=True)
    assert '"source": "canned"' in body
    assert "Hello! Welcome to our café. What would you like today?" in body
    assert "[DONE]" in body
    mock_ai_cls.assert_not_called()


@patch("app.blueprints.ai_chat.AiService")
def test_stream_non_canned_goes_through_provider(mock_ai_cls, client,
                                                 learner_headers):
    service = mock_ai_cls.return_value
    service.stream.return_value = iter(["fake ", "gemini reply"])
    service.provider = "gemini"
    service.is_stub = False
    resp = _roleplay_stream(client, learner_headers,
                            "What does cappuccino mean?", scenario="cafe")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert '"source": "ai"' in body
    # 2 chunk "fake " + "gemini reply" đi trong 2 delta riêng.
    assert '"delta": "fake "' in body
    assert '"delta": "gemini reply"' in body
    assert "[DONE]" in body
    service.stream.assert_called_once()
