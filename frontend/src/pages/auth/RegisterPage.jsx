import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Label } from "../../components/ui/Label";
import { authApi } from "../../lib/api";

const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Họ tên phải có ít nhất 2 ký tự").max(120, "Họ tên quá dài"),
    email: z.string().min(1, "Email là bắt buộc").email("Email không đúng định dạng"),
    password: z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự").max(72, "Mật khẩu quá dài"),
    confirm_password: z.string().min(1, "Vui lòng nhập lại mật khẩu"),
  })
  .refine((values) => values.password === values.confirm_password, {
    path: ["confirm_password"],
    message: "Mật khẩu nhập lại không khớp",
  });

/**
 * Rendered inside AuthLayout (brand + card shell belong to the layout).
 * Backend always creates the account as LEARNER — role is never sent.
 * Success -> /login with a flash message in location.state.
 */
export default function RegisterPage() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: "", email: "", password: "", confirm_password: "" },
  });

  const onSubmit = async ({ full_name, email, password }) => {
    try {
      await authApi.register({ full_name: full_name.trim(), email: email.trim().toLowerCase(), password });
      navigate("/login", {
        replace: true,
        state: { message: "Đăng ký thành công. Vui lòng đăng nhập để tiếp tục." },
      });
    } catch (err) {
      setError("root", {
        message: err.serverMessage || err.message || "Đăng ký thất bại. Vui lòng thử lại.",
      });
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900">Tạo tài khoản</h1>
        <p className="mt-1 text-sm text-slate-600">Bắt đầu lộ trình học của bạn</p>
      </div>

      {errors.root && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {errors.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <Label htmlFor="full_name" required>
            Họ và tên
          </Label>
          <Input
            id="full_name"
            type="text"
            autoComplete="name"
            placeholder="Nguyễn Văn A"
            error={errors.full_name?.message}
            {...register("full_name")}
          />
        </div>

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
            autoComplete="new-password"
            placeholder="Tối thiểu 8 ký tự"
            error={errors.password?.message}
            {...register("password")}
          />
        </div>

        <div>
          <Label htmlFor="confirm_password" required>
            Nhập lại mật khẩu
          </Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu"
            error={errors.confirm_password?.message}
            {...register("confirm_password")}
          />
        </div>

        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          {isSubmitting ? "Đang đăng ký..." : "Đăng ký"}
        </Button>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
        Đã có tài khoản?{" "}
        <Link to="/login" className="font-medium text-green-700 hover:text-green-800 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
