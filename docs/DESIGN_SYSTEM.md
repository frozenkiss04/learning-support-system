# Design System — Chuẩn giao diện doanh nghiệp

Quy chuẩn này là **bắt buộc** cho toàn bộ frontend. Mục tiêu: giao diện trông như sản phẩm doanh nghiệp thật (thẳng hàng, trung tính, nhất quán, đủ trạng thái), không mang dấu vết "template AI". Phần token đã được mã hóa trong `frontend/tailwind.config.js` và `frontend/src/index.css` — tài liệu này là bản quy định để đối chiếu khi review UI; khi hai nơi lệch nhau, sửa code về theo tài liệu này (hoặc sửa cả hai cùng lúc).

## 1. Nguyên tắc

- Một màu primary duy nhất, dùng tiết chế (nút chính, trạng thái active, focus). Phần còn lại là thang xám slate trung tính.
- Phẳng và yên tĩnh: viền mảnh phân tách vùng nội dung thay cho đổ bóng; không trang trí thừa; không phần tử nào "bay" lên khỏi nền.
- Mật độ thông tin của một công cụ làm việc (giống các hệ thống nội bộ / LMS doanh nghiệp), không phải landing page quảng cáo.
- Mọi căn lề theo lưới, mọi component có đủ trạng thái — thiếu trạng thái là lỗi thiết kế, không phải việc để sau.

## 2. Điều cấm (dấu hiệu "AI/template" — không dùng trong bất kỳ màn hình nào)

| Cấm | Lý do / thay bằng |
| --- | --- |
| Gradient màu (đặc biệt tím → xanh) cho nền, nút, chữ | Dấu hiệu template AI phổ biến nhất. Dùng màu phẳng slate/primary. |
| Glassmorphism (nền mờ kính, `backdrop-blur` trang trí) | Trông như demo. Dùng nền trắng/slate đặc, viền `slate-200`. |
| Bo góc lớn (`rounded-2xl`, `rounded-3xl`, bo > 8px cho card/nút/input) | Hệ thống khóa trần bo góc ở 8px trong config (xem mục 4). |
| Shadow đậm / nhiều lớp, hiệu ứng phát sáng (glow), nền tối neon | Trần shadow là mức nhẹ đã khóa trong config. |
| Emoji làm icon | Chỉ dùng bộ **lucide-react**, cùng một độ dày nét. |
| Nhiều màu nhấn mỗi nơi một màu; màu không đúng ngữ nghĩa | Chỉ primary + màu trạng thái đúng nghĩa (mục 3). |
| Chữ hero khổng lồ, typography phô trương trong app | Trong ứng dụng, tiêu đề trang tối đa `text-2xl`; thang font khóa tối đa `3xl` (30px). |
| Card lồng card, khoảng trắng thất thường, căn lề lệch lưới | Tuân lưới 4/8px và các class bố cục chuẩn (mục 5). |
| Mascot/animation ăn mừng quá mức trong luồng học | Feedback đúng/sai là dải màu phẳng, rõ ràng, tắt được. |

## 3. Màu sắc

**Nền & chữ (slate):**

| Vai trò | Token | Giá trị |
| --- | --- | --- |
| Nền trang | `bg-slate-50` | `#f8fafc` |
| Nền bề mặt (card, bảng, form) | `bg-white` | `#ffffff` |
| Viền | `border-slate-200` | `#e2e8f0` |
| Chữ chính | `text-slate-900` | `#0f172a` |
| Chữ phụ / mô tả | `text-slate-600` | `#475569` |
| Chữ mờ / hint | `text-slate-500` | `#64748b` |
| Nhãn form | `text-slate-700` | `#334155` |

**Primary (xanh lá trầm — màu thương hiệu duy nhất):** thang `primary` định nghĩa trong `tailwind.config.js`, mốc chính:

| Token | Giá trị | Dùng cho |
| --- | --- | --- |
| `primary` / `primary-700` | `#15803d` | Nút chính, trạng thái active, focus ring |
| `primary-600` | `#16a34a` | Hover của nút chính (sáng hơn một bậc) |
| `primary-100` / `primary-50` | `#dcfce7` / `#f0fdf4` | Nền chọn (selection), nền badge trạng thái tốt |
| `primary-900` | `#14532d` | Chữ trên nền primary nhạt |

