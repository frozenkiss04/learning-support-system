import { useCallback, useEffect, useRef, useState } from "react";

import { streamAiChat } from "../../lib/aiStream";

/**
 * Câu hỏi gợi ý hiển thị dạng text link trong panel (trạng thái trống).
 */
export const SUGGESTED_QUESTIONS = [
  "Giải thích bài này",
  "Cho ví dụ khác",
  "Tạo 3 câu luyện tập",
];

function streamErrorMessage(err) {
  if (err instanceof TypeError) {
    return "Không kết nối được tới máy chủ. Vui lòng kiểm tra mạng và thử lại.";
  }
  return err?.message || "Không gửi được tin nhắn. Vui lòng thử lại.";
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
 * - Gọi POST /api/ai/chat/stream (SSE) với { message, context_type:
 *   "LESSON", context_id: lessonId, session_id }; câu trả lời được chèn
 *   dần theo từng delta nên người học thấy chữ chạy ngay, và session_id
 *   backend trả về (sự kiện meta) được lưu để các tin sau đi chung phiên.
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

  /** Chạy một lượt stream cho `text`; bong bóng assistant hiện khi delta
   * đầu tiên tới (trước đó panel hiển thị trạng thái "đang trả lời"). */
  const runStream = useCallback(
    async (text) => {
      const assistantId = nextId();
      let inserted = false;
      const upsertAssistant = (content) => {
        if (!inserted) {
          inserted = true;
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content } : m,
            ),
          );
        }
      };
      try {
        const { full } = await streamAiChat({
          body: {
            message: text,
            context_type: "LESSON",
            context_id: lessonId,
            session_id: sessionIdRef.current ?? undefined,
          },
          onMeta: (evt) => {
            if (evt?.session_id != null) {
              sessionIdRef.current = evt.session_id;
              setSessionId(evt.session_id);
            }
          },
          onDelta: (_delta, fullText) => upsertAssistant(fullText),
        });
        if (!inserted || !full.trim()) {
          upsertAssistant(
            (full || "").trim() || "Chưa nhận được nội dung trả lời.",
          );
        }
      } catch (err) {
        // Chưa có chữ nào thì giữ hành vi cũ: chỉ báo lỗi (có nút thử lại).
        // Đã có một phần nội dung thì giữ lại phần đó kèm thông báo lỗi.
        setError(streamErrorMessage(err));
      }
    },
    [lessonId, nextId],
  );

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
        await runStream(text);
      } finally {
        setIsSending(false);
      }
    },
    [lessonId, isSending, nextId, runStream],
  );

  /** Gửi lại tin nhắn user gần nhất (dùng cho nút "Thử lại" khi lỗi). */
  const retryLast = useCallback(async () => {
    const text = lastUserTextRef.current;
    if (!text || isSending) return;
    setError(null);
    setIsSending(true);
    try {
      await runStream(text);
    } finally {
      setIsSending(false);
    }
  }, [isSending, runStream]);

  return { messages, sessionId, isSending, error, sendMessage, retryLast, reset };
}

export default useAiChat;
