import { Component } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

/**
 * Last-resort guard: a render crash anywhere below shows a friendly,
 * recoverable fallback instead of a blank white page.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep the trace in the console for debugging; the UI stays calm.
    console.error('UI crash caught by ErrorBoundary:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Đã xảy ra lỗi hiển thị</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Dữ liệu học tập của bạn vẫn an toàn. Hãy tải lại trang để tiếp tục — tiến độ bài học
            đã nộp được lưu trên hệ thống.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-[#15803d] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#166534] active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" /> Tải lại trang
            </button>
            <a
              href="/learn"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
            >
              <Home className="h-4 w-4" /> Về trang học
            </a>
          </div>
        </div>
      </div>
    );
  }
}