**Màu trạng thái (đúng ngữ nghĩa, không dùng thay primary):**

- Thành công: thang green/primary nhạt.
- Cảnh báo: `amber` (chỉ cho cảnh báo thật: sắp mất streak, dữ liệu chưa lưu...).
- Lỗi: `red-600` cho chữ lỗi form (`.form-error` trong `index.css`), viền đỏ cho input lỗi.
- Thông tin / trung tính: slate.

## 4. Typography, bo góc, shadow, lưới

**Font:** `Be Vietnam Pro` (Google Fonts, weights 400/500/600/700/800) — hiển thị dấu tiếng Việt tốt. Font stack dự phòng: system-ui → Segoe UI → Roboto → Arial. Khai báo ở `fontFamily.sans` trong `tailwind.config.js`, import ở đầu `src/index.css`.

**Thang chữ** (đã khóa trong config, không tự thêm cỡ lớn hơn):

| Token | Cỡ / line-height | Dùng cho |
| --- | --- | --- |
| `text-xs` | 12 / 16px | Hint, meta, badge |
| `text-sm` | 14 / 20px | Mô tả, nội dung bảng, form hint |
| `text-base` | 16 / 24px | Nội dung chính (mặc định của `body`) |
| `text-lg` | 18 / 28px | Tiêu đề khối nhỏ |
| `text-xl` | 20 / 28px | Tiêu đề trang trên mobile (`.page-title`) |
| `text-2xl` | 24 / 32px | Tiêu đề trang (`.page-title` từ breakpoint `sm`) |
| `text-3xl` | 30 / 36px | Trần tối đa — chỉ tiêu đề cấp cao nhất, dùng hiếm |

Số liệu trong bảng/KPI phải dùng số tabular (`font-variant-numeric: tabular-nums` — đã đặt cho `table` và class `.tabular` trong `index.css`) để cột số thẳng hàng.

**Bo góc (khóa cứng trong `tailwind.config.js`):** `sm` = 4px, mặc định/`md` = 6px, `lg`/`xl` = **8px — trần tối đa**. `rounded-full` chỉ cho avatar, chấm trạng thái, pill badge khi thật cần. Không tự khai báo radius lớn hơn trong component.

**Shadow (khóa cứng):** mặc định gần như phẳng — `shadow-sm` = `0 1px 2px rgb(15 23 42 / 0.05)`; các mức `md`/`lg`/`xl` trong config đã được neo về mức nhẹ tương đương. Thực tế: ưu tiên `border border-slate-200` + nền trắng thay cho shadow.

**Lưới khoảng cách 4/8px:** mọi padding/margin/gap dùng bậc Tailwind theo bội của 4px (…`2`=8, `3`=12 — hạn chế, `4`=16, `6`=24, `8`=32…). Bố cục trang chuẩn dùng class có sẵn trong `index.css`:

- `.page-container`: `max-w-7xl` (1280px — container cũng bị khóa trần 1280px trong config), căn giữa, `px-4 py-6 sm:px-6 lg:px-8`.
- `.page-title`, `.page-description` cho đầu trang.
- `.form-label`, `.form-hint`, `.form-error` cho form.

**Layout app quy định:**

- App shell học viên: sidebar trái cố định **240px**, topbar **56px** (chứa tìm kiếm, XP, streak, avatar), nội dung chính trong `.page-container`.
- Panel AI trong bài học: cột cố định **360px** bên phải, có nhãn ngữ cảnh dạng chip phẳng (ví dụ "Đang hỏi về: Bài 3 — …"), không bong bóng chat nổi.
- Admin: layout riêng (sidebar + breadcrumb + header trang có nút hành động chính), bảng dữ liệu có tìm kiếm/lọc/sắp xếp/phân trang.

## 5. Trạng thái component bắt buộc

Mỗi component tương tác phải có đủ các trạng thái sau trước khi coi là xong:

