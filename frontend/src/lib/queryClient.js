import { QueryClient } from "@tanstack/react-query";

/**
 * QueryClient dùng chung cho toàn app.
 * Tách ra file riêng (thay vì khai báo trong main.jsx) để các module ngoài
 * React — vd. lib/api.js khi đăng xuất — import được và gọi queryClient.clear()
 * nhằm xóa cache của user cũ trước khi user mới đăng nhập.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

export default queryClient;
