"""Trả lời sẵn (canned responses) cho chat nhập vai AI (ROLEPLAY).

Mục đích: câu hỏi thường gặp trong một tình huống nhập vai thì trả lời ngay
từ danh sách cố định — nhanh và không tốn token Gemini. Câu ngoài danh sách
thì đi qua provider AI như cũ (xem ``app.services.ai_service.AiService``).

Phạm vi: CHỈ nhánh ROLEPLAY của ``POST /api/ai/chat`` và
``POST /api/ai/chat/stream``. Nhánh LESSON (gia sư) và ADMIN không dùng
canned vì câu trả lời của chúng phụ thuộc ngữ cảnh bài học / số liệu động.

Quy tắc nội dung:
- Mỗi scenario có danh sách riêng, đúng vai của AI trong scenario đó
  (barista ở quán cà phê, lễ tân ở khách sạn, ...), câu trả lời ngắn gọn
  trình độ A1–A2, tối đa 2–3 câu, thường kết thúc bằng một câu hỏi để học
  viên nói tiếp — giống quy tắc nhập vai trong ``ai_chat._ROLEPLAY_RULES``.
- Danh sách chung (``COMMON_CANNED``) dùng cho mọi scenario: chào hỏi,
  tạm biệt, cảm ơn, xin lặp lại, ...
- KHÔNG canned câu hỏi nghĩa từ ("What does ... mean?") hay bất kỳ câu nào
  mà câu trả lời phụ thuộc nội dung động (tên món cụ thể, điểm đến, số
  phòng, ...) — những câu đó luôn đi qua Gemini.

Thứ tự khớp (xem :func:`match_canned_response`): với mỗi bước, danh sách
của scenario hiện tại được xét trước, rồi mới tới danh sách chung.
"""
from __future__ import annotations

import difflib
import re
from typing import NamedTuple

# Ngưỡng fuzzy: 0.85 thay vì 0.8 — ở 0.8, "how much is a tea" khớp nhầm
# "how much is a coffee" (tỉ lệ 0.81) và cho câu trả lời sai giá. Ngoài
# ngưỡng, fuzzy còn yêu cầu tối đa 1 token khác nhau (xem
# :func:`_token_diff_count`): "two coffees please" giống "one coffee please"
# tới 0.857 nhưng khác 2 token (two/one, coffees/coffee) nên vẫn bị loại —
# thà fallback sang Gemini còn hơn trả canned sai.
FUZZY_THRESHOLD = 0.85
# Số token khác nhau tối đa để fuzzy chấp nhận: lỗi chính tả nhẹ hoặc
# thiếu/thừa đúng 1 từ. Sai 2 token trở lên thì câu đã khác nghĩa.
FUZZY_MAX_TOKEN_DIFF = 1
# Fuzzy chỉ xét chuỗi đủ dài: chuỗi quá ngắn (vd "hi") dễ khớp nhầm.
FUZZY_MIN_LENGTH = 4

_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")
_MULTI_SPACE = re.compile(r"\s+")


class CannedEntry(NamedTuple):
    """Một cặp câu hỏi–trả lời sẵn: nhiều cách hỏi, một câu trả lời cố định."""

    triggers: tuple[str, ...]
    reply: str


class CannedMatch(NamedTuple):
    """Kết quả khớp: câu trả lời + trigger đã khớp + cách khớp + nguồn."""

    reply: str
    trigger: str
    method: str  # "exact" | "keyword" | "fuzzy"
    source: str  # key scenario, hoặc "common" nếu khớp danh sách chung


def normalize_message(text: str) -> str:
    """Chuẩn hóa tin nhắn để khớp: lowercase, bỏ dấu câu, gộp khoảng trắng.

    Dấu nháy đơn được bỏ hẳn (không thay bằng khoảng trắng) để "don't"
    thành "dont" thay vì "don t", khớp được với trigger viết sẵn.
    """
    if not isinstance(text, str):
        return ""
    lowered = text.strip().lower().replace("'", "")
    cleaned = _NON_ALNUM.sub(" ", lowered)
    return _MULTI_SPACE.sub(" ", cleaned).strip()


def _entry(triggers, reply):
    return CannedEntry(tuple(triggers), reply)