| Trạng thái | Yêu cầu |
| --- | --- |
| Default | Đúng token màu/viền/radius ở trên. |
| Hover | Thay đổi nhẹ, một bậc màu (ví dụ primary 700 → 600), không hiệu ứng phóng to/nổi. |
| Focus-visible | `ring-2 ring-primary-700 ring-offset-2` — đã đặt mặc định toàn cục trong `index.css`; không tự ý tắt outline mà không thay bằng ring tương đương. |
| Disabled | Giảm độ mờ + `cursor-not-allowed`, không nhận sự kiện; áp cho nút/input khi đang gửi form hoặc không đủ điều kiện. |
| Loading | Có chỉ báo tải rõ ràng: skeleton cho vùng dữ liệu, spinner + khóa nút cho hành động đang gửi. Không để trang trắng/trống trong lúc chờ API (đặc biệt khi backend cold start). |
| Empty | Màn hình rỗng có thông điệp + hành động tiếp theo (ví dụ "Chưa có khóa học nào" + nút tạo), không để vùng trống không chữ. |
| Error | Thông báo lỗi đọc được (chữ `red-600` cho lỗi field; banner/toast cho lỗi trang) kèm nút thử lại khi phù hợp. Không nuốt lỗi im lặng. |
| Success (với hành động gửi dữ liệu) | Xác nhận bằng toast hoặc thay đổi trạng thái tại chỗ; toast dùng animation `toast-in` 180ms đã định nghĩa, dialog dùng `dialog-in` 150ms — không animation dài hơn, không hiệu ứng ăn mừng. |

## 6. Quy ước theo loại component

- **Button:** primary = nền `primary-700`, chữ trắng, radius 6px; secondary = nền trắng, viền `slate-200`, chữ `slate-700`; nguy hiểm = đỏ, chỉ cho hành động xóa/hủy có xác nhận. Mỗi màn hình tối đa **một** nút primary nổi bật trong một vùng hành động.
- **Input/Form:** nhãn phía trên (`.form-label`), hint dưới (`.form-hint`), lỗi dưới và viền đỏ (`.form-error`); validate bằng React Hook Form + Zod, lỗi hiển thị tại field.
- **Table:** header `text-sm` chữ `slate-600`, hàng cách nhau bằng viền `slate-200`, số dùng tabular, có phân trang khi danh sách dài; hàng có hành động thì đặt ở cột cuối, icon Lucide.
- **Card/KPI:** nền trắng, viền `slate-200`, radius tối đa 8px, `shadow-sm` hoặc không shadow; số KPI `text-2xl/3xl` semibold slate-900, nhãn `text-sm` slate-600.
- **Badge/Chip:** pill được phép (`rounded-full`), nền nhạt + chữ đậm cùng họ màu, `text-xs` — dùng cho trạng thái (Hoàn thành/Đang học/Khóa) và ngữ cảnh AI.
- **Feedback bài tập:** dải phẳng ở đáy vùng làm bài — xanh (đúng, kèm giải thích) / đỏ (sai, kèm đáp án đúng sau khi nộp) — không pháo giấy, không popup ăn mừng.
- **Icon:** chỉ `lucide-react`, kích thước theo bậc 16/20/24px, màu kế thừa chữ xung quanh.

## 7. Checklist review UI (dùng khi duyệt màn hình mới)

- [ ] Không gradient, không glass, không glow, không bo góc > 8px, không emoji icon.
- [ ] Chỉ một primary `#15803d`; màu khác chỉ xuất hiện đúng ngữ nghĩa trạng thái.
- [ ] Font Be Vietnam Pro, tiêu đề trang ≤ `text-2xl`, số liệu dùng tabular.
- [ ] Khoảng cách theo lưới 4/8px, nội dung trong `.page-container`.
- [ ] Đủ 8 trạng thái: default / hover / focus-visible / disabled / loading / empty / error / success.
- [ ] Bảng có tìm kiếm/phân trang nếu danh sách dài; form có label + hint + lỗi tại field.
- [ ] Hiển thị tốt ở mobile (sidebar thu gọn) và desktop; không vỡ layout ở 360px và 1280px.
