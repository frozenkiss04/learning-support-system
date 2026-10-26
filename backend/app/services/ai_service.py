"""AI provider abstraction — chatbot 2 vai (tutor học viên + trợ lý admin).

The rest of the app only calls ``AiService.chat`` / ``AiService.stream`` so the
provider can be swapped via env without touching blueprints:

- ``AI_PROVIDER=gemini`` (default) — needs ``GEMINI_API_KEY``
- ``AI_PROVIDER=openai`` — needs ``OPENAI_API_KEY`` (``OPENAI_BASE_URL`` có thể
  trỏ sang endpoint tương thích OpenAI như OpenRouter)
- ``AI_PROVIDER=stub`` — or simply no key configured: stub mode. Stub replies
  are always labelled as stub, never passed off as real AI answers.

Failover (opt-in, ``AI_FALLBACK_ENABLED=true``): nếu provider chính (gemini)
lỗi sau retry nội bộ, tự chuyển sang đường OpenAI-compatible
(``OPENAI_API_KEY`` + ``OPENAI_BASE_URL``, vd Groq) với ``AI_FALLBACK_MODEL``
(mặc định ``llama-3.3-70b-versatile``).

API keys are read from env only — never hardcode them here.
Provider failures (timeout, HTTP error, malformed payload) raise
``AiProviderError`` with a user-friendly Vietnamese message; the blueprint
turns that into a 502 instead of a bare 500.
"""
from __future__ import annotations

import json
import logging
import os
import re

import requests

logger = logging.getLogger(__name__)

SYSTEM_TUTOR = (
    "Bạn là gia sư trong hệ thống hỗ trợ học tập. Giải thích ngắn gọn, dễ hiểu, "
    "gợi ý từng bước trước và không cho đáp án ngay khi học viên chưa thử làm. "
    "Nếu có ngữ cảnh bài học đi kèm, hãy bám sát bài học đó. "
    "Trả lời bằng tiếng Việt."
)

SYSTEM_ADMIN = (
    "Bạn là trợ lý quản lý trong hệ thống hỗ trợ học tập, trả lời cho quản trị "
    "viên/giáo viên. QUY TẮC BẮT BUỘC: chỉ được dùng đúng các số liệu trong mục "
    "'Số liệu hệ thống' được cung cấp kèm theo, tuyệt đối không tự bịa, không "
    "ước lượng, không suy diễn thêm số liệu. Nếu số liệu cần thiết không có "
    "trong phần được cung cấp, hãy nói rõ 'hệ thống chưa cung cấp số liệu này'. "
    "Trả lời ngắn gọn, bằng tiếng Việt, nêu con số cụ thể khi trích dẫn."
)

FRIENDLY_ERROR = (
    "Xin lỗi, trợ lý AI tạm thời không trả lời được do lỗi kết nối với nhà "
    "cung cấp AI. Vui lòng thử lại sau ít phút."
)
FRIENDLY_BLOCKED = (
    "Xin lỗi, nội dung này không được nhà cung cấp AI xử lý. "
    "Vui lòng diễn đạt lại câu hỏi theo cách khác."
)

_DEFAULT_MODELS = {"gemini": "gemini-3.8-flash", "openai": "gpt-4o-mini"}
_SUPPORTED = ("gemini", "openai", "stub")


class AiProviderError(Exception):
    """Provider failure whose message is safe/friendly to show to end users."""


