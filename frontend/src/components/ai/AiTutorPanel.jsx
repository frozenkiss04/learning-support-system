import { useEffect, useRef, useState } from "react";
import { BookOpen, Send } from "lucide-react";

import ChatMessage from "./ChatMessage";
import { SUGGESTED_QUESTIONS, useAiChat } from "./useAiChat";

// Chip hỏi nhanh phía trên ô nhập — bấm là gửi luôn qua sendMessage.
const QUICK_CHIPS = [
  "Giải thích bài này",
  "Cho thêm ví dụ",
  "Ra câu hỏi luyện tập",
  "Mẹo nhớ lâu",
];

/**
 * Panel AI Tutor cố định ở cột phải trang bài học.
 *
 * Props contract (LessonPage truyền vào):
 * - lesson: { id: number|string, title: string } | null
 *     Bài học hiện tại. Thiếu lesson/id thì panel ở trạng thái
 *     "Chưa chọn bài học" và khóa ô nhập.
 * - className?: string — class bổ sung để trang cha căn layout nếu cần.
 *     Mặc định panel đã có sẵn: w-[360px] shrink-0, border-l, flex cột, h-full.
 *
 * Ví dụ gắn vào LessonPage:
 *   <div className="flex h-full">
 *     <div className="flex-1 overflow-y-auto">...nội dung bài...</div>
 *     <AiTutorPanel lesson={lesson} />
 *   </div>
 */
export default function AiTutorPanel({ lesson, className = "" }) {
  const lessonId = lesson?.id ?? null;
  const { messages, isSending, error, sendMessage, retryLast } =
    useAiChat(lessonId);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  // Tự cuộn xuống cuối khi có tin nhắn mới hoặc trạng thái đang trả lời đổi.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending, error]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending || !lessonId) return;
    setDraft("");
    sendMessage(text);
  };

  const handleSuggestion = (question) => {
    if (isSending || !lessonId) return;
    sendMessage(question);
  };

  const inputDisabled = !lessonId || isSending;

  return (
    <aside
      className={`flex h-full w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white ${className}`}
      aria-label="Trợ lý học tập"
    >
      {/* Header phẳng + chip ngữ cảnh */}
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Trợ lý học tập</h2>
        <div className="mt-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="truncate">
              {lesson?.title
                ? `Đang hỏi về: ${lesson.title}`
                : "Chưa chọn bài học"}
            </span>
          </span>
        </div>
      </div>

      {/* Danh sách tin nhắn */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isSending ? (
          <div>
            <p className="text-sm leading-6 text-slate-500">
              Hỏi trợ lý về nội dung bài học này: giải thích khái niệm, xin ví
              dụ hoặc tạo thêm câu luyện tập.
            </p>
            <div className="mt-3 flex flex-col items-start gap-1.5">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => handleSuggestion(question)}
                  disabled={!lessonId}
                  className="text-left text-sm text-green-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isSending && (
              <ChatMessage
                message={{ role: "assistant", content: "", pending: true }}
              />
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-xs leading-5 text-red-700">{error}</p>
            <button
              type="button"
              onClick={retryLast}
              className="mt-1 text-xs font-medium text-red-700 hover:underline"
            >
              Thử lại
            </button>
          </div>
        )}
      </div>

      {/* Ô nhập */}
      <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleSuggestion(chip)}
              disabled={inputDisabled}
              className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-green-700 hover:text-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={inputDisabled}
            placeholder={
              lessonId ? "Hỏi về bài học này..." : "Chọn một bài học để bắt đầu"
            }
            className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700 disabled:bg-slate-50 disabled:text-slate-400"
            aria-label="Nhập câu hỏi cho trợ lý"
          />
          <button
            type="submit"
            disabled={inputDisabled || !draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-700 text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            aria-label="Gửi tin nhắn"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}