# ---------------------------------------------------------------------------
# Danh sách chung — dùng cho mọi scenario (chào hỏi, cảm ơn, xin lặp lại...)
# ---------------------------------------------------------------------------
COMMON_CANNED: list[CannedEntry] = [
    _entry(("hello", "hi", "good morning", "good afternoon", "good evening"),
           "Hello! Nice to see you. How can I help you today?"),
    _entry(("how are you", "how are you today"),
           "I'm very well, thank you! And how are you?"),
    _entry(("thank you", "thanks", "thank you very much", "thanks a lot"),
           "You're welcome! Is there anything else I can help you with?"),
    _entry(("goodbye", "bye", "see you later", "see you"),
           "Goodbye! Have a nice day!"),
    _entry(("i dont understand", "i dont understand you"),
           "No problem. Let me say it again slowly. "
           "What would you like to say?"),
    _entry(("can you repeat that please", "can you repeat please",
            "please repeat", "can you say that again"),
           "Of course! I will say it again slowly."),
    _entry(("sorry", "i am sorry", "excuse me"),
           "No problem at all! How can I help you?"),
    _entry(("can you help me", "can you help"),
           "Of course! What do you need help with?"),
    _entry(("i dont know", "i am not sure"),
           "That's okay! Take your time. What would you like to talk about?"),
    _entry(("what is your name", "whats your name"),
           "My name is Alex. Nice to meet you! What is your name?"),
]

