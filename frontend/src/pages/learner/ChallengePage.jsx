import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Flame,
  Loader2,
  Play,
  RotateCcw,
  Timer,
  Trophy,
  XCircle,
  Zap,
} from "lucide-react";
import { apiGet } from "../../lib/api";
import { EmptyState } from "../../components/ui/EmptyState";
import * as sounds from "../../lib/sounds";

/**
 * Thử thách tốc độ — mini game 60 giây dựng từ thẻ ôn tập SRS.
 *
 * API: GET /api/progress/due?limit=50 -> [{ exercise_id, exercise: {...} }]
 * Chỉ giữ câu chấm được ngay tại client:
 * - MULTIPLE_CHOICE có options (>= 2) và correct_answer;
 * - FILL_BLANK / TRANSLATE (hoặc dạng khác) có correct_answer dạng chữ.
 *
 * Luật chơi: 60 giây đếm ngược; đúng +10 điểm; từ câu đúng thứ 3 liên tiếp
 * trở đi mỗi câu được +2 điểm chuỗi. Kỷ lục lưu localStorage "lss-challenge-best".
 * Pool < 5 câu -> EmptyState hướng dẫn học thêm bài để tích lũy thẻ.
 */

const GAME_SECONDS = 60;
const MIN_POOL = 5;
const BEST_KEY = "lss-challenge-best";
const FEEDBACK_MS = 480;

const TYPE_LABELS = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  FILL_BLANK: "Điền từ",
  TRANSLATE: "Dịch câu",
};

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isPlayable(card) {
  const exercise = card?.exercise;
  if (!exercise) return false;
  const answer =
    typeof exercise.correct_answer === "string"
      ? exercise.correct_answer.trim()
      : "";
  if (!answer) return false;
  const type = String(exercise.type ?? "").toUpperCase();
  if (type === "MULTIPLE_CHOICE") {
    const options = Array.isArray(exercise.options)
      ? exercise.options.filter((o) => String(o).trim())
      : [];
    return options.length >= 2;
  }
  return true;
}

