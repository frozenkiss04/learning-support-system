"""AiService failover: gemini lỗi sau retry -> đường OpenAI-compatible (Groq).

Toàn bộ test mock ``requests.post`` (monkeypatch), không gọi mạng thật.
``time.sleep`` trong _post_with_retry cũng được vô hiệu để test không chậm.
"""
import pytest
import requests

from app.services import ai_service as ai_service_mod
from app.services.ai_service import AiProviderError, AiService

GROQ_BASE = "https://api.groq.com/openai/v1"
MESSAGES = [{"role": "user", "content": "Xin chào"}]


class FakeResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Server Error")

    def json(self):
        return self._payload


def _gemini_ok(text="câu trả lời gemini"):
    return FakeResp(200, {"candidates": [
        {"content": {"parts": [{"text": text}]}}]})


def _openai_ok(text="câu trả lời dự phòng"):
    return FakeResp(200, {"choices": [{"message": {"content": text}}]})


@pytest.fixture
def calls(monkeypatch):
    """Vô hiệu sleep của retry; trả về list ghi lại các lần requests.post."""
    monkeypatch.setattr("time.sleep", lambda *_a, **_k: None)
    return []


def _install_post(monkeypatch, handler):
    def fake_post(url, **kwargs):
        return handler(url, kwargs)
    monkeypatch.setattr(ai_service_mod.requests, "post", fake_post)


def _service(monkeypatch, *, fallback=None, fallback_model=None):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.setenv("OPENAI_BASE_URL", GROQ_BASE)
    if fallback is None:
        monkeypatch.delenv("AI_FALLBACK_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AI_FALLBACK_ENABLED", fallback)
    if fallback_model is None:
        monkeypatch.delenv("AI_FALLBACK_MODEL", raising=False)
    else:
        monkeypatch.setenv("AI_FALLBACK_MODEL", fallback_model)
    return AiService(provider="gemini")


def test_gemini_503_falls_back_to_openai_compatible(monkeypatch, calls):
    def handler(url, kwargs):
        calls.append((url, kwargs.get("json") or {}))
        if "generativelanguage.googleapis.com" in url:
            return FakeResp(503)
        if url.startswith(GROQ_BASE):
            return _openai_ok()
        raise AssertionError(f"URL không mong đợi: {url}")

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="true")

    assert service.chat(MESSAGES) == "câu trả lời dự phòng"

    groq_calls = [c for c in calls if c[0].startswith(GROQ_BASE)]
    assert len(groq_calls) == 1
    url, payload = groq_calls[0]
    assert url == f"{GROQ_BASE}/chat/completions"
    # AI_FALLBACK_MODEL không đặt -> mặc định llama-3.3-70b-versatile.
    assert payload["model"] == "llama-3.3-70b-versatile"
    # Gemini đã được thử đúng 3 lần (retry nội bộ) trước khi failover.
    gemini_calls = [c for c in calls if "generativelanguage" in c[0]]
    assert len(gemini_calls) == 3


def test_fallback_disabled_raises_like_before(monkeypatch, calls):
    def handler(url, kwargs):
        calls.append(url)
        if "generativelanguage.googleapis.com" in url:
            return FakeResp(503)
        raise AssertionError("không được gọi đường dự phòng khi fallback tắt")

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback=None)  # AI_FALLBACK_ENABLED không đặt

    with pytest.raises(AiProviderError):
        service.chat(MESSAGES)
    assert all("generativelanguage" in u for u in calls)


def test_fallback_also_failing_raises_primary_error(monkeypatch, calls):
    def handler(url, kwargs):
        calls.append(url)
        return FakeResp(503)  # cả gemini lẫn groq đều 503

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="1",
                       fallback_model="llama-3.3-70b-versatile")

    with pytest.raises(AiProviderError):
        service.chat(MESSAGES)
    # Có thử cả đường dự phòng rồi mới bỏ cuộc.
    assert any(u.startswith(GROQ_BASE) for u in calls)


def test_gemini_ok_first_try_never_touches_fallback(monkeypatch, calls):
    def handler(url, kwargs):
        calls.append(url)
        if "generativelanguage.googleapis.com" in url:
            return _gemini_ok()
        raise AssertionError("không được gọi đường dự phòng khi gemini OK")

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="true")

    assert service.chat(MESSAGES) == "câu trả lời gemini"
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# Streaming thật (SSE): delta sống từ provider, failover trước delta đầu
# ---------------------------------------------------------------------------
import json as _json


class FakeStreamResp:
    """Resp cho đường streaming: có status_code/raise_for_status/close và
    iter_lines; `lines` có thể là generator để mô phỏng lỗi giữa chừng."""

    def __init__(self, lines=(), status_code=200):
        self.status_code = status_code
        self._lines = lines
        self.text = ""
        self.closed = False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Server Error")

    def iter_lines(self, decode_unicode=True):
        yield from self._lines

    def close(self):
        self.closed = True


def _gemini_sse(*texts):
    return [
        "data: " + _json.dumps(
            {"candidates": [{"content": {"parts": [{"text": t}]}}]})
        for t in texts
    ]


