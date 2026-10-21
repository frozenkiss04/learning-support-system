import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Label } from "../../components/ui/Label";
import { authApi } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

const loginSchema = z.object({
  email: z.string().min(1, "Email là bắt buộc").email("Email không đúng định dạng"),
  password: z.string().min(1, "Mật khẩu là bắt buộc"),
});

/**
 * Rendered inside AuthLayout (brand + card shell belong to the layout).
 * Success: ADMIN -> /admin, other roles -> /learn.
 * Shows the flash message RegisterPage passes via location.state.message.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const flashMessage = location.state?.message;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = async ({ email, password }) => {
    try {
      const data = await authApi.login(email.trim().toLowerCase(), password);
      login({ user: data.user, accessToken: data.access_token, refreshToken: data.refresh_token });
      navigate(data.user?.role === "ADMIN" ? "/admin" : "/learn", { replace: true });
    } catch (err) {
      setError("root", {
        message: err.serverMessage || err.message || "Đăng nhập thất bại. Vui lòng thử lại.",
      });
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900">Đăng nhập</h1>
        <p className="mt-1 text-sm text-slate-600">Tiếp tục lộ trình học của bạn</p>
      </div>

      {flashMessage && (
        <div
          className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          role="status"
        >
          {flashMessage}
        </div>
      )}
      {errors.root && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {errors.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <Label htmlFor="email" required>
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="ban@example.com"
            error={errors.email?.message}
            {...register("email")}
          />
        </div>

        <div>
          <Label htmlFor="password" required>
            Mật khẩu
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu"
            error={errors.password?.message}
            {...register("password")}
          />
        </div>

        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
        Chưa có tài khoản?{" "}
        <Link to="/register" className="font-medium text-green-700 hover:text-green-800 hover:underline">
          Đăng ký
        </Link>
      </p>
    </div>
  );
}
