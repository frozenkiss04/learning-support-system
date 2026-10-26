/**
 * Một tin nhắn trong panel AI Tutor — dạng phẳng, không avatar, không hiệu ứng.
 *
 * Props:
 * - message: { role: "user" | "assistant", content: string, pending?: boolean }
 *   + pending = true: hiển thị trạng thái đang soạn (3 chấm) thay cho content.
 * - role, content: truyền rời thay cho message cũng được.
 *
 * Kiểu dáng:
 * - user: căn phải, nền primary nhạt (green-50), viền green-200.
 * - assistant: căn trái, nền white, viền slate-200.
 */
export default function ChatMessage({ message, role, content }) {
  const msgRole = message?.role ?? role;
  const msgContent = message?.content ?? content ?? "";
  const pending = Boolean(message?.pending);
  const isUser = msgRole === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-lg border border-green-200 bg-green-50 px-3 py-2"
            : "max-w-[85%] rounded-lg border border-slate-200 bg-white px-3 py-2"
        }
      >
        {pending ? (
          <span
            className="flex items-center gap-1 py-1"
            role="status"
            aria-label="Đang trả lời"
          >
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
          </span>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
              {msgContent}
            </p>
            {Array.isArray(message?.sources) && message.sources.length > 0 && (
              <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                Nguồn tham khảo: {message.sources.join(" · ")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