def _openai_sse(*texts):
    lines = [
        "data: " + _json.dumps({"choices": [{"delta": {"content": t}}]})
        for t in texts
    ]
    lines.append("data: [DONE]")
    return lines


def test_gemini_stream_yields_live_deltas(monkeypatch, calls):
    seen = {}

    def handler(url, kwargs):
        seen["url"] = url
        seen["kwargs"] = kwargs
        return FakeStreamResp(_gemini_sse("Xin ", "chào ", "bạn"))

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch)
    out = "".join(service.stream(MESSAGES))
    assert out == "Xin chào bạn"
    assert ":streamGenerateContent?alt=sse" in seen["url"]
    assert seen["kwargs"].get("stream") is True


def test_gemini_stream_max_tokens_override(monkeypatch, calls):
    seen = {}

    def handler(url, kwargs):
        seen["json"] = kwargs.get("json") or {}
        return FakeStreamResp(_gemini_sse("ok"))

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch)
    assert "".join(service.stream(MESSAGES, max_tokens=400)) == "ok"
    assert seen["json"]["generationConfig"]["maxOutputTokens"] == 400


def test_stream_fails_over_before_first_delta(monkeypatch, calls):
    counts = {"gemini": 0, "openai": 0}

    def handler(url, kwargs):
        if "generativelanguage" in url:
            counts["gemini"] += 1
            return FakeStreamResp((), status_code=503)
        counts["openai"] += 1
        return FakeStreamResp(_openai_sse("trả lời dự phòng"))

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="true")
    out = "".join(service.stream(MESSAGES))
    assert out == "trả lời dự phòng"
    # 1 lần gọi đầu + 1 lần thử lại ngắn của _open_stream, rồi failover.
    assert counts["gemini"] == 2
    assert counts["openai"] == 1


def test_stream_no_failover_after_first_delta(monkeypatch, calls):
    counts = {"openai": 0}

    def broken_lines():
        yield _gemini_sse("một phần ")[0]
        raise requests.ConnectionError("mất kết nối giữa chừng")

    def handler(url, kwargs):
        if "generativelanguage" in url:
            return FakeStreamResp(broken_lines())
        counts["openai"] += 1
        return FakeStreamResp(_openai_sse("không được dùng"))

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="true")
    gen = service.stream(MESSAGES)
    assert next(gen) == "một phần "
    with pytest.raises(AiProviderError):
        next(gen)
    assert counts["openai"] == 0


def test_openai_primary_stream(monkeypatch, calls):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")
    monkeypatch.delenv("AI_FALLBACK_ENABLED", raising=False)

    def handler(url, kwargs):
        assert kwargs.get("stream") is True
        assert (kwargs.get("json") or {}).get("stream") is True
        return FakeStreamResp(_openai_sse("Hello ", "there"))

    _install_post(monkeypatch, handler)
    service = AiService(provider="openai")
    assert "".join(service.stream(MESSAGES)) == "Hello there"


def test_stub_stream_still_yields_text(monkeypatch):
    service = AiService(provider="stub")
    out = "".join(service.stream(MESSAGES))
    assert "[Chế độ stub" in out


def test_stream_forces_utf8_encoding(monkeypatch, calls):
    captured = {}

    def handler(url, kwargs):
        resp = FakeStreamResp(_gemini_sse("café ngon"))
        captured["resp"] = resp
        return resp

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch)
    assert "".join(service.stream(MESSAGES)) == "café ngon"
    # requests mặc định giải mã SSE bằng ISO-8859-1 (hỏng tiếng Việt);
    # code phải ép encoding UTF-8 lên response trước khi đọc.
    assert captured["resp"].encoding == "utf-8"


def test_gemini_stream_empty_fails_over(monkeypatch, calls):
    def handler(url, kwargs):
        if "generativelanguage" in url:
            # Stream mở thành công nhưng không có nội dung nào (candidates rỗng)
            return FakeStreamResp(
                ["data: " + _json.dumps({"candidates": []})])
        return FakeStreamResp(_openai_sse("phương án dự phòng"))

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch, fallback="true")
    assert "".join(service.stream(MESSAGES)) == "phương án dự phòng"


def test_gemini_stream_empty_without_fallback_raises(monkeypatch, calls):
    def handler(url, kwargs):
        return FakeStreamResp(["data: " + _json.dumps({"candidates": []})])

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch)  # fallback tắt
    with pytest.raises(AiProviderError):
        "".join(service.stream(MESSAGES))


def test_gemini_stream_blocked_raises_blocked_message(monkeypatch, calls):
    def handler(url, kwargs):
        return FakeStreamResp(["data: " + _json.dumps(
            {"promptFeedback": {"blockReason": "SAFETY"}})])

    _install_post(monkeypatch, handler)
    service = _service(monkeypatch)
    with pytest.raises(AiProviderError) as excinfo:
        "".join(service.stream(MESSAGES))
    assert "không được nhà cung cấp" in str(excinfo.value)


def test_openai_stream_empty_raises(monkeypatch, calls):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-openai-key")

    def handler(url, kwargs):
        return FakeStreamResp(["data: [DONE]"])

    _install_post(monkeypatch, handler)
    service = AiService(provider="openai")
    with pytest.raises(AiProviderError):
        "".join(service.stream(MESSAGES))
