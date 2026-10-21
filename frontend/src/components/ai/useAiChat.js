import { useCallback, useEffect, useRef, useState } from "react";

import api from "../../lib/api";

/**
 * Câu hỏi gợi ý hiển thị dạng text link trong panel (trạng thái trống).
 */
export const SUGGESTED_QUESTIONS = [
  "Giải thích bài này",
  "Cho ví dụ khác",
  "Tạo 3 câu luyện tập",
];

/**
 * Bóc payload từ response của api client.
 * Backend trả envelope { success, data: { session_id, reply } };
 * hàm này chịu được cả trường hợp api.js đã unwrap sẵn data.
 */
function unwrapResponse(res) {
  const body = res?.data ?? res ?? {};
  return body?.data ?? body;
}

function extractErrorMessage(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.message ||
    "Không gửi được tin nhắn. Vui lòng thử lại."
  );
}

/**
 * Hook quản lý hội thoại AI Tutor cho một bài học.
 *
 * @param {number|string|null|undefined} lessonId - id bài học làm ngữ cảnh chat.
 * @returns {{
 *   messages: Array<{id: string, role: "user"|"assistant", content: string}>,
 *   sessionId: number|null,
 *   isSending: boolean,
 *   error: string|null,
 *   sendMessage: (text: string) => Promise<void>,
 *   retryLast: () => Promise<void>,
 *   reset: () => void,
 * }}
 *
 * - Gọi POST /api/ai/chat với { message, context_type: "LESSON",
 *   context_id: lessonId, session_id } và lưu session_id backend trả về
 *   vào state để các tin nhắn sau đi chung một phiên.
 * - Đổi lessonId sẽ tự reset hội thoại + session.
 */
export function useAiChat(lessonId) {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);

  const idRef = useRef(0);
  const sessionIdRef = useRef(null);
  const lastUserTextRef = useRef(null);

  const nextId = useCallback(() => {
    idRef.current += 1;
    return `ai-msg-${idRef.current}`;
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setError(null);
    setIsSending(false);
    lastUserTextRef.current = null;
  }, []);

  // Sang bài học khác là một ngữ cảnh mới: không mang theo phiên chat cũ.
  useEffect(() => {
    reset();
  }, [lessonId, reset]);

  const sendMessage = useCallback(
    async (rawText) => {
      const text = (rawText ?? "").trim();
      if (!text || !lessonId || isSending) return;

      lastUserTextRef.current = text;
      setError(null);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: text },
      ]);
      setIsSending(true);

      try {
        const res = await api.post("/api/ai/chat", {
          message: text,
          context_type: "LESSON",
          context_id: lessonId,
          session_id: sessionIdRef.current ?? undefined,
        });
        const payload = unwrapResponse(res);

        if (payload?.session_id != null) {
          sessionIdRef.current = payload.session_id;
          setSessionId(payload.session_id);
        }
        const reply = (payload?.reply ?? "").trim();
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: reply || "Chưa nhận được nội dung trả lời.",
          },
        ]);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setIsSending(false);
      }
    },
    [lessonId, isSending, nextId],
  );

  /** Gửi lại tin nhắn user gần nhất (dùng cho nút "Thử lại" khi lỗi). */
  const retryLast = useCallback(async () => {
    const text = lastUserTextRef.current;
    if (!text || isSending) return;
    // Tin nhắn user đã nằm trong danh sách (gửi lần đầu lỗi), chỉ gọi lại API.
    setError(null);
    setIsSending(true);
    try {
      const res = await api.post("/api/ai/chat", {
        message: text,
        context_type: "LESSON",
        context_id: lessonId,
        session_id: sessionIdRef.current ?? undefined,
      });
      const payload = unwrapResponse(res);
      if (payload?.session_id != null) {
        sessionIdRef.current = payload.session_id;
        setSessionId(payload.session_id);
      }
      const reply = (payload?.reply ?? "").trim();
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: reply || "Chưa nhận được nội dung trả lời.",
        },
      ]);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSending(false);
    }
  }, [lessonId, isSending, nextId]);

  return { messages, sessionId, isSending, error, sendMessage, retryLast, reset };
}

export default useAiChat;