# ---------------------------------------------------------------------------
# Danh sách theo scenario — key khớp với ai_chat.ROLEPLAY_SCENARIOS
# ---------------------------------------------------------------------------
_SCENARIO_CANNED: dict[str, list[CannedEntry]] = {
    # Quán cà phê — AI là barista (nhân viên pha chế).
    "cafe": [
        _entry(("hello", "hi", "good morning", "good afternoon"),
               "Hello! Welcome to our café. What would you like today?"),
        _entry(("i would like a coffee", "i want a coffee",
                "one coffee please", "a coffee please",
                "can i have a coffee"),
               "Sure! One coffee. Would you like it hot or iced?"),
        _entry(("i would like a latte", "i want a latte",
                "one latte please", "can i have a latte"),
               "Sure! One latte. Would you like it hot or iced?"),
        _entry(("how much is a coffee", "how much does a coffee cost",
                "how much is it", "how much does it cost"),
               "A small coffee is 3 dollars and a large coffee is 4 dollars. "
               "Which size would you like?"),
        _entry(("do you have tea", "do you have any tea"),
               "Yes, we have green tea and black tea. "
               "Would you like a cup of tea?"),
        _entry(("do you have cake", "do you have any cake",
                "i would like a cake"),
               "Yes, we have chocolate cake and cheese cake. "
               "Would you like a slice?"),
        _entry(("what do you recommend", "what is popular here",
                "what is your best seller"),
               "Our best seller is the iced latte. "
               "Would you like to try one?"),
        _entry(("do you have wifi", "do you have free wifi",
                "what is the wifi password"),
               "Yes, we have free Wi-Fi. The password is coffee123. "
               "Would you like anything else?"),
        _entry(("where is the bathroom", "where is the toilet",
                "where is the restroom"),
               "The bathroom is at the back of the café, on the left. "
               "Can I get you anything else?"),
        _entry(("can i sit here", "is this seat free",
                "can i sit at this table"),
               "Yes, please sit here. Can I bring you a menu?"),
        _entry(("i would like to pay", "i want to pay", "can i pay by card",
                "can i pay with cash", "can i pay now"),
               "Of course! You can pay by card or cash. "
               "Would you like to pay now?"),
        _entry(("what time do you close", "when do you close"),
               "We close at 9 p.m. "
               "Would you like another drink before we close?"),
    ],
    # Khách sạn — AI là lễ tân.
    "hotel": [
        _entry(("hello", "hi", "good morning", "good afternoon",
                "good evening"),
               "Hello! Welcome to our hotel. How can I help you today?"),
        _entry(("i have a reservation", "i booked a room",
                "i made a reservation"),
               "Wonderful! May I have your name, please?"),
        _entry(("i would like a room", "i want to book a room",
                "do you have a free room", "do you have any rooms"),
               "Yes, we have rooms. How many nights will you stay?"),
        _entry(("how much is a room", "how much does a room cost",
                "how much per night", "how much is it per night"),
               "A standard room is 80 dollars per night, and breakfast is "
               "included. Would you like to book it?"),
        _entry(("what time is breakfast", "when is breakfast"),
               "Breakfast is from 7 a.m. to 10 a.m. in the restaurant on "
               "the first floor. Is there anything else?"),
        _entry(("what time is check out", "when do i need to check out",
                "what time do i check out"),
               "Check-out is at 12 p.m. Would you like a late check-out?"),
        _entry(("where is the elevator", "where is the lift"),
               "The elevator is on your right, next to the front desk. "
               "Is there anything else I can help with?"),
        _entry(("can i have extra towels", "i need more towels",
                "can i have more towels"),
               "Of course! I will send extra towels to your room right "
               "away. Anything else?"),
        _entry(("do you have wifi", "do you have free wifi",
                "what is the wifi password"),
               "Yes, we have free Wi-Fi for all guests. "
               "The password is hotel123. "
               "Is there anything else I can help with?"),
        _entry(("can i pay by card", "can i pay with cash",
                "i would like to pay"),
               "Yes, we accept card and cash. Would you like to pay now?"),
        _entry(("can you call a taxi", "can i get a taxi",
                "i need a taxi"),
               "Of course! I will call a taxi for you. "
               "When would you like it?"),
        _entry(("i lost my key", "i lost my room key"),
               "Don't worry! I can make a new key for you. "
               "May I have your name and room number, please?"),
    ],
    # Sân bay — AI là nhân viên quầy check-in.
    "airport": [
        _entry(("hello", "hi", "good morning", "good afternoon"),
               "Hello! Welcome. May I see your passport and ticket, please?"),
        _entry(("i would like to check in", "i want to check in",
                "can i check in"),
               "Of course! May I see your passport and ticket, please?"),
        _entry(("here is my passport", "this is my passport",
                "here is my ticket"),
               "Thank you. Where are you flying to today?"),
        _entry(("i want to check in my bag", "i would like to check my bag",
                "i have a suitcase", "i have one suitcase"),
               "No problem. Please put your bag on the scale. "
               "Do you have hand luggage too?"),
        _entry(("can i have a window seat", "i would like a window seat",
                "window seat please"),
               "Yes, a window seat. Here is your boarding pass. "
               "Enjoy your flight!"),
        _entry(("can i have an aisle seat", "i would like an aisle seat",
                "aisle seat please"),
               "Yes, an aisle seat. Here is your boarding pass. "
               "Enjoy your flight!"),
        _entry(("is my flight on time", "is the flight on time"),
               "Yes, your flight is on time. Boarding starts soon. "
               "Have a nice flight!"),
        _entry(("where is the bathroom", "where is the toilet",
                "where is the restroom"),
               "The bathrooms are near gate B10, on your left. "
               "Is there anything else?"),
        _entry(("what gate is my flight", "which gate is my flight",
                "where is my gate"),
               "Your gate is B12. Please go there one hour before your "
               "flight. Do you have any other questions?"),
        _entry(("can i change my seat", "can you change my seat"),
               "Let me check. Yes, I can change your seat. Would you like "
               "a window seat or an aisle seat?"),
    ],
    # Phỏng vấn xin việc — AI là nhà tuyển dụng (học viên là ứng viên).
    "interview": [
        _entry(("hello", "hi", "good morning", "good afternoon"),
               "Good morning! Welcome. Please sit down. "
               "Can you tell me about yourself?"),
        _entry(("nice to meet you", "pleased to meet you"),
               "Nice to meet you too! "
               "Please tell me a little about yourself."),
        _entry(("i am a student", "i am still a student"),
               "Wonderful! What subject do you study?"),
        _entry(("i just graduated", "i graduated last year"),
               "Congratulations! What did you study at university?"),
        _entry(("i have no experience", "i dont have experience",
                "i have no work experience"),
               "That's okay. Everyone starts somewhere. "
               "What are your strengths?"),
        _entry(("my strength is hard work", "i am hard working",
                "i work hard"),
               "Hard work is very important. "
               "Can you tell me about a time you worked hard?"),
        _entry(("i am a fast learner", "i learn fast", "i learn quickly"),
               "That's a great strength! Can you give me an example?"),
        _entry(("what is the salary", "how much is the salary"),
               "We can talk about salary later. First, can you tell me "
               "about your experience?"),
        _entry(("when will i know the result", "when do i get the result"),
               "We will call you next week. Thank you for coming today!"),
        _entry(("thank you for the interview", "thanks for the interview"),
               "You're welcome! It was nice to meet you. "
               "We will be in touch soon."),
        _entry(("i am nervous", "i feel nervous"),
               "Don't worry, just relax and be yourself. "
               "Shall we start with an easy question?"),
    ],
}


def scenario_entries(scenario: str | None) -> list[CannedEntry]:
    """Danh sách canned của một scenario (rỗng nếu scenario lạ/thiếu)."""
    if not isinstance(scenario, str):
        return []
    return list(_SCENARIO_CANNED.get(scenario.strip().lower(), []))


def _normalized_triggers(entry: CannedEntry) -> list[str]:
    return [normalize_message(t) for t in entry.triggers]


