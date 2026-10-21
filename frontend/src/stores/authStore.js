import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Auth store — persisted to localStorage (key: "lss-auth").
 *
 * Shape:
 *   user:         { id, email, full_name, role, xp, ... } | null
 *   accessToken:  string | null   (short-lived, 30 min)
 *   refreshToken: string | null   (7 days, only used against /api/auth/refresh)
 *
 * Read tokens outside React (axios interceptors) via useAuthStore.getState().
 */
export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,

      /** Full sign-in: user object + token pair returned by POST /api/auth/login. */
      login: ({ user, accessToken, refreshToken }) =>
        set({ user: user ?? null, accessToken: accessToken ?? null, refreshToken: refreshToken ?? null }),

      /** Partial token update, e.g. after a successful refresh. Omits keep current values. */
      setTokens: ({ accessToken, refreshToken } = {}) =>
        set((state) => ({
          accessToken: accessToken !== undefined ? accessToken : state.accessToken,
          refreshToken: refreshToken !== undefined ? refreshToken : state.refreshToken,
        })),

      setUser: (user) => set({ user }),

      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: "lss-auth",
      // Persist data only — never the actions.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

/** Non-hook helpers for interceptors / route guards. */
export const getAccessToken = () => useAuthStore.getState().accessToken;
export const getRefreshToken = () => useAuthStore.getState().refreshToken;
export const isAuthenticated = () => Boolean(useAuthStore.getState().accessToken);
export const hasRole = (...roles) => roles.includes(useAuthStore.getState().user?.role);