class AiService:
    """One instance per request is cheap and picks up env changes."""

    def __init__(self, provider: str | None = None, model: str | None = None,
                 timeout: float | None = None):
        self.provider = (provider or os.getenv("AI_PROVIDER", "gemini")).strip().lower()
        self.model = model or os.getenv("AI_MODEL") or _DEFAULT_MODELS.get(self.provider, "")
        try:
            self.timeout = timeout or float(os.getenv("AI_TIMEOUT_SECONDS", "30"))
        except ValueError:
            self.timeout = 30.0
        # Đường streaming dùng timeout đọc ngắn hơn: Gemini "treo" không nhả
        # ký tự nào quá 15 giây thì nên nhường cho failover thay vì bắt
        # người dùng chờ hết 30 giây.
        self.stream_timeout = min(self.timeout, 15.0)
        try:
            self.max_tokens = int(os.getenv("AI_MAX_TOKENS", "1024"))
        except ValueError:
            self.max_tokens = 1024
        self._keys = {
            "gemini": os.getenv("GEMINI_API_KEY", "").strip(),
            "openai": os.getenv("OPENAI_API_KEY", "").strip(),
        }
        # Failover (opt-in): khi provider chính lỗi sau retry nội bộ, thử đường
        # OpenAI-compatible (OPENAI_API_KEY + OPENAI_BASE_URL, vd Groq) với
        # model dự phòng. Tắt mặc định — hành vi cũ giữ nguyên tới khi bật env.
        self.fallback_enabled = os.getenv(
            "AI_FALLBACK_ENABLED", "").strip().lower() in ("true", "1", "yes")
        self.fallback_model = (os.getenv("AI_FALLBACK_MODEL", "").strip()
                               or "llama-3.3-70b-versatile")

    # -- state -------------------------------------------------------------
    @property
    def configured(self) -> bool:
        """True when the selected provider has an API key available."""
        return self.provider in self._keys and bool(self._keys[self.provider])

    @property
    def is_stub(self) -> bool:
        return self.provider == "stub" or not self.configured

    @property
    def _fallback_available(self) -> bool:
        """Failover chỉ áp dụng khi provider chính là gemini (đường dự phòng
        chính là path OpenAI-compatible) và đã có OPENAI_API_KEY."""
        return (self.fallback_enabled
                and self.provider == "gemini"
                and bool(self._keys.get("openai")))

    def _fallback_models(self) -> list[str]:
        """Chuỗi model dự phòng theo thứ tự ưu tiên.

        Model được chỉ định (``AI_FALLBACK_MODEL``) đi trước, tiếp theo là
        một model free danh tiếng khác (Gemma) phòng khi model đầu bị gỡ
        hoặc hết quota free, và cuối cùng là slug ``openrouter/free`` —
        router tự chọn một model free đang sống (đổi lại chất lượng model
        do router chọn là hên xui nên chỉ dùng sau cùng).
        """
        models = []
        for m in (self.fallback_model, "google/gemma-4-31b-it:free",
                  "openrouter/free"):
            if m and m not in models:
                models.append(m)
        return models

    # -- public interface --------------------------------------------------
    def chat(self, messages: list[dict], system: str = SYSTEM_TUTOR,
             sources: list[str] | None = None,
             max_tokens: int | None = None) -> str:
        """Return the assistant reply for ``messages`` ([{role, content}]).

        Stub mode returns a clearly-labelled stub reply. Real provider
        failures raise :class:`AiProviderError` (friendly message).
        ``sources`` (RAG citation titles) only surfaces in stub mode — with a
        real provider the sources are already woven into ``system``.
        ``max_tokens`` overrides ``AI_MAX_TOKENS`` for this call (vd nhập vai
        chỉ cần trả lời ngắn).
        """
        history = self._normalize(messages)
        if self.provider not in _SUPPORTED:
            raise AiProviderError(
                f"Cấu hình AI_PROVIDER '{self.provider}' chưa được hỗ trợ. "
                "Hãy dùng 'gemini', 'openai' hoặc 'stub'."
            )
        if self.is_stub:
            return self._stub_reply(history, sources)
        try:
            if self.provider == "gemini":
                return self._convert_errors(self._gemini, history, system,
                                            max_tokens=max_tokens)
            return self._convert_errors(self._openai, history, system,
                                        max_tokens=max_tokens)
        except AiProviderError as primary_error:
            if not self._fallback_available:
                raise
            for fb_model in self._fallback_models():
                logger.info(
                    "AI fallback engaged: primary %s failed, trying "
                    "OpenAI-compatible fallback model %s",
                    self.provider, fb_model)
                try:
                    return self._convert_errors(
                        self._openai, history, system, model=fb_model,
                        max_tokens=max_tokens)
                except AiProviderError:
                    logger.warning(
                        "AI fallback (model %s) failed — trying next "
                        "in chain if any", fb_model)
            raise primary_error from None

    def _convert_errors(self, fn, *args, **kwargs):
        """Gọi một hàm provider, đổi mọi lỗi thành AiProviderError thân thiện."""
        try:
            return fn(*args, **kwargs)
        except AiProviderError:
            raise
        except requests.Timeout:
            logger.warning("AI provider %s timed out after %ss", self.provider, self.timeout)
            raise AiProviderError(FRIENDLY_ERROR) from None
        except requests.RequestException as exc:
            logger.warning("AI provider %s request failed: %s", self.provider, exc)
            raise AiProviderError(FRIENDLY_ERROR) from None
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("AI provider %s returned malformed payload: %s", self.provider, exc)
            raise AiProviderError(FRIENDLY_ERROR) from None

    def stream(self, messages: list[dict], system: str = SYSTEM_TUTOR,
               sources: list[str] | None = None,
               max_tokens: int | None = None):
        """Yield the reply as live provider deltas (SSE friendly).

        Mở kết nối streaming thật tới provider (Gemini
        ``streamGenerateContent`` / OpenAI ``stream=true``) nên ký tự đầu
        tiên tới người dùng gần như ngay khi mô hình bắt đầu sinh — thay
        cho cách cũ gọi non-streaming rồi cắt nhỏ lại (phải chờ toàn bộ
        câu trả lời). Failover chỉ kích hoạt khi provider chính lỗi TRƯỚC
        delta đầu tiên; đã phát một phần mà lỗi thì raise
        :class:`AiProviderError` giống :meth:`chat`.
        """
        history = self._normalize(messages)
        if self.provider not in _SUPPORTED:
            raise AiProviderError(
                f"Cấu hình AI_PROVIDER '{self.provider}' chưa được hỗ trợ. "
                "Hãy dùng 'gemini', 'openai' hoặc 'stub'."
            )
        if self.is_stub:
            yield from re.findall(r"\S+\s*", self._stub_reply(history, sources))
            return
        if self.provider == "gemini":
            primary = self._gemini_stream(history, system,
                                          max_tokens=max_tokens)
        else:
            primary = self._openai_stream(history, system,
                                          max_tokens=max_tokens)
        emitted = False
        primary_error = None
        try:
            for delta in primary:
                emitted = True
                yield delta
            return
        except AiProviderError as exc:
            primary_error = exc
            if emitted or not self._fallback_available:
                raise
        logger.info(
            "AI stream fallback engaged: primary %s failed before first "
            "delta, trying OpenAI-compatible fallback chain %s",
            self.provider, self._fallback_models())
        fb_emitted = False
        for fb_model in self._fallback_models():
            try:
                for delta in self._openai_stream(
                        history, system, max_tokens=max_tokens,
                        model=fb_model):
                    fb_emitted = True
                    yield delta
                return
            except AiProviderError:
                if fb_emitted:
                    # Đã phát một phần từ model này — không nối model khác
                    # vào giữa câu trả lời.
                    raise
                logger.warning(
                    "AI stream fallback (model %s) failed before first "
                    "delta — trying next in chain if any", fb_model)
        raise primary_error from None

    # -- helpers ------------------------------------------------------------
    @staticmethod
    def _normalize(messages: list[dict]) -> list[dict]:
        """Keep only user/assistant turns with non-empty string content."""
        history = []
        for m in messages or []:
            role = (m.get("role") or "user").lower()
            if role not in ("user", "assistant"):
                continue  # system prompt is passed separately, never from history
            content = str(m.get("content") or "").strip()
            if content:
                history.append({"role": role, "content": content})
        return history

    def _stub_reply(self, history: list[dict], sources: list[str] | None = None) -> str:
        last = history[-1]["content"] if history else ""
        text = (
            "[Chế độ stub — AI chưa được cấu hình] "
            f"Em đã nhận được câu hỏi: \"{last}\". "
            "Đây là câu trả lời mẫu để kiểm tra luồng chat, không phải trả lời "
            "từ AI thật. Đặt AI_PROVIDER cùng GEMINI_API_KEY hoặc "
            "OPENAI_API_KEY trong env (Render > Environment) để bật AI thật."
        )
        if sources:
            text += f"\nNguồn tham khảo liên quan: {'; '.join(sources)}"
        return text

    # -- providers -----------------------------------------------------------
    @staticmethod
    def _body_snippet(resp) -> str:
        """200 ký tự đầu của body để log chẩn đoán — không bao giờ chứa
        headers/Authorization/key (chỉ body do provider trả về)."""
        return (getattr(resp, "text", "") or "")[:200]

    def _raise_for_status(self, resp, provider: str) -> None:
        """Như ``resp.raise_for_status()`` nhưng log ERROR kèm status + đầu
        body trước khi HTTPError được ``_convert_errors`` xử lý như cũ —
        không nuốt lỗi, không đổi loại exception ném ra ngoài."""
        try:
            resp.raise_for_status()
        except requests.HTTPError:
            logger.error(
                "AI provider %s HTTP error: status=%s body=%s",
                provider, getattr(resp, "status_code", None),
                self._body_snippet(resp))
            raise

    def _parse_json(self, resp, provider: str):
        """Như ``resp.json()`` nhưng khi body không phải JSON thì log ERROR
        kèm status + đầu body (để thấy provider thật sự trả về gì, vd trang
        HTML lỗi) rồi raise AiProviderError thân thiện như hành vi hiện tại."""
        try:
            return resp.json()
        except ValueError:
            logger.error(
                "AI provider %s returned non-JSON body: status=%s body=%s",
                provider, getattr(resp, "status_code", None),
                self._body_snippet(resp))
            raise AiProviderError(FRIENDLY_ERROR) from None

    def _post_with_retry(self, url: str, **kwargs):
        """POST with a short retry on transient provider errors.

        Gemini's free tier intermittently answers 429/503 in bursts; one or
        two retries a second apart usually get through, which keeps the
        callers' fallbacks (question bank, template report) for real outages.
        """
        import time

        last_resp = None
        for attempt in range(3):
            last_resp = requests.post(url, **kwargs)
            if last_resp.status_code not in (429, 503):
                return last_resp
            if attempt < 2:
                time.sleep(1.0 if attempt == 0 else 2.5)
        return last_resp

    def _open_stream(self, url: str, **kwargs):
        """POST mở kết nối streaming (``stream=True``).

        Chỉ thử lại MỘT lần khi gặp 429/503 và chỉ chờ 0,6 giây: trên đường
        streaming, thời gian tới ký tự đầu tiên là quan trọng nhất nên
        không dùng chính sách retry dài của :meth:`_post_with_retry` — lỗi
        dai dẳng được failover xử lý ở tầng trên.
        """
        import time

        kwargs["stream"] = True
        resp = requests.post(url, **kwargs)
        if resp.status_code in (429, 503):
            try:
                resp.close()
            except Exception:
                pass
            time.sleep(0.6)
            resp = requests.post(url, **kwargs)
        return resp

    @staticmethod
    def _iter_sse_json(resp, extract):
        """Yield phần text từ các sự kiện SSE ``data: {json}`` của resp.

        ``extract(payload) -> str`` lấy text delta tùy định dạng provider.
        Bỏ qua dòng trống/không phải data/dữ liệu lỗi định dạng; dừng ở
        ``[DONE]``.
        """
        # Provider trả text/event-stream thường KHÔNG kèm charset nên
        # requests mặc định giải mã ISO-8859-1, làm hỏng ký tự UTF-8
        # ("café" thành "cafÃ©") — ép UTF-8 trước khi đọc.
        try:
            resp.encoding = "utf-8"
        except Exception:
            pass
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            line = line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if not payload:
                continue
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
            except ValueError:
                continue
            text = extract(data)
            if text:
                yield text

    @staticmethod
    def _gemini_delta(payload) -> str:
        candidates = payload.get("candidates") or []
        if not candidates:
            return ""
        parts = (candidates[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts)

    @staticmethod
    def _openai_delta(payload) -> str:
        choices = payload.get("choices") or []
        if not choices:
            return ""
        delta = choices[0].get("delta") or {}
        return delta.get("content") or ""

    def _gemini_stream(self, history: list[dict], system: str,
                       max_tokens: int | None = None,
                       model: str | None = None):
        resp = None
        state = {"chars": 0, "feedback": None}

        def extract(payload):
            if payload.get("promptFeedback"):
                state["feedback"] = payload["promptFeedback"]
            text = self._gemini_delta(payload)
            state["chars"] += len(text)
            return text

        try:
            resp = self._open_stream(
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model or self.model}:streamGenerateContent?alt=sse",
                json={
                    "system_instruction": {"parts": [{"text": system}]},
                    "contents": [
                        {"role": "model" if m["role"] == "assistant" else "user",
                         "parts": [{"text": m["content"]}]}
                        for m in history
                    ],
                    "generationConfig": {
                        "maxOutputTokens": max_tokens or self.max_tokens},
                },
                headers={"x-goog-api-key": self._keys["gemini"],
                         "Content-Type": "application/json"},
                timeout=self.stream_timeout,
            )
            self._raise_for_status(resp, "gemini")
            yield from self._iter_sse_json(resp, extract)
            if state["chars"] == 0:
                # Stream kết thúc mà không có ký tự nào (thường do bị chặn
                # an toàn): coi là lỗi provider để failover/tầng trên xử lý
                # thay vì trả về một câu trả lời rỗng im lặng.
                if state["feedback"]:
                    logger.warning(
                        "Gemini stream empty, promptFeedback: %s",
                        state["feedback"])
                    raise AiProviderError(FRIENDLY_BLOCKED)
                logger.warning("Gemini stream completed with no text")
                raise AiProviderError(FRIENDLY_ERROR)
        except AiProviderError:
            raise
        except requests.RequestException as exc:
            logger.warning("AI provider gemini stream failed: %s", exc)
            raise AiProviderError(FRIENDLY_ERROR) from None
        finally:
            if resp is not None:
                try:
                    resp.close()
                except Exception:
                    pass

    def _openai_stream(self, history: list[dict], system: str,
                       max_tokens: int | None = None,
                       model: str | None = None):
        base_url = os.getenv("OPENAI_BASE_URL",
                             "https://api.openai.com/v1").rstrip("/")
        resp = None
        state = {"chars": 0}

        def extract(payload):
            text = self._openai_delta(payload)
            state["chars"] += len(text)
            return text

        try:
            resp = self._open_stream(
                f"{base_url}/chat/completions",
                json={
                    "model": model or self.model,
                    "messages": [{"role": "system", "content": system}] + history,
                    "max_tokens": max_tokens or self.max_tokens,
                    "stream": True,
                },
                headers={"Authorization": f"Bearer {self._keys['openai']}"},
                timeout=self.stream_timeout,
            )
            self._raise_for_status(resp, "openai")
            yield from self._iter_sse_json(resp, extract)
            if state["chars"] == 0:
                logger.warning("OpenAI-compatible stream completed with no text")
                raise AiProviderError(FRIENDLY_ERROR)
        except AiProviderError:
            raise
        except requests.RequestException as exc:
            logger.warning("AI provider openai stream failed: %s", exc)
            raise AiProviderError(FRIENDLY_ERROR) from None
        finally:
            if resp is not None:
                try:
                    resp.close()
                except Exception:
                    pass

    def _gemini(self, history: list[dict], system: str,
                max_tokens: int | None = None) -> str:
        # Key goes in a header, never in the URL (URLs end up in logs/proxies).
        resp = self._post_with_retry(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent",
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [
                    {"role": "model" if m["role"] == "assistant" else "user",
                     "parts": [{"text": m["content"]}]}
                    for m in history
                ],
                "generationConfig": {
                    "maxOutputTokens": max_tokens or self.max_tokens},
            },
            headers={"x-goog-api-key": self._keys["gemini"],
                     "Content-Type": "application/json"},
            timeout=self.timeout,
        )
        self._raise_for_status(resp, "gemini")
        data = self._parse_json(resp, "gemini")
        candidates = data.get("candidates") or []
        if not candidates:
            # Usually a safety block — promptFeedback explains it, we don't.
            logger.warning("Gemini returned no candidates: %s",
                           data.get("promptFeedback"))
            raise AiProviderError(FRIENDLY_BLOCKED)
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            raise AiProviderError(FRIENDLY_BLOCKED)
        return text

    def _openai(self, history: list[dict], system: str,
                model: str | None = None,
                max_tokens: int | None = None) -> str:
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        resp = self._post_with_retry(
            f"{base_url}/chat/completions",
            json={
                "model": model or self.model,
                "messages": [{"role": "system", "content": system}] + history,
                "max_tokens": max_tokens or self.max_tokens,
            },
            headers={"Authorization": f"Bearer {self._keys['openai']}"},
            timeout=self.timeout,
        )
        self._raise_for_status(resp, "openai")
        data = self._parse_json(resp, "openai")
        text = (data["choices"][0]["message"].get("content") or "").strip()
        if not text:
            raise AiProviderError(FRIENDLY_ERROR)
        return text