def _contains_phrase(tokens: list[str], phrase_tokens: list[str]) -> bool:
    """True nếu cụm từ xuất hiện liên tiếp trong danh sách token.

    Khớp theo token (không phải chuỗi con thô) để "hi" không khớp nhầm
    trong "this" hay "behind".
    """
    if not phrase_tokens or len(phrase_tokens) > len(tokens):
        return False
    width = len(phrase_tokens)
    return any(tokens[i:i + width] == phrase_tokens
               for i in range(len(tokens) - width + 1))


def _token_diff_count(a_tokens: list[str], b_tokens: list[str]) -> int:
    """Số token khác nhau giữa 2 câu theo alignment của difflib.

    Mỗi khối khác nhau (thay/thêm/bớt) đóng góp số token lớn hơn trong
    2 phía: thay 1 từ = 1, thiếu/thừa 1 từ = 1, thay 2 từ = 2.
    """
    matcher = difflib.SequenceMatcher(None, a_tokens, b_tokens, autojunk=False)
    diff = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        diff += max(i2 - i1, j2 - j1)
    return diff


def _fuzzy_best(entries: list[CannedEntry], normalized: str,
                tokens: list[str], source: str) -> CannedMatch | None:
    """Trigger giống ``normalized`` nhất trong danh sách, nếu đủ chắc chắn.

    Chấp nhận chỉ khi tỉ lệ giống vượt :data:`FUZZY_THRESHOLD` VÀ số
    token khác nhau không quá :data:`FUZZY_MAX_TOKEN_DIFF`.
    """
    best: CannedMatch | None = None
    best_ratio = FUZZY_THRESHOLD
    for entry in entries:
        for trigger in _normalized_triggers(entry):
            if len(trigger) < FUZZY_MIN_LENGTH:
                continue
            ratio = difflib.SequenceMatcher(None, normalized,
                                            trigger).ratio()
            if ratio <= best_ratio:
                continue
            if _token_diff_count(tokens, trigger.split()) > FUZZY_MAX_TOKEN_DIFF:
                continue
            best_ratio = ratio
            best = CannedMatch(entry.reply, trigger, "fuzzy", source)
    return best


def match_canned_response(message: str, scenario: str | None = None) -> CannedMatch | None:
    """Tìm câu trả lời sẵn cho ``message`` trong ``scenario`` (nếu có).

    Thứ tự ưu tiên: với mỗi bước khớp — (a) chính xác sau chuẩn hóa,
    (b) chứa cụm từ khóa (từ 2 token trở lên), (c) fuzzy với ngưỡng
    :data:`FUZZY_THRESHOLD` — danh sách của scenario được xét trước, rồi
    mới tới danh sách chung. Trả về ``None`` khi không khớp chắc chắn;
    caller khi đó fallback sang provider AI như cũ.
    """
    normalized = normalize_message(message)
    if not normalized:
        return None
    tokens = normalized.split()
    scenario_key = scenario.strip().lower() if isinstance(scenario, str) else None
    # Bước (a): chính xác — scenario trước, chung sau.
    for entries, source in ((scenario_entries(scenario_key), scenario_key or "common"),
                            (COMMON_CANNED, "common")):
        for entry in entries:
            for trigger in _normalized_triggers(entry):
                if normalized == trigger:
                    return CannedMatch(entry.reply, trigger, "exact", source)
    # Bước (b): chứa cụm từ khóa — scenario trước, chung sau. Trigger 1
    # token (hi, thanks, bye) chỉ khớp chính xác — nếu không, "hi" trong
    # "Hi, I would like a coffee" sẽ cướp mất câu gọi món.
    for entries, source in ((scenario_entries(scenario_key), scenario_key or "common"),
                            (COMMON_CANNED, "common")):
        for entry in entries:
            for trigger in _normalized_triggers(entry):
                phrase_tokens = trigger.split()
                if len(phrase_tokens) < 2:
                    continue
                if _contains_phrase(tokens, phrase_tokens):
                    return CannedMatch(entry.reply, trigger, "keyword", source)
    # Bước (c): fuzzy — scenario trước, chung sau; mỗi danh sách lấy
    # trigger giống nhất, chỉ nhận khi vượt ngưỡng (xem _fuzzy_best).
    if len(normalized) >= FUZZY_MIN_LENGTH:
        for entries, source in ((scenario_entries(scenario_key), scenario_key or "common"),
                                (COMMON_CANNED, "common")):
            best = _fuzzy_best(entries, normalized, tokens, source)
            if best is not None:
                return best
    return None


def find_canned_response(message: str, scenario: str | None = None) -> str | None:
    """Trả về câu trả lời sẵn cho ``message`` (hoặc ``None`` nếu không khớp).

    Wrapper mỏng trên :func:`match_canned_response` cho caller chỉ cần
    nội dung trả lời.
    """
    match = match_canned_response(message, scenario=scenario)
    return match.reply if match is not None else None
