import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, CheckCircle2, ChevronRight, Loader2, RotateCcw, Sparkles, Trophy, XCircle } from 'lucide-react';
import { apiPost } from '../../lib/api';
import * as sounds from '../../lib/sounds';

/**
 * Luyện tập AI — bộ 5 câu do AI sinh từ điểm yếu của học viên (mỗi ngày 1 bộ).
 * Luồng: giới thiệu -> POST /api/ai/practice/generate -> làm bài -> POST submit
 * -> màn kết quả (điểm, XP, nhận xét từng câu). Đáp án chỉ lộ sau khi nộp.
 */
export default function PracticePage() {
  const [phase, setPhase] = useState('intro'); // intro | loading | quiz | submitting | result | done | error
  const [setData, setSetData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const exercises = useMemo(() => setData?.exercises ?? [], [setData]);
  const answeredCount = exercises.filter((ex) => (answers[ex.id] ?? '') !== '').length;

  async function generate() {
    setPhase('loading');
    setErrorMsg('');
    try {
      const data = await apiPost('/api/ai/practice/generate', {});
      setSetData(data);
      setAnswers({});
      setCurrent(0);
      setResult(null);
      setPhase('quiz');
    } catch (err) {
      setErrorMsg(err?.serverMessage || 'Không tạo được bộ bài luyện. Thử lại sau nhé.');
      setPhase('error');
    }
  }

  async function submit() {
    setPhase('submitting');
    try {
      const data = await apiPost('/api/ai/practice/submit', { set_id: setData.set_id, answers });
      setResult(data);
      setPhase('result');
      if (data.total > 0 && data.correct / data.total >= 0.8) sounds.complete();
      else sounds.correct();
    } catch (err) {
      if (err?.response?.status === 409) {
        setPhase('done');
      } else {
        setErrorMsg(err?.serverMessage || 'Nộp bài thất bại. Thử lại nhé.');
        setPhase('quiz');
      }
    }
  }

  const ex = exercises[current];
  const detailById = useMemo(() => {
    const map = new Map();
    (result?.details ?? []).forEach((d) => map.set(d.exercise_id, d));
    return map;
  }, [result]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Brain size={22} className="text-green-700" aria-hidden="true" />
          Luyện tập cùng AI
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Mỗi ngày AI tạo riêng cho bạn 5 câu luyện tập dựa trên những phần bạn hay sai và sắp quên. Đúng mỗi câu +4 XP, tối đa +20 XP/ngày.
        </p>
      </header>

      {phase === 'intro' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-md bg-green-50 p-3 text-green-700">
              <Sparkles size={26} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">Bộ bài luyện hôm nay</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li>5 câu được tạo từ điểm yếu của chính bạn — không ai giống ai.</li>
                <li>Làm xong mới hiện đáp án và giải thích.</li>
                <li>Mỗi ngày chỉ có 1 bộ, hãy làm thật tập trung.</li>
              </ul>
              <button
                type="button"
                onClick={generate}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-800 active:scale-[0.98]"
              >
                <Sparkles size={16} aria-hidden="true" />
                Tạo bài luyện của tôi
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white p-10 text-sm text-slate-600 shadow-sm">
          <Loader2 size={20} className="animate-spin text-green-700" aria-hidden="true" />
          AI đang soạn bài luyện riêng cho bạn…
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p>{errorMsg}</p>
          <button
            type="button"
            onClick={generate}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-100"
          >
            <RotateCcw size={15} aria-hidden="true" /> Thử lại
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Trophy size={36} className="mx-auto text-green-700" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">Bạn đã hoàn thành bộ luyện hôm nay</h2>
          <p className="mt-1 text-sm text-slate-500">Quay lại vào ngày mai để nhận bộ bài mới nhé.</p>
          <Link to="/learn" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-green-700 hover:text-green-800">
            Về lộ trình học <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}

      {(phase === 'quiz' || phase === 'submitting') && ex && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Câu {current + 1}/{exercises.length}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${setData.generated_by === 'ai' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
              {setData.generated_by === 'ai' ? 'Do AI tạo riêng cho bạn' : 'Từ ngân hàng bài tập'}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-green-700 transition-all duration-500" style={{ width: `${(answeredCount / exercises.length) * 100}%` }} />
          </div>

          <p className="mt-5 text-base font-medium text-slate-900">{ex.question}</p>

          {Array.isArray(ex.options) && ex.options.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {ex.options.map((opt) => {
                const active = answers[ex.id] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswers((a) => ({ ...a, [ex.id]: opt }))}
                    className={`rounded-md border px-4 py-2.5 text-left text-sm transition active:scale-[0.99] ${active ? 'border-green-700 bg-green-50 font-medium text-green-900' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              value={answers[ex.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [ex.id]: e.target.value }))}
              placeholder="Nhập câu trả lời của bạn…"
              className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-green-700 focus:ring-2 focus:ring-green-100"
            />
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-40"
            >
              Câu trước
            </button>
            {current < exercises.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrent((c) => c + 1)}
                className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 active:scale-[0.98]"
              >
                Câu tiếp theo
              </button>
            ) : (
              <button
                type="button"
                disabled={answeredCount < exercises.length || phase === 'submitting'}
                onClick={submit}
                className="inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 active:scale-[0.98] disabled:opacity-50"
              >
                {phase === 'submitting' && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                Nộp bài ({answeredCount}/{exercises.length})
              </button>
            )}
          </div>
          {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}
        </div>
      )}

      {phase === 'result' && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
            <Trophy size={34} className="mx-auto text-green-700" aria-hidden="true" />
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              Đúng {result.correct}/{result.total} câu
            </h2>
            <p className="mt-1 text-sm text-slate-500">Bạn nhận được <span className="font-semibold text-green-700">+{result.xp_awarded} XP</span></p>
          </div>
          <div className="space-y-3">
            {exercises.map((item, idx) => {
              const d = detailById.get(item.id);
              const ok = d?.is_correct;
              return (
                <div key={item.id} className={`rounded-lg border bg-white p-4 shadow-sm ${ok ? 'border-green-200' : 'border-red-200'}`}>
                  <div className="flex items-start gap-2">
                    {ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" aria-hidden="true" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{idx + 1}. {item.question}</p>
                      <p className="mt-1 text-sm text-slate-600">Đáp án đúng: <span className="font-medium text-slate-900">{d?.correct_answer}</span></p>
                      {d?.explanation && <p className="mt-1 text-sm text-slate-500">{d.explanation}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-center">
            <Link to="/learn" className="inline-flex items-center gap-1 text-sm font-medium text-green-700 hover:text-green-800">
              Về lộ trình học <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
