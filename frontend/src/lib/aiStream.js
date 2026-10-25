import { API_BASE_URL, refreshAccessToken } from "./api";
import { useAuthStore } from "../stores/authStore";

/**
 * Gọi POST /api/ai/chat/stream (SSE) bằng fetch + ReadableStream.
 *
 * Axios không đọc được stream nên luồng chat AI dùng helper này: token lấy
 * từ auth store giống request interceptor của api.js; gặp 401 thì làm mới
 * token một lần rồi thử lại (dùng chung refreshAccessToken của api.js).
 *
 * Sự kiện từ backend: meta (session_id) -> sources (khi có RAG) ->
 * delta * n -> [DONE]; lỗi provider đến qua sự kiện error, lỗi validate/
 * giới hạn đến qua HTTP status + envelope JSON như API thường.
 *
 * @param {object} args
 * @param {object} args.body - { message, context_type, context_id?, scenario?, session_id? }
 * @param {(evt: object) => void} [args.onMeta]
 * @param {(sources: string[]) => void} [args.onSources]
 * @param {(delta: string, fullText: string) => void} [args.onDelta]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ sessionId: number|null, full: string }>}
 */
export async function streamAiChat({ body, onMeta, onSources, onDelta, signal }) {
  const doFetch = (token) =>
    fetch(`${API_BASE_URL}/api/ai/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

  let res = await doFetch(useAuthStore.getState().accessToken);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    res = await doFetch(fresh);
  }

  if (!res.ok || !res.body) {
    let message = "Không gửi được tin nhắn. Vui lòng thử lại.";
    try {
      const payload = await res.json();
      message = payload?.error?.message || message;
    } catch {
      /* body không phải JSON — giữ thông báo mặc định */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let sessionId = null;

  const handleEvent = (rawEvent) => {
    const dataLine = rawEvent
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return false;
    const data = dataLine.slice("data:".length).trim();
    if (data === "[DONE]") return true;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return false;
    }
    if (evt.type === "meta") {
      sessionId = evt.session_id ?? null;
      onMeta?.(evt);
    } else if (evt.type === "sources") {
      onSources?.(evt.sources || []);
    } else if (evt.type === "delta") {
      full += evt.delta || "";
      onDelta?.(evt.delta || "", full);
    } else if (evt.type === "error") {
      const err = new Error(evt.message || "Trợ lý AI tạm thời không trả lời được.");
      err.aiError = true;
      throw err;
    }
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (handleEvent(rawEvent)) return { sessionId, full };
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return { sessionId, full };
}

export default streamAiChat;
