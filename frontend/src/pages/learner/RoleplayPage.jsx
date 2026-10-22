import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BedDouble,
  Briefcase,
  Coffee,
  Drama,
  Plane,
  Send,
} from "lucide-react";

import { apiPost } from "../../lib/api";
import ChatMessage from "../../components/ai/ChatMessage";

/**
 * Nhập vai cùng AI (roleplay) — luyện hội thoại tiếng Anh theo tình huống.
 *
 * API: POST /api/ai/chat với { message, context_type: "ROLEPLAY",
 * scenario, session_id } -> payload { reply, session_id }. session_id backend
 * trả về được giữ trong state để các tin nhắn sau nối tiếp cùng một phiên.
 * Người dùng nhắn trước; phía client chỉ hiện sẵn một bong bóng gợi ý mở đầu.
 */

const SCENARIOS = [
  {
    key: "cafe",
    title: "Gọi món ở quán cà phê",
    description:
      "Đóng vai khách hàng: chào nhân viên, gọi đồ uống và thanh toán bằng tiếng Anh.",
    icon: Coffee,
  },
  {
    key: "hotel",
    title: "Nhận phòng khách sạn",
    description:
      "Đóng vai khách lưu trú: làm thủ tục nhận phòng, hỏi về tiện ích và giờ giấc.",
    icon: BedDouble,
  },
  {
    key: "airport",
    title: "Làm thủ tục ở sân bay",
    description:
      "Đóng vai hành khách: check-in, gửi hành lý và hỏi thông tin chuyến bay.",
    icon: Plane,
  },
  {
    key: "interview",
    title: "Phỏng vấn xin việc",
    description:
      "Đóng vai ứng viên: giới thiệu bản thân và trả lời câu hỏi của nhà tuyển dụng.",
    icon: Briefcase,
  },
];

const HINT_MESSAGE = {
  role: "assistant",
  content:
    "Tình huống đã sẵn sàng. Hãy bắt đầu bằng một câu chào bằng tiếng Anh — AI sẽ nhập vai và trò chuyện cùng bạn, đồng thời sửa lỗi nhẹ trong ngoặc đơn khi cần.",
};

function extractErrorMessage(err) {
  return (
    err?.serverMessage ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "Không gửi được tin nhắn. Vui lòng thử lại."
  );
}

export default function RoleplayPage() {
  const [scenario, setScenario] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef(null);
  const idRef = useRef(0);
  const sessionIdRef = useRef(null);

  const nextId = () => {
    idRef.current += 1;
    return `rp-msg-${idRef.current}`;
  };

  // Tự cuộn xuống cuối khi có tin nhắn mới hoặc đang chờ AI trả lời.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isSending, error, scenario]);

  const chooseScenario = (item) => {
    setScenario(item);
    setMessages([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setDraft("");
    setError("");
    setIsSending(false);
  };

  const backToScenarios = () => {
    setScenario(null);
    setMessages([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setDraft("");
    setError("");
    setIsSending(false);
  };

  const sendMessage = async (rawText) => {
    const text = (rawText ?? "").trim();
    if (!text || !scenario || isSending) return;

    setError("");
    setDraft("");
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
    setIsSending(true);

    try {
      const res = await apiPost("/api/ai/chat", {
        message: text,
        context_type: "ROLEPLAY",
        scenario: scenario.key,
        session_id: sessionIdRef.current ?? undefined,
      });
      const payload = res?.data ?? res ?? {};
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
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(draft);
  };

  /* ---------- Màn chọn tình huống ---------- */
  if (!scenario) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Drama className="h-5 w-5 text-green-700" aria-hidden="true" />
            Nhập vai cùng AI
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Chọn một tình huống đời thường và trò chuyện bằng tiếng Anh với AI.
            AI sẽ đóng vai người đối thoại và sửa lỗi nhẹ ngay trong hội thoại.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SCENARIOS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => chooseScenario(item)}
                className="rounded-lg border border-slate-200 bg-white p-5 text-left transition hover:border-green-700 hover:bg-green-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-green-50 text-green-700">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="mt-3 block text-sm font-semibold text-slate-900">
                  {item.title}
                </span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------- Màn chat theo tình huống ---------- */
  const ScenarioIcon = scenario.icon;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Drama className="h-5 w-5 text-green-700" aria-hidden="true" />
            Nhập vai cùng AI
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Luyện hội thoại tiếng Anh trong tình huống: {scenario.title}
          </p>
        </div>
        <button
          type="button"
          onClick={backToScenarios}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Đổi tình huống
        </button>
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {/* Thanh ngữ cảnh tình huống */}
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-50 text-green-700">
            <ScenarioIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {scenario.title}
            </p>
            <p className="truncate text-xs text-slate-500">{scenario.description}</p>
          </div>
        </div>

        {/* Danh sách tin nhắn */}
        <div ref={scrollRef} className="h-[440px] overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-3">
            <ChatMessage message={HINT_MESSAGE} />
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isSending && (
              <ChatMessage
                message={{ role: "assistant", content: "", pending: true }}
              />
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs leading-5 text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Ô nhập */}
        <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={isSending}
              placeholder="Nhắn bằng tiếng Anh..."
              aria-label="Nhập tin nhắn nhập vai"
              className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-green-700 focus:outline-none focus:ring-1 focus:ring-green-700 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              type="submit"
              disabled={isSending || !draft.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-700 text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              aria-label="Gửi tin nhắn"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
