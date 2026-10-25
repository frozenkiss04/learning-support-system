import axios from "axios";

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
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
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
        logout();
        redirectToLogin();
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
        // Store already cleared + redirected by refreshAccessToken().
        return Promise.reject(error);
      }
    }

    // 401 on an auth call (bad credentials / expired refresh): session is over.
    if (status === 401 && original?.url?.includes("/api/auth/refresh")) {
      useAuthStore.getState().logout();
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
 */
export const authApi = {
  login: (email, password) => apiPost("/api/auth/login", { email, password }),
  register: ({ full_name, email, password }) =>
    apiPost("/api/auth/register", { full_name, email, password }),
  me: () => apiGet("/api/auth/me"),
};
