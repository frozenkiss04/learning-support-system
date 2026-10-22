import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Ear,
  Headphones,
  Loader2,
  Mic,
  Shuffle,
  Turtle,
  Volume2,
  XCircle,
} from "lucide-react";
import { apiGet } from "../../lib/api";
import { EmptyState } from "../../components/ui/EmptyState";
import * as sounds from "../../lib/sounds";

/**
 * Phòng luyện kỹ năng — 2 bài luyện dựng từ thẻ ôn tập SRS.
 *
 * Nguồn câu: GET /api/progress/due?limit=50 -> [{ exercise_id, exercise }]
 * Chỉ giữ exercise thuộc loại TRANSLATE / FILL_BLANK / MULTIPLE_CHOICE có
 * correct_answer là câu/từ tiếng Anh — dùng chính correct_answer làm câu đích.
 * Pool < 3 -> EmptyState hướng dẫn học bài trước.
 *
 * - Tab "Nghe & chép" (dictation): phát câu bằng speechSynthesis (en-US),
 *   người học gõ lại, chấm theo đáp án đã chuẩn hóa.
 * - Tab "Luyện nói" (speaking): nhận diện giọng nói Web Speech API (en-US),
 *   chấm theo tỉ lệ từ khớp với câu mẫu.
 */

const MIN_POOL = 3;
const USABLE_TYPES = new Set(["TRANSLATE", "FILL_BLANK", "MULTIPLE_CHOICE"]);

const TYPE_LABELS = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  FILL_BLANK: "Điền từ",
  TRANSLATE: "Dịch câu",
};

/** Chuẩn hóa để chấm: chữ thường, gộp khoảng trắng, bỏ dấu câu ở cuối. */
function normalizeAnswer(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\s.!?,;:]+$/, "");
}

