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
