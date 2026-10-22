import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  Database,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import api, { apiGet, apiPost } from "../../lib/api";

/**
 * Trợ lý AI quản lý (admin/teacher).
 *
 * API:
 * - GET  /api/ai/sessions                 -> [{ id, title, context_type, context_id }]
 * - POST /api/ai/chat                     -> body { message, context_type: "ADMIN", session_id? }
 *                                            trả { session_id, reply }
 *   LƯU Ý contract còn thiếu ở BE: sessions chỉ trả metadata, chưa có endpoint
 *   lấy tin nhắn của một phiên cũ (GET /api/ai/sessions/:id/messages) và chưa có
 *   trường created_at. Vì vậy khi chọn lại phiên cũ, FE tiếp tục hội thoại bằng
 *   session_id (BE vẫn giữ ngữ cảnh phía server) nhưng không hiển thị lại được
 *   nội dung cũ — UI có ghi chú rõ tại khu vực chat.
 */

const SAMPLE_QUESTIONS = [
  "Bài nào tỉ lệ sai cao nhất tuần này?",
  "Bao nhiêu học viên đang giữ streak trên 7 ngày?",
  "Khóa nào ít người học nhất?",
  "Tỉ lệ hoàn thành bài học trung bình hiện tại là bao nhiêu?",
];

function extractSessions(res) {
  const items = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
  return (Array.isArray(items) ? items : []).filter(
    (s) => !s.context_type || s.context_type === "ADMIN"
  );
}

/**
 * Thẻ "Cơ sở tri thức RAG" — trạng thái chỉ mục phục vụ AI Tutor.
 *
 * API:
 * - GET  /api/admin/rag/stats   -> { chunks, mode: "gemini" | "local", lessons_indexed, exercises_indexed }
 * - POST /api/admin/rag/reindex -> { chunks, mode } (chạy vài giây)
 * Nếu endpoint chưa sẵn sàng/lỗi ở lần tải đầu, thẻ tự ẩn để không phá trang.
 */
function RagKnowledgeCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [notice, setNotice] = useState(null); // { type: "success" | "error", text }

  const loadStats = useCallback(async () => {
    try {
      const data = await apiGet("/api/admin/rag/stats");
      setStats(data);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    setNotice(null);
    try {
      const result = await apiPost("/api/admin/rag/reindex", {});
      // Reindex chỉ trả { chunks, mode } — tải lại stats để có đủ các số liệu còn lại.
      let fresh = result;
      try {
        fresh = await apiGet("/api/admin/rag/stats");
      } catch {
        /* giữ kết quả reindex nếu stats tạm lỗi */
      }
      setStats((prev) => ({ ...(prev ?? {}), ...(fresh ?? {}) }));
      const chunks = fresh?.chunks ?? result?.chunks;
      setNotice({
        type: "success",
        text: `Đã lập chỉ mục lại xong${typeof chunks === "number" ? `: ${chunks.toLocaleString("vi-VN")} đoạn tri thức` : ""}.`,
      });
    } catch (err) {
      setNotice({
        type: "error",
        text: err?.serverMessage || err?.message || "Lập chỉ mục lại thất bại. Vui lòng thử lại.",
      });
    } finally {
      setReindexing(false);
    }
  };

  if (unavailable && !loading) return null;

  const isGemini = stats?.mode === "gemini";
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("vi-VN") : "—");
  const statItems = [
    { label: "Đoạn tri thức (chunk)", value: fmt(stats?.chunks) },
    { label: "Bài học đã lập chỉ mục", value: fmt(stats?.lessons_indexed) },
    { label: "Bài tập đã lập chỉ mục", value: fmt(stats?.exercises_indexed) },
  ];

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-50 text-green-700">
            <Database className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Cơ sở tri thức RAG</h2>
              {!loading && stats && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    isGemini
                      ? "bg-green-100 text-green-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  Embedding: {isGemini ? "Gemini" : "Cục bộ"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              AI Tutor trả lời dựa trên nội dung bài học/bài tập đã lập chỉ mục.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleReindex}
          disabled={reindexing || loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${reindexing ? "animate-spin" : ""}`} />
          {reindexing ? "Đang lập chỉ mục..." : "Lập chỉ mục lại"}
        </button>
      </div>

      {loading ? (
        <div className="mt-4 grid grid-cols-3 gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {statItems.map((item) => (
              <div key={item.label} className="rounded-md bg-slate-50 px-3 py-2.5">
                <dd className="text-lg font-semibold leading-6 text-slate-900">{item.value}</dd>
                <dt className="mt-0.5 text-xs text-slate-500">{item.label}</dt>
              </div>
            ))}
          </dl>
          {stats && !isGemini && (
            <p className="mt-3 text-xs text-slate-500">
              Đang dùng embedding cục bộ. Nạp GEMINI_API_KEY để dùng embedding Gemini.
            </p>
          )}
          {notice && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${
                notice.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {notice.type === "success" ? (
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminAiAssistant() {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [resumedSession, setResumedSession] = useState(null); // phiên cũ được mở lại
  const [messages, setMessages] = useState([]); // [{ role: "user"|"assistant", content }]
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await api.get("/api/ai/sessions");
      setSessions(extractSessions(res));
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const startNewSession = () => {
    setActiveSessionId(null);
    setResumedSession(null);
    setMessages([]);
    setError("");
    inputRef.current?.focus();
  };

  const openSession = (session) => {
    setActiveSessionId(session.id);
    setResumedSession(session);
    setMessages([]);
    setError("");
    inputRef.current?.focus();
  };

  const send = async (rawText) => {
    const text = (rawText ?? input).trim();
    if (!text || sending) return;
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await api.post("/api/ai/chat", {
        message: text,
        context_type: "ADMIN",
        session_id: activeSessionId ?? undefined,
      });
      const data = res && !Array.isArray(res) && "reply" in res ? res : res?.data ?? res;
      if (data?.session_id && data.session_id !== activeSessionId) {
        setActiveSessionId(data.session_id);
        setResumedSession(null);
        loadSessions();
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data?.reply || "Trợ lý chưa trả về nội dung." },
      ]);
    } catch (err) {
      setError(
        err?.response?.data?.error?.message ||
          "Không gửi được câu hỏi. Trợ lý quản lý chỉ dành cho tài khoản ADMIN/TEACHER, vui lòng kiểm tra lại quyền truy cập."
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const isEmpty = messages.length === 0 && !resumedSession;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      {/* Cột trái: lịch sử phiên */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={startNewSession}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            <Plus className="h-4 w-4" /> Phiên hỏi đáp mới
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Lịch sử phiên
          </p>
          {sessionsLoading && (
            <p className="inline-flex items-center gap-2 px-2 py-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
            </p>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="px-2 py-2 text-sm text-slate-500">Chưa có phiên hỏi đáp nào.</p>
          )}
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openSession(s)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    activeSessionId === s.id
                      ? "bg-slate-100 font-medium text-slate-900"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="line-clamp-2">{s.title || `Phiên #${s.id}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Khung chat chính */}
      <section className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-5 py-3">
          <h1 className="text-base font-semibold text-slate-900">Trợ lý quản lý</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Trợ lý chỉ trả lời dựa trên số liệu hệ thống cung cấp, không tự suy đoán số liệu ngoài dữ liệu.
          </p>
        </header>

        <div className="px-5 pt-4">
          <div className="mx-auto max-w-3xl">
            <RagKnowledgeCard />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {resumedSession && messages.length === 0 && (
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                Đang tiếp tục phiên &ldquo;{resumedSession.title || `Phiên #${resumedSession.id}`}&rdquo;.
                Nội dung trao đổi cũ được giữ ở phía hệ thống để làm ngữ cảnh, hiện chưa hiển thị lại được tại đây.
                Hãy nhập câu hỏi tiếp theo.
              </div>
            )}

            {isEmpty && (
              <div className="rounded-md border border-slate-200 bg-white px-5 py-5">
                <h2 className="text-sm font-semibold text-slate-900">Câu hỏi mẫu</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Chọn một câu hỏi dưới đây hoặc tự nhập câu hỏi về tình hình học tập của hệ thống.
                </p>
                <ul className="mt-3 divide-y divide-slate-100">
                  {SAMPLE_QUESTIONS.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => send(q)}
                        className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm text-slate-700 hover:text-green-800"
                      >
                        <span>{q}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((m, idx) =>
              m.role === "user" ? (
                <div key={idx} className="flex flex-col items-end">
                  <span className="mb-1 text-xs font-medium text-slate-500">Bạn</span>
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-md bg-slate-900 px-3.5 py-2.5 text-sm leading-6 text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={idx} className="flex flex-col items-start">
                  <span className="mb-1 text-xs font-medium text-slate-500">Trợ lý quản lý</span>
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-6 text-slate-800">
                    {m.content}
                  </div>
                </div>
              )
            )}

            {sending && (
              <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Đang truy vấn số liệu và soạn câu trả lời...
              </p>
            )}
          </div>
        </div>

        {/* Ô nhập */}
        <div className="border-t border-slate-200 bg-white px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Hỏi về học viên, bài học, streak, khóa học... (Enter để gửi, Shift+Enter xuống dòng)"
              className="min-h-11 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-green-700 focus:ring-1 focus:ring-green-700"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={!input.trim() || sending}
              className="inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Gửi
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-xs text-slate-400">
            Câu trả lời được tổng hợp từ dữ liệu thật trong hệ thống (học viên, lượt làm bài, streak). Kiểm tra lại số liệu quan trọng ở trang Thống kê trước khi ra quyết định.
          </p>
        </div>
      </section>
    </div>
  );
}