function wordsOf(value) {
  const normalized = normalizeAnswer(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function isUsable(card) {
  const exercise = card?.exercise;
  if (!exercise) return false;
  const answer =
    typeof exercise.correct_answer === "string"
      ? exercise.correct_answer.trim()
      : "";
  if (!answer || !/[a-zA-Z]/.test(answer)) return false;
  const type = String(exercise.type ?? "").toUpperCase();
  return type === "" || USABLE_TYPES.has(type);
}

/** Phát câu bằng TTS của trình duyệt. Trả về false nếu không hỗ trợ. */
function speak(text, rate = 0.92) {
  try {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = rate;
    window.speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

export default function SkillsPage() {
  // phase: loading | error | ready
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [pool, setPool] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [tab, setTab] = useState("dictation"); // dictation | speaking

  const [ttsSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [speechSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  );

  // --- Dictation ---
  const [dInput, setDInput] = useState("");
  const [dResult, setDResult] = useState(null); // { correct }
  const [dStats, setDStats] = useState({ total: 0, correct: 0 });

  // --- Speaking ---
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [listenError, setListenError] = useState("");
  const [sResult, setSResult] = useState(null); // { ratio, level }
  const [sStats, setSStats] = useState({ total: 0, good: 0 });
  const recognitionRef = useRef(null);

  const load = async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const data = await apiGet("/api/progress/due", {
        params: { limit: 50 },
      });
      const cards = (Array.isArray(data) ? data : []).filter(isUsable);
      setPool(cards);
      setCurrentIdx(
        cards.length > 0 ? Math.floor(Math.random() * cards.length) : 0,
      );
      setPhase("ready");
    } catch (err) {
      setLoadError(
        err?.response?.data?.error?.message ||
          err?.serverMessage ||
          "Không tải được câu luyện. Vui lòng thử lại.",
      );
      setPhase("error");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = () => {
    const rec = recognitionRef.current;
    if (rec) {
      recognitionRef.current = null;
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        /* recognition đã dừng — bỏ qua */
      }
    }
    setListening(false);
  };

  // Dọn TTS + recognition khi rời trang.
  useEffect(
    () => () => {
      stopListening();
      try {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      } catch {
        /* bỏ qua */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const currentCard = pool[currentIdx] ?? null;
  const currentExercise = currentCard?.exercise ?? null;
  const target = currentExercise?.correct_answer?.trim() ?? "";
  const typeLabel =
    TYPE_LABELS[String(currentExercise?.type ?? "").toUpperCase()] || "Bài tập";

  const resetSentenceState = () => {
    setDInput("");
    setDResult(null);
    setTranscript("");
    setSResult(null);
    setListenError("");
  };

  const nextSentence = () => {
    if (pool.length === 0) return;
    stopListening();
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === currentIdx) idx = (idx + 1) % pool.length;
    setCurrentIdx(idx);
    resetSentenceState();
  };

  const switchTab = (next) => {
    if (next === tab) return;
    stopListening();
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {
      /* bỏ qua */
    }
    setTab(next);
  };

  // ---------------- Dictation ----------------

  const checkDictation = () => {
    if (dResult || !target || !dInput.trim()) return;
    const correct = normalizeAnswer(dInput) === normalizeAnswer(target);
    if (correct) sounds.correct();
    else sounds.wrong();
    setDResult({ correct });
    setDStats((prev) => ({
      total: prev.total + 1,
      correct: prev.correct + (correct ? 1 : 0),
    }));
  };

  /** Render đáp án chuẩn, gạch chân đỏ các từ người học gõ thiếu/sai vị trí. */
  const renderAnswerDiff = () => {
    const userWords = new Set(wordsOf(dInput));
    return wordsOf(target).map((word, i) => {
      const present = userWords.has(word);
      return (
        <span
          key={i}
          className={
            present
              ? undefined
              : "font-semibold text-red-600 underline decoration-red-300 underline-offset-4"
          }
        >
          {word}
          {i < wordsOf(target).length - 1 ? " " : ""}
        </span>
      );
    });
  };

  // ---------------- Speaking ----------------

  const scoreSpeaking = (text) => {
    const targetWords = wordsOf(target);
    if (targetWords.length === 0) return;
    const heardCounts = new Map();
    wordsOf(text).forEach((w) =>
      heardCounts.set(w, (heardCounts.get(w) ?? 0) + 1),
    );
    let matched = 0;
    targetWords.forEach((w) => {
      const left = heardCounts.get(w) ?? 0;
      if (left > 0) {
        matched += 1;
        heardCounts.set(w, left - 1);
      }
    });
    const ratio = matched / targetWords.length;
    const level = ratio >= 0.8 ? "good" : ratio >= 0.5 ? "ok" : "low";
    if (level === "good") sounds.correct();
    else if (level === "low") sounds.wrong();
    setSResult({ ratio, level });
    setSStats((prev) => ({
      total: prev.total + 1,
      good: prev.good + (level === "good" ? 1 : 0),
    }));
  };

  const startListening = () => {
    if (!speechSupported || listening) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    stopListening();
    setListenError("");
    setTranscript("");
    setSResult(null);
    try {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        const text = event.results?.[0]?.[0]?.transcript ?? "";
        setTranscript(text);
        if (text.trim()) scoreSpeaking(text);
      };
      rec.onerror = (event) => {
        const code = event?.error;
        if (code === "not-allowed" || code === "service-not-allowed") {
          setListenError(
            "Bạn chưa cấp quyền dùng micro. Hãy cho phép micro trên thanh địa chỉ của trình duyệt rồi thử lại.",
          );
        } else if (code === "no-speech") {
          setListenError("Chưa nghe thấy giọng nói. Hãy thử nói lại, rõ và gần micro hơn.");
        } else if (code === "aborted") {
          setListenError("");
        } else {
          setListenError("Không nhận diện được giọng nói lần này. Vui lòng thử lại.");
        }
      };
      rec.onend = () => {
        if (recognitionRef.current === rec) recognitionRef.current = null;
        setListening(false);
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListenError("Không khởi động được nhận diện giọng nói. Vui lòng thử lại.");
      setListening(false);
    }
  };

  const toggleListening = () => {
    if (listening) stopListening();
    else startListening();
  };

  // ---------------- Render ----------------

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header trang */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Headphones className="h-5 w-5 text-primary-700" aria-hidden="true" />
          Phòng luyện kỹ năng
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Luyện nghe — chép và luyện nói tiếng Anh bằng chính các câu trong
          thẻ ôn tập của bạn. Nghe mẫu phát bằng giọng đọc của trình duyệt,
          phần nói được chấm theo độ khớp từ với câu mẫu.
        </p>
      </div>

      {phase === "loading" ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Đang chuẩn bị câu luyện...
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-slate-900">Đã xảy ra lỗi</p>
          <p className="mt-1 max-w-sm text-sm text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            Thử lại
          </button>
        </div>
      ) : pool.length < MIN_POOL ? (
        <EmptyState
          icon={<Headphones className="h-5 w-5" aria-hidden="true" />}
          title="Chưa đủ câu để luyện kỹ năng"
          description={`Phòng luyện cần ít nhất ${MIN_POOL} câu có đáp án từ thẻ ôn tập. Hiện bạn có ${pool.length} câu sẵn sàng — hãy học thêm bài mới để tích lũy thẻ, các câu luyện sẽ tự xuất hiện tại đây.`}
          action={
            <>
              <Link
                to="/learn"
                className="inline-flex items-center gap-2 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Học thêm bài
              </Link>
              <Link
                to="/review"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                Tới trang Ôn tập
              </Link>
            </>
          }
        />
      ) : (
        <>
          {/* Tabs */}
          <div
            className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1"
            role="tablist"
            aria-label="Chọn bài luyện"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "dictation"}
              onClick={() => switchTab("dictation")}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 ${
                tab === "dictation"
                  ? "bg-primary-700 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Ear className="h-4 w-4" aria-hidden="true" />
              Nghe &amp; chép
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "speaking"}
              onClick={() => switchTab("speaking")}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 ${
                tab === "speaking"
                  ? "bg-primary-700 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
              Luyện nói
            </button>
          </div>

          {/* Thanh thông tin câu hiện tại */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                {typeLabel}
              </span>
              <span>
                Kho câu luyện:{" "}
                <span className="font-semibold tabular-nums text-slate-900">
                  {pool.length}
                </span>{" "}
                câu
              </span>
            </div>
            <button
              type="button"
              onClick={nextSentence}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <Shuffle className="h-4 w-4" aria-hidden="true" />
              Đổi câu
            </button>
          </div>

          {tab === "dictation" ? (
            /* ---------- TAB NGHE & CHÉP ---------- */
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Nghe và chép lại câu
                </h2>
                <span className="text-sm text-slate-500">
                  Đúng{" "}
                  <span className="font-semibold tabular-nums text-slate-900">
                    {dStats.correct}
                  </span>
                  /
                  <span className="tabular-nums">{dStats.total}</span> câu trong
                  phiên
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Bấm Nghe, sau đó gõ lại đúng những gì bạn nghe được.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => speak(target, 0.92)}
                  disabled={!ttsSupported}
                  className="inline-flex items-center gap-2 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                  Nghe
                </button>
                <button
                  type="button"
                  onClick={() => speak(target, 0.7)}
                  disabled={!ttsSupported}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Turtle className="h-4 w-4" aria-hidden="true" />
                  Nghe chậm
                </button>
              </div>
              {!ttsSupported && (
                <p className="mt-3 text-sm text-amber-700">
                  Trình duyệt này không hỗ trợ phát giọng đọc — hãy dùng
                  Chrome hoặc Edge để nghe câu mẫu.
                </p>
              )}

              <form
                className="mt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  checkDictation();
                }}
              >
                <label
                  htmlFor="dictation-input"
                  className="text-sm font-medium text-slate-700"
                >
                  Câu bạn nghe được
                </label>
                <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
                  <input
                    id="dictation-input"
                    type="text"
                    value={dInput}
                    disabled={Boolean(dResult)}
                    onChange={(event) => setDInput(event.target.value)}
                    placeholder="Gõ lại câu tiếng Anh bạn vừa nghe..."
                    autoComplete="off"
                    className={`h-11 w-full rounded-md border bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50 ${
                      dResult
                        ? dResult.correct
                          ? "border-green-500 focus:border-green-600 focus:ring-green-100"
                          : "border-red-400 focus:border-red-500 focus:ring-red-100"
                        : "border-slate-300 focus:border-primary-600 focus:ring-primary-100"
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={Boolean(dResult) || !dInput.trim()}
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Kiểm tra
                  </button>
                </div>
              </form>

              {dResult && (
                <div
                  className={`mt-5 rounded-md border px-4 py-3 ${
                    dResult.correct
                      ? "border-green-200 bg-green-50"
                      : "border-red-200 bg-red-50"
                  }`}
                  aria-live="polite"
                >
                  <p
                    className={`flex items-center gap-1.5 text-sm font-semibold ${
                      dResult.correct ? "text-green-800" : "text-red-700"
                    }`}
                  >
                    {dResult.correct ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Chính xác!
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Chưa đúng — xem đáp án chuẩn bên dưới
                      </>
                    )}
                  </p>
                  {!dResult.correct && (
                    <div className="mt-2 space-y-1.5 text-sm">
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-500">
                          Đáp án đúng:{" "}
                        </span>
                        {renderAnswerDiff()}
                      </p>
                      <p className="text-slate-700">
                        <span className="font-medium text-slate-500">
                          Bạn đã gõ:{" "}
                        </span>
                        {dInput}
                      </p>
                      <p className="text-xs text-slate-500">
                        Các từ gạch chân đỏ là từ còn thiếu hoặc chưa khớp
                        trong câu của bạn.
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={nextSentence}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
                  >
                    Câu tiếp theo
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ---------- TAB LUYỆN NÓI ---------- */
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Đọc to câu mẫu
                </h2>
                <span className="text-sm text-slate-500">
                  Nói tốt{" "}
                  <span className="font-semibold tabular-nums text-slate-900">
                    {sStats.good}
                  </span>
                  /<span className="tabular-nums">{sStats.total}</span> lượt
                  trong phiên
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Nghe mẫu trước nếu cần, rồi bấm Bắt đầu nói và đọc to câu dưới
                đây bằng tiếng Anh.
              </p>

              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-5 py-6 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Câu mẫu
                </p>
                <p className="mt-2 text-2xl font-semibold leading-snug text-slate-900">
                  {target}
                </p>
              </div>

              {!speechSupported && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Trình duyệt chưa hỗ trợ nhận diện giọng nói, hãy dùng
                  Chrome để luyện nói. Bạn vẫn có thể bấm Nghe mẫu để luyện
                  nghe và tự đọc theo.
                </div>
              )}
              {listenError && (
                <p className="mt-4 text-sm text-red-600" aria-live="polite">
                  {listenError}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => speak(target, 0.92)}
                  disabled={!ttsSupported}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                  Nghe mẫu
                </button>
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={!speechSupported}
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                    listening
                      ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-600"
                      : "bg-primary-700 hover:bg-primary-800 focus-visible:ring-primary-700"
                  }`}
                >
                  <Mic
                    className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`}
                    aria-hidden="true"
                  />
                  {listening ? "Đang nghe... bấm để dừng" : "Bắt đầu nói"}
                </button>
              </div>

              {transcript && (
                <div className="mt-5 rounded-md border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Bạn đã nói
                  </p>
                  <p className="mt-1 text-sm italic text-slate-800">
                    &ldquo;{transcript}&rdquo;
                  </p>
                </div>
              )}

              {sResult && (
                <div
                  className={`mt-4 rounded-md border px-4 py-3 ${
                    sResult.level === "good"
                      ? "border-green-200 bg-green-50"
                      : sResult.level === "ok"
                        ? "border-amber-200 bg-amber-50"
                        : "border-red-200 bg-red-50"
                  }`}
                  aria-live="polite"
                >
                  <p
                    className={`flex items-center gap-1.5 text-sm font-semibold ${
                      sResult.level === "good"
                        ? "text-green-800"
                        : sResult.level === "ok"
                          ? "text-amber-800"
                          : "text-red-700"
                    }`}
                  >
                    {sResult.level === "good" ? (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    )}
                    {sResult.level === "good"
                      ? "Phát âm tốt"
                      : sResult.level === "ok"
                        ? "Khá — thử lại để rõ hơn"
                        : "Chưa rõ lắm"}
                    <span className="font-normal tabular-nums text-slate-600">
                      — khớp {Math.round(sResult.ratio * 100)}% số từ
                    </span>
                  </p>
                  {sResult.level !== "good" && (
                    <p className="mt-1 text-sm text-slate-600">
                      Hãy bấm Nghe mẫu, nghe kỹ từng từ rồi nói lại chậm rãi
                      hơn.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={nextSentence}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
                  >
                    Câu tiếp theo
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
