import { lazy } from "react";

/**
 * React.lazy + tự phục hồi khi chunk load thất bại.
 *
 * Vì sao cần: Vite build ra chunk theo content-hash
 * (vd. LoginPage-BWA0QGCF.js) và Vercel chỉ phục vụ file của deployment
 * hiện tại; request tới chunk của deployment cũ bị rewrite SPA
 * (vercel.json: /(.*) -> /index.html) nên trả về HTML thay vì JS,
 * khiến import() reject với SyntaxError. Tab mở từ trước một lần deploy
 * mà lần đầu mở một route lazy SAU khi deploy xong sẽ gặp lỗi này —
 * React.lazy đẩy lỗi lên ErrorBoundary và khung lỗi "đã xảy ra lỗi hiển
 * thị" bám dính (ErrorBoundary không tự reset) cho tới khi tải lại trang.
 *
 * Cách xử lý: import lỗi lần đầu trong session -> tải lại toàn bộ trang
 * một lần (index.html mới chứa hash chunk hiện tại). Cờ sessionStorage
 * chống vòng lặp tải lại: nếu sau reload vẫn lỗi (vd. lỗi mạng thật)
 * thì throw để ErrorBoundary hiển thị như cũ. Import thành công thì
 * xóa cờ để lần deploy sau vẫn tự phục hồi được.
 */
const RELOAD_FLAG = "lss-chunk-reload";

function alreadyReloaded() {
  try {
    return window.sessionStorage.getItem(RELOAD_FLAG) === "1";
  } catch {
    return true; // storage không dùng được: không reload, để lỗi hiện ra
  }
}

function markReloaded() {
  try {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // ignore storage errors
  }
}

function clearReloaded() {
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignore storage errors
  }
}

export function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer();
      clearReloaded();
      return mod;
    } catch (err) {
      if (!alreadyReloaded()) {
        markReloaded();
        window.location.reload();
        // Trang đang tải lại: giữ Suspense fallback, không throw để
        // ErrorBoundary không kịp hiện khung lỗi trước khi reload xong.
        return new Promise(() => {});
      }
      throw err;
    }
  });
}

export default lazyWithRetry;
