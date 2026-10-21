/**
 * Âm thanh phản hồi làm bài, synthesized bằng WebAudio API — không file ngoài.
 *
 * - correct(): 2 nốt đi lên dễ chịu (E5 -> G5).
 * - wrong(): 1 nốt trầm ngắn (G3, sóng triangle cho mềm).
 * - complete(): arpeggio 3 nốt (C5 -> E5 -> G5) khi hoàn thành/đạt bài.
 *
 * Trạng thái bật/tắt lưu ở localStorage key "lss-sounds" ('1' bật, '0' tắt),
 * mặc định BẬT. Mọi hàm đều bọc try/catch: môi trường không có WebAudio
 * hoặc localStorage bị chặn thì im lặng bỏ qua, không bao giờ ném lỗi.
 */

const STORAGE_KEY = 'lss-sounds';

let audioCtx = null;

export function isEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setEnabled(enabled) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* localStorage không khả dụng — bỏ qua */
  }
}

function getContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      // Trình duyệt chặn autoplay: resume trong ngữ cảnh thao tác người dùng.
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Phát 1 nốt với envelope mượt (tránh tiếng click ở đầu/cuối nốt). */
function tone(frequency, startOffsetSec, durationSec, { type = 'sine', peak = 0.12 } = {}) {
  try {
    const ctx = getContext();
    if (!ctx) return;
    const startAt = ctx.currentTime + startOffsetSec;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationSec + 0.05);
  } catch {
    /* WebAudio lỗi — bỏ qua */
  }
}

export function correct() {
  try {
    if (!isEnabled()) return;
    tone(659.25, 0, 0.16); // E5
    tone(783.99, 0.09, 0.26); // G5
  } catch {
    /* bỏ qua */
  }
}

export function wrong() {
  try {
    if (!isEnabled()) return;
    tone(196.0, 0, 0.24, { type: 'triangle', peak: 0.1 }); // G3
  } catch {
    /* bỏ qua */
  }
}

export function complete() {
  try {
    if (!isEnabled()) return;
    tone(523.25, 0, 0.18); // C5
    tone(659.25, 0.1, 0.18); // E5
    tone(783.99, 0.2, 0.36); // G5
  } catch {
    /* bỏ qua */
  }
}

export default { correct, wrong, complete, isEnabled, setEnabled };