function readBest() {
  try {
    const value = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export default function ChallengePage() {
  // phase: loading | error | intro | playing | finished
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [pool, setPool] = useState([]);
  const [best, setBest] = useState(() => readBest());
  const [isNewBest, setIsNewBest] = useState(false);

  // Trạng thái một ván chơi
  const [deck, setDeck] = useState([]);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [feedback, setFeedback] = useState(null); // { correct, picked, gained }

  const advanceTimerRef = useRef(null);

  const load = async () => {
    setPhase("loading");
    setLoadError("");
    try {
      const data = await apiGet("/api/progress/due", {
        params: { limit: 50 },
      });
      const cards = Array.isArray(data) ? data : [];
      setPool(cards.filter(isPlayable));
      setPhase("intro");
    } catch (err) {
      setLoadError(
        err?.response?.data?.error?.message ||
          err?.serverMessage ||
          "Không tải được câu hỏi thử thách. Vui lòng thử lại.",
      );
      setPhase("error");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dọn timer chuyển câu khi rời trang.
  useEffect(
    () => () => {
      if (advanceTimerRef.current)
        window.clearTimeout(advanceTimerRef.current);
    },
    [],
  );

  // Đồng hồ đếm ngược khi đang chơi.
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const id = window.setInterval(() => {
      setTimeLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Hết giờ -> chốt ván, ghi kỷ lục nếu phá.
  useEffect(() => {
    if (phase !== "playing" || timeLeft > 0) return;
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    setFeedback(null);
    setPhase("finished");
    if (score > best) {
      setBest(score);
      setIsNewBest(true);
      try {
        window.localStorage.setItem(BEST_KEY, String(score));
      } catch {
        /* localStorage không khả dụng — bỏ qua */
      }
    }
    if (correctCount > 0) sounds.complete();
    // Chỉ chốt khi đồng hồ về 0; score/correctCount đọc tại thời điểm đó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft]);

  const currentCard = phase === "playing" ? deck[0] : null;
  const currentExercise = currentCard?.exercise ?? null;
  const isMc =
    String(currentExercise?.type ?? "").toUpperCase() === "MULTIPLE_CHOICE" &&
    Array.isArray(currentExercise?.options) &&
    currentExercise.options.length >= 2;
  const options = isMc ? currentExercise.options : [];

  const startGame = () => {
    if (pool.length < MIN_POOL) return;
    setDeck(shuffle(pool));
    setTimeLeft(GAME_SECONDS);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setAnswered(0);
    setCorrectCount(0);
    setInputValue("");
    setFeedback(null);
    setIsNewBest(false);
    setPhase("playing");
  };

  const advance = () => {
    setDeck((prev) => {
      const rest = prev.slice(1);
      return rest.length > 0 ? rest : shuffle(pool);
    });
  };

  const submitAnswer = (raw) => {
    if (phase !== "playing" || feedback || !currentExercise) return;
    const picked = String(raw ?? "");
    if (!picked.trim()) return;
    const correct = normalize(picked) === normalize(currentExercise.correct_answer);
    const nextStreak = correct ? streak + 1 : 0;
    const gained = correct ? 10 + (nextStreak >= 3 ? 2 : 0) : 0;

    if (correct) {
      setScore((value) => value + gained);
      setCorrectCount((value) => value + 1);
      setBestStreak((value) => Math.max(value, nextStreak));
      sounds.correct();
    } else {
      sounds.wrong();
    }
    setStreak(nextStreak);
    setAnswered((value) => value + 1);
    setFeedback({ correct, picked, gained });
    advanceTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      setInputValue("");
      advance();
    }, FEEDBACK_MS);
  };

  const timerDanger = timeLeft <= 10;
  const timerPercent = Math.max(0, (timeLeft / GAME_SECONDS) * 100);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header trang */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Zap className="h-5 w-5 text-primary-700" aria-hidden="true" />
          Thử thách tốc độ
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Trả lời càng nhiều câu càng tốt trong 60 giây, dùng chính các câu
          hỏi từ thẻ ôn tập của bạn. Đúng +10 điểm, chuỗi đúng từ 3 câu liên
          tiếp được cộng thêm +2 mỗi câu.
        </p>
      </div>

      {phase === "loading" ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Đang chuẩn bị câu hỏi...
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-slate-900">
            Đã xảy ra lỗi
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            Thử lại
          </button>
        </div>
      ) : phase === "intro" && pool.length < MIN_POOL ? (
        <EmptyState
          icon={<Zap className="h-5 w-5" aria-hidden="true" />}
          title="Chưa đủ câu hỏi cho thử thách"
          description={`Thử thách cần ít nhất ${MIN_POOL} câu hỏi có đáp án để chấm nhanh. Hiện bạn có ${pool.length} câu sẵn sàng — hãy học thêm bài mới để tích lũy thẻ ôn tập, các câu hỏi sẽ tự xuất hiện tại đây.`}
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
      ) : phase === "intro" ? (
        /* Màn giới thiệu */
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50">
            <Zap className="h-6 w-6 text-primary-700" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Sẵn sàng đua tốc độ?
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-600">
            Bạn có <strong className="text-slate-900">60 giây</strong> để trả
            lời từ kho <strong className="text-slate-900">{pool.length} câu hỏi</strong>{" "}
            đang đến hạn ôn. Mỗi câu đúng được +10 điểm; từ câu đúng thứ 3
            liên tiếp, mỗi câu cộng thêm +2 điểm chuỗi.
          </p>

          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="flex items-center justify-center gap-1 text-xl font-semibold tabular-nums text-slate-900">
                <Timer className="h-4 w-4 text-slate-500" aria-hidden="true" />
                60s
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Thời gian
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {pool.length}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Câu hỏi sẵn có
              </p>
            </div>
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-3">
              <p className="flex items-center justify-center gap-1 text-xl font-semibold tabular-nums text-primary-700">
                <Trophy className="h-4 w-4" aria-hidden="true" />
                {best}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Kỷ lục của bạn
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={startGame}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Bắt đầu thử thách
          </button>
        </div>
      ) : phase === "finished" ? (
        /* Màn kết quả */
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50">
            <Trophy className="h-6 w-6 text-primary-700" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Hết giờ!
          </h2>
          {isNewBest && (
            <p className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              Kỷ lục mới!
            </p>
          )}
          <p className="mt-3 text-5xl font-bold tabular-nums text-slate-900">
            {score}
            <span className="ml-1 text-base font-medium text-slate-500">
              điểm
            </span>
          </p>

          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {correctCount}/{answered}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Câu đúng / đã làm
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="flex items-center justify-center gap-1 text-xl font-semibold tabular-nums text-slate-900">
                <Flame className="h-4 w-4 text-slate-500" aria-hidden="true" />
                {bestStreak}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Chuỗi đúng dài nhất
              </p>
            </div>
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-primary-700">
                {best}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Kỷ lục của bạn
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={startGame}
              className="inline-flex items-center gap-2 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Chơi lại
            </button>
            <Link
              to="/learn"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Về học
            </Link>
          </div>
        </div>
      ) : (
        /* Đang chơi */
        <div>
          {/* Thanh trạng thái ván chơi */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p
              className={`flex items-center gap-1.5 text-sm font-semibold tabular-nums ${
                timerDanger ? "animate-pulse text-red-600" : "text-slate-700"
              }`}
              aria-live="polite"
            >
              <Timer className="h-4 w-4" aria-hidden="true" />
              0:{String(timeLeft).padStart(2, "0")}
            </p>
            <div className="flex items-center gap-4 text-sm">
              {streak >= 2 && (
                <span className="flex items-center gap-1 font-medium text-amber-600">
                  <Flame className="h-4 w-4" aria-hidden="true" />
                  Chuỗi {streak}
                  {streak >= 3 && (
                    <span className="text-xs text-amber-500">(+2/câu)</span>
                  )}
                </span>
              )}
              <span className="text-slate-500">
                Đúng{" "}
                <span className="font-semibold tabular-nums text-slate-900">
                  {correctCount}
                </span>
                /{answered}
              </span>
              <span className="font-semibold tabular-nums text-primary-700">
                {score} điểm
              </span>
            </div>
          </div>
          <div
            className="mb-6 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={GAME_SECONDS}
            aria-valuenow={timeLeft}
            aria-label="Thời gian còn lại"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
                timerDanger ? "bg-red-500" : "bg-primary-700"
              }`}
              style={{ width: `${timerPercent}%` }}
            />
          </div>

          {/* Câu hỏi hiện tại */}
          {currentExercise && (
            <div
              key={currentCard?.exercise_id ?? currentExercise.id}
              className={`rounded-lg border bg-white p-6 shadow-sm transition-colors ${
                feedback
                  ? feedback.correct
                    ? "border-green-500"
                    : "border-red-400"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {TYPE_LABELS[String(currentExercise.type ?? "").toUpperCase()] ||
                    "Bài tập"}
                </span>
                {feedback && (
                  <span
                    className={`flex items-center gap-1 text-sm font-semibold ${
                      feedback.correct ? "text-green-700" : "text-red-600"
                    }`}
                  >
                    {feedback.correct ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Đúng +{feedback.gained}
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Chưa đúng
                      </>
                    )}
                  </span>
                )}
              </div>

              <p className="mt-4 text-lg font-medium leading-relaxed text-slate-900">
                {currentExercise.question || "Nội dung câu hỏi đang được cập nhật."}
              </p>

              {isMc ? (
                <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                  {options.map((option, optionIndex) => {
                    const optionText = String(option);
                    const isPicked =
                      feedback && normalize(feedback.picked) === normalize(optionText);
                    const isCorrectOption =
                      feedback &&
                      normalize(currentExercise.correct_answer) === normalize(optionText);
                    let classes =
                      "border-slate-200 bg-white hover:border-primary-400 hover:bg-primary-50";
                    if (feedback && isCorrectOption)
                      classes = "border-green-500 bg-green-50";
                    else if (feedback && isPicked)
                      classes = "border-red-400 bg-red-50";
                    else if (feedback) classes = "border-slate-200 bg-white opacity-60";
                    return (
                      <button
                        key={optionIndex}
                        type="button"
                        disabled={Boolean(feedback)}
                        onClick={() => submitAnswer(optionText)}
                        className={`flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-left text-sm font-medium text-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-default ${classes}`}
                      >
                        <span className="font-semibold text-slate-500">
                          {OPTION_LETTERS[optionIndex] || optionIndex + 1}.
                        </span>
                        <span>{optionText}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <form
                  className="mt-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitAnswer(inputValue);
                  }}
                >
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <input
                      type="text"
                      value={inputValue}
                      disabled={Boolean(feedback)}
                      onChange={(event) => setInputValue(event.target.value)}
                      placeholder="Nhập đáp án của bạn..."
                      aria-label="Đáp án của bạn"
                      autoFocus
                      autoComplete="off"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50"
                    />
                    <button
                      type="submit"
                      disabled={Boolean(feedback) || !inputValue.trim()}
                      className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Trả lời
                    </button>
                  </div>
                  {feedback && !feedback.correct && (
                    <p className="mt-3 text-sm text-slate-600">
                      Đáp án đúng:{" "}
                      <span className="font-semibold text-slate-900">
                        {currentExercise.correct_answer}
                      </span>
                    </p>
                  )}
                </form>
              )}

              {feedback && isMc && !feedback.correct && (
                <p className="mt-4 text-sm text-slate-600">
                  Đáp án đúng:{" "}
                  <span className="font-semibold text-slate-900">
                    {currentExercise.correct_answer}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
