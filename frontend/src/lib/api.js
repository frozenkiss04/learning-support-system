import axios from "axios";

import { queryClient } from "./queryClient";
import { useAuthStore } from "../stores/authStore";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Backend (Flask) response contract:
 *   success: { success: true,  data: <payload>, ...meta }   // meta = pagination etc.
 *   error:   { success: false, error: { message, code } }
 *
 * The response interceptor below unwraps `data`, so callers get:
 *   const user = await api.get("/api/auth/me").then((r) => r.data);
 * Pagination/meta fields (total, page, per_page) are preserved on `response.meta`.
 * Convenience helpers (apiGet, authApi, ...) return the unwrapped payload directly.
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90000,
  headers: { "Content-Type": "application/json" },
});

const AUTH_PATHS = ["/api/auth/login", "/api/auth/register", "/api/auth/refresh"];

function redirectToLogin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

/**
 * Xóa toàn bộ phiên ở phía client: auth store, React Query cache (để user
 * sau không thấy thoáng dữ liệu của user trước) và các key localStorage
 * gắn với user (lss-auth, legacy "auth", kỷ lục thử thách, mục tiêu ngày,
 * mốc XP baseline theo ngày). Key "lss-sounds" là tùy chọn của thiết bị,
 * không gắn với user nên được giữ lại.
 */
export function clearLocalSession() {
  useAuthStore.getState().logout();
  try {
    queryClient.clear();
  } catch {
    // cache đã sạch hoặc chưa khởi tạo — bỏ qua
  }
  try {
    const storage = window.localStorage;
    storage.removeItem("lss-auth");
    storage.removeItem("auth");
    storage.removeItem("lss-challenge-best");
    storage.removeItem("lss-daily-goal");
    // lss-xp-baseline-YYYY-MM-DD — xóa theo tiền tố
    const prefixKeys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith("lss-xp-baseline-")) prefixKeys.push(key);
    }
    prefixKeys.forEach((key) => storage.removeItem(key));
  } catch {
    // ignore storage errors on logout
  }
}

/**
 * Đăng xuất đầy đủ: gọi POST /api/auth/logout để backend thu hồi token
 * (best-effort — lỗi mạng hay token đã hết hạn thì vẫn tiếp tục), rồi xóa
 * phiên ở client. Mọi nút đăng xuất trong app đều dùng hàm này.
 */
export async function signOut() {
  try {
    // Gửi kèm refresh token để backend thu hồi cả cặp access + refresh.
    const refreshToken = useAuthStore.getState().refreshToken;
    await apiPost("/api/auth/logout", refreshToken ? { refresh_token: refreshToken } : {});
  } catch {
    // best-effort: token sẽ hết hạn tự nhiên, phiên client vẫn bị xóa bên dưới
  }
  clearLocalSession();
}

// ---- Request: attach access token -------------------------------------------
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && !AUTH_PATHS.some((p) => config.url?.includes(p))) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Refresh: single-flight, at most one retry per request -------------------
// (export để luồng fetch streaming trong lib/aiStream.js dùng chung cơ chế
// làm mới token khi gặp 401, thay vì tự chế một bản sao.)
export let refreshPromise = null;

export async function refreshAccessToken() {
  const { refreshToken, setTokens } = useAuthStore.getState();
  if (!refreshToken) throw new Error("No refresh token");

  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${API_BASE_URL}/api/auth/refresh`,
        {},
        { headers: { Authorization: `Bearer ${refreshToken}` }, timeout: 90000 },
      )
      .then((res) => {
        const accessToken = res.data?.data?.access_token;
        if (!accessToken) throw new Error("Refresh response missing access_token");
        setTokens({ accessToken });
        return accessToken;
      })
      .catch((err) => {
        // Chỉ coi phiên là hết khi backend trả 401/403 (refresh token đã bị
        // thu hồi/hết hạn). Lỗi mạng hoặc lỗi tạm thời (vd. Render cold start)
        // thì KHÔNG logout: reject để UI hiện lỗi và user thử lại được.
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          clearLocalSession();
          redirectToLogin();
        }
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// ---- Response: unwrap { success, data } + normalise errors + 401 handling ----
api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === "object" && "success" in body) {
      const { success, data, ...meta } = body;
      response.data = data;
      response.meta = meta;
    }
    return response;
  },
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const serverMessage = error.response?.data?.error?.message;
    if (serverMessage) error.message = serverMessage;
    error.serverMessage = serverMessage ?? null;
    error.status = status ?? null;

    const isAuthCall = AUTH_PATHS.some((p) => original?.url?.includes(p));
    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      try {
        const accessToken = await refreshAccessToken();
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        // Refresh thất bại: nếu là 401/403 thì refreshAccessToken đã xóa
        // phiên + chuyển về /login; lỗi mạng/transient thì chỉ reject để
        // UI hiện lỗi và user thử lại, không đá user ra.
        return Promise.reject(error);
      }
    }

    // 401 on an auth call (bad credentials / expired refresh): session is over.
    if (status === 401 && original?.url?.includes("/api/auth/refresh")) {
      clearLocalSession();
      redirectToLogin();
    }
    return Promise.reject(error);
  },
);

export default api;

/** Helpers that resolve directly with the unwrapped `data` payload. */
export const apiGet = (url, config) => api.get(url, config).then((r) => r.data);
export const apiPost = (url, body, config) => api.post(url, body, config).then((r) => r.data);
export const apiPut = (url, body, config) => api.put(url, body, config).then((r) => r.data);
export const apiPatch = (url, body, config) => api.patch(url, body, config).then((r) => r.data);
export const apiDelete = (url, config) => api.delete(url, config).then((r) => r.data);

/**
 * Auth endpoints — payload shapes mirror backend/app/blueprints/auth.py.
 * login() resolves: { user, access_token, refresh_token }
 * register() resolves: user object (no tokens; account starts as LEARNER)
 * changePassword() resolves: { message, access_token, refresh_token }
 *   (backend tăng token_version nên phải thay cặp token mới ngay)
 */
export const authApi = {
  login: (email, password) => apiPost("/api/auth/login", { email, password }),
  register: ({ full_name, email, password }) =>
    apiPost("/api/auth/register", { full_name, email, password }),
  me: () => apiGet("/api/auth/me"),
  logout: () => apiPost("/api/auth/logout", {}),
  changePassword: ({ current_password, new_password }) =>
    apiPost("/api/auth/change-password", { current_password, new_password }),
};

/**
 * Nạp lại user từ GET /api/auth/me và cập nhật auth store, để topbar
 * (XP/streak lấy từ user trong store) cập nhật ngay sau khi XP thay đổi
 * — vd. sau khi nộp bài thành công hoặc nhận thưởng nhiệm vụ ngày.
 * Lỗi thì im lặng: topbar giữ số cũ, không làm vỡ luồng chính.
 */
export async function refreshAuthUser() {
  try {
    const user = await authApi.me();
    if (user) useAuthStore.getState().setUser(user);
  } catch {
    // topbar giữ số liệu cũ
  }
}
