<div align="center">

<img src="web/public/icons/icon-192.png" width="96" height="96" alt="Biểu tượng Second Brain">

# Second Brain

**Bộ não thứ hai cho sinh viên: ghi chú Markdown, deadline, lịch và bản đồ kiến thức. Tất cả chạy trên máy của bạn.**

**Tiếng Việt** | [English](README.en.md)

![Phiên bản](https://img.shields.io/badge/phi%C3%AAn%20b%E1%BA%A3n-1.0-D88AB6)
![Nền tảng](https://img.shields.io/badge/n%E1%BB%81n%20t%E1%BA%A3ng-Windows%2010%20%7C%2011-3A2C45)
![Node.js](https://img.shields.io/badge/Node.js-24%20LTS-5FB89E)
![Dữ liệu](https://img.shields.io/badge/d%E1%BB%AF%20li%E1%BB%87u-local--first-F2B255)

<img src="docs/images/today.png" alt="Trang Hôm nay với dải 14 ngày, việc hôm nay, ghi nhanh và đồ án đang làm" width="900">

</div>

## Vì sao có Second Brain

Notion chậm và cần mạng. Obsidian mạnh nhưng phải cài plugin và cấu hình mới có deadline, lịch hay AI. Second Brain dùng được ngay từ lần mở đầu tiên: bạn thấy liền hôm nay cần làm gì, viết không vướng víu, và mọi ghi chú vẫn là file Markdown thường nằm trong thư mục của bạn.

- **Không bao giờ quên deadline.** Deadline có sẵn ở trang mở đầu, và máy chủ nhắc bạn bằng thông báo Windows kể cả khi cửa sổ app đang đóng.
- **Ghi nhanh, dọn sau.** Mọi việc thường ngày chỉ cần một đến hai thao tác.
- **Kiến thức nối với nhau.** Liên kết hai chiều, tài liệu gắn vào ghi chú, và một bản đồ não cho thấy toàn cảnh.
- **Dữ liệu là của bạn.** Mọi thứ là file `.md` trong một thư mục. Gỡ app đi thì ghi chú vẫn dùng được. App không bao giờ âm thầm sửa những gì bạn đã viết.

## Tính năng (bản 1.0)

| | |
|---|---|
| **Viết** | Editor hiện đẹp ngay khi gõ, kiểu Notion nhưng không có khối kéo thả. Gõ `## `, `**`, `- [ ]`, `[[` là thành định dạng. Có menu `/`, thanh định dạng với phím tắt kiểu Word (`Ctrl+B/I/U`) và chế độ xem Markdown thô (`Alt+S`). Phần bạn không sửa được ghi lại nguyên từng byte, kể cả công thức toán, HTML và chú thích. |
| **Liên kết** | `[[Wikilink]]` gợi ý không cần dấu (`giai tich` → *Giải tích 1*). Có backlinks, "nhắc đến chưa liên kết", tag lồng nhau (`#môn/giải-tích`) và thuộc tính đầu ghi chú. Đổi tên hay chuyển ghi chú thì mọi liên kết tự cập nhật, và có hoàn tác. |
| **Deadline và việc cần làm** | Trang **Hôm nay** có dải 14 ngày tô màu theo độ gấp, danh sách việc hôm nay và đồ án đang làm kèm % hoàn thành. Có trang **Việc cần làm**, **Lịch** tháng kéo thả để dời ngày, và hoàn tác trong 10 giây. |
| **Nhắc nhở** | Nhắc trước 3 ngày, 1 ngày và đúng ngày, vào giờ bạn chọn. Thông báo Windows hiện ngay cả khi cửa sổ app đóng. Máy ngủ qua giờ nhắc thì nhắc bù một lần, không bao giờ nhắc trùng. |
| **Tài liệu** | Kéo thả hoặc dán PDF, ảnh, slide vào ghi chú, tên file luôn là duy nhất. Ảnh hiện ngay trong ghi chú. PDF mở trong app, có lật trang, phóng to và chọn chữ. Trang **Tài liệu** cho biết ghi chú nào đang nhắc đến từng file. |
| **Bản đồ não** | Mỗi ghi chú là một chấm sáng, màu theo thư mục. Bấm vào một chấm là tia sáng chạy sang các ghi chú kề, có ngăn tìm để dùng hoàn toàn bằng bàn phím. Mỗi ghi chú có bản đồ cục bộ riêng. |
| **Tìm và ghi nhanh** | `Ctrl+K` tìm toàn bộ ghi chú không cần dấu (kể cả *đ*), lọc theo `tag:`, `folder:`, `due:7d`, và gõ `>` để chạy lệnh. `Alt+Q` ghi nhanh vào Inbox, `Alt+T` mở ghi chú hằng ngày. |
| **An toàn dữ liệu** | Ghi nguyên tử. Mỗi lần ghi đều kiểm tra phiên bản, nên khi file vừa bị sửa ở nơi khác app hiện màn hình xung đột ba bản (gốc, trên đĩa, của bạn). Có thùng rác, nhật ký thao tác khôi phục sau sự cố, và bản nháp giữ chữ khi tab bị tắt đột ngột. **Lịch sử phiên bản** dùng git, **sao lưu** ra file zip. |
| **Giao diện** | Mặc định tối ("Đêm tím"), có chế độ sáng, ba bộ màu (Dâu tằm, Hoa đào, Oải hương), ba cỡ chữ, tiếng Việt và tiếng Anh, tất cả đổi tức thì. Cài được thành app có cửa sổ và icon riêng, mở được cả khi mất mạng. |

<table>
  <tr>
    <td><img src="docs/images/note.png" alt="Ghi chú đồ án với thuộc tính, việc cần làm, ảnh đính kèm và ngăn liên kết"></td>
    <td><img src="docs/images/graph.png" alt="Bản đồ não"></td>
  </tr>
  <tr>
    <td><img src="docs/images/calendar.png" alt="Lịch tháng với các deadline"></td>
    <td><img src="docs/images/pdf-viewer.png" alt="Trình xem PDF trong app"></td>
  </tr>
  <tr>
    <td><img src="docs/images/settings.png" alt="Cài đặt"></td>
    <td><img src="docs/images/today-light.png" alt="Trang Hôm nay ở chế độ sáng, bộ màu Hoa đào"></td>
  </tr>
</table>

## Cài đặt

### Cần có

| | |
|---|---|
| Hệ điều hành | Windows 10 hoặc 11 |
| [Node.js 24 LTS](https://nodejs.org) | Cài một lần. App cần bản 22.12 trở lên. |
| Chrome hoặc Edge | Để dùng và cài app (PWA). |
| [Git for Windows](https://git-scm.com/download/win) | Không bắt buộc, cần cho lịch sử phiên bản. Không có Git thì app vẫn chạy bình thường. |

### Ba bước

1. **Tải mã nguồn** vào một thư mục tên `app`:
   ```powershell
   git clone https://github.com/khangnk144/SECONDBRAIN.git D:\SECONDBRAIN\app
   ```
   Thư mục cha (ở đây là `D:\SECONDBRAIN`) sẽ chứa ghi chú (`vault\`) và cấu hình (`.secondbrain\`).
2. **Mở app:** bấm đúp `D:\SECONDBRAIN\app\launcher\Mở Second Brain.cmd`. Lần đầu nó tự cài thư viện và build, mất vài phút. Sau đó app mở ở `http://localhost:4747`.
   Muốn có lối tắt ở thư mục gốc thì chép `app\launcher\root-wrapper.cmd` ra `D:\SECONDBRAIN` và đổi tên thành `Mở Second Brain.cmd`.
3. **Cài thành app** (tùy chọn): mở **Cài đặt → Ứng dụng → Cài đặt app**. Bật **Chạy khi đăng nhập Windows** để app có sẵn mỗi lần mở máy.

Lần đầu mở, app hỏi có muốn tạo **dữ liệu mẫu** để xem thử không. Dữ liệu mẫu xóa được bất cứ lúc nào trong Cài đặt.

### Dừng và cập nhật

- Dừng app: **Cài đặt → Thoát Second Brain**, hoặc chạy `"Mở Second Brain.cmd" stop`.
- Cập nhật: chạy `git pull` trong thư mục `app` rồi mở lại. Launcher tự cài thêm và build lại khi cần.

## Phím tắt

| Phím | Việc | Phím | Việc |
|---|---|---|---|
| `Ctrl+K` | Tìm ghi chú và lệnh (`>`) | `Alt+G` | Bản đồ não |
| `Alt+N` | Ghi chú mới (chọn mẫu) | `Alt+S` | Chế độ Markdown thô |
| `Alt+Q` | Ghi nhanh vào Inbox | `Alt+1` / `Alt+2` | Ẩn hoặc hiện ngăn trái, ngăn phải |
| `Alt+T` | Ghi chú hằng ngày hôm nay | `Alt+W`, `Alt+[`, `Alt+]` | Đóng thẻ, thẻ trước, thẻ sau |
| `Alt+,` | Cài đặt | `Ctrl+/` | Bảng tất cả phím tắt |

Mọi thao tác đều có nút hoặc menu tương đương, và mọi màn hình đều dùng được hoàn toàn bằng bàn phím.

## Dữ liệu của bạn nằm ở đâu

```
D:\SECONDBRAIN\
├── vault\                 Ghi chú của bạn: file Markdown thường
│   ├── 0 Inbox\           ghi nhanh, chưa phân loại
│   ├── 1 Projects\        đồ án, dự án nghiên cứu (có deadline)
│   ├── 2 Areas\           môn học, lĩnh vực lâu dài
│   ├── 3 Resources\       tài liệu gốc: papers\, slides\, web\, other\
│   ├── 4 Archive\         đã xong (không tính vào việc cần làm)
│   ├── Daily\  Templates\  Attachments\  wiki\
│   └── .secondbrain\      trạng thái của app cho kho này (chỉ mục, nhắc nhở, thùng rác, nhật ký)
├── .secondbrain\          cấu hình máy: settings.json (không chia sẻ file này)
└── app\                   mã nguồn (repo này)
```

- Ghi chú dùng cú pháp quen thuộc: `[[liên kết]]`, `#tag`, front matter YAML, việc `- [ ] … 📅 2026-11-05` (tương thích plugin Tasks của Obsidian). Mở bằng Obsidian, VS Code hay Notepad đều được.
- App chỉ đọc và ghi trong `vault\`. Xóa nghĩa là chuyển vào thùng rác (`.secondbrain\trash`, giữ 30 ngày). Thao tác nhiều file được ghi nhật ký để hoàn tất hoặc hoàn tác sau sự cố.
- **Riêng tư:** máy chủ chỉ nghe ở `127.0.0.1`, mỗi yêu cầu phải có mã phiên và đúng nguồn gốc. Không có dữ liệu nào rời khỏi máy. Các tính năng AI ở giai đoạn sau chỉ chạy khi bạn tự bật.

## Kiến trúc

```mermaid
flowchart LR
  UI["Giao diện React<br/>trình duyệt hoặc app đã cài (PWA)"] -- "REST + WebSocket<br/>mã phiên, chỉ localhost" --> S["Máy chủ Node.js + Fastify<br/>127.0.0.1:4747"]
  S --> V["VaultService<br/>ghi nguyên tử, kiểm tra phiên bản,<br/>thùng rác, nhật ký"]
  V --> F[("vault/*.md<br/>file của bạn")]
  F -- "theo dõi thay đổi" --> I["Chỉ mục SQLite + FTS5<br/>link, tag, deadline"]
  S --> P["Theo từng kho:<br/>nhắc nhở, lịch sử git"]
  P -- "thông báo Windows" --> W["Windows"]
```

| Phần | Công nghệ |
|---|---|
| Máy chủ | Node.js 24, TypeScript, Fastify, better-sqlite3 (FTS5), chokidar |
| Giao diện | React 18, Vite, Tiptap/ProseMirror, zustand, d3-force (canvas), pdf.js, i18next |
| Markdown | unified/remark với bộ chuyển đổi giữ nguyên từng khối chưa sửa |
| Chất lượng | Vitest, Testing Library, Playwright, ESLint (có luật cấm chữ giao diện viết cứng và màu viết cứng), kiểm tra tương phản màu |

## Phát triển

```bash
npm install
npm run dev          # http://localhost:4747, tự tải lại khi sửa code
npm test             # test unit và tích hợp (server, web, công cụ)
npm run test:e2e     # build rồi chạy Playwright trên một kho tạm
npm run lint         # ESLint, màu viết cứng, khớp bản dịch VI/EN, tương phản
npm run typecheck
npm run gen-vault -- --out <thư mục trống>   # kho 5.000 ghi chú để đo hiệu năng
```

| Thư mục | Nội dung |
|---|---|
| `server/` | API REST và WebSocket, kho ghi chú, chỉ mục, nhắc nhở, lịch sử git, sao lưu |
| `web/` | giao diện: editor, các màn hình, PWA |
| `launcher/` | launcher Windows (`start`, `stop`, `login`) |
| `scripts/`, `eslint-rules/` | công cụ kiểm tra chất lượng |
| `docs/` | kiến trúc, chuẩn code, hướng dẫn chạy, nhật ký thay đổi |
| `DECISIONS.md`, `MILESTONE-*.md` | quyết định thiết kế và báo cáo nghiệm thu từng mốc |

Mỗi mốc chỉ được tính là xong khi mọi tiêu chí nghiệm thu đều có test, hoặc có bước kiểm tra tay ghi trong `MILESTONE-<n>.md`. Mỗi mốc còn được hai người soát độc lập: một về an toàn dữ liệu, một về giao diện. Bản 1.0 có hơn 3.800 test tự động và 45 kịch bản chạy trên trình duyệt thật.

## Lộ trình

| Mốc | Nội dung | Trạng thái |
|---|---|---|
| M0 đến M3 | Khung app, kho ghi chú và chỉ mục, editor và liên kết, Hôm nay, lịch, tìm kiếm, bản đồ não | ✅ |
| M4 | Nhắc nhở Windows, Cài đặt, tài liệu và trình xem PDF, lịch sử phiên bản, sao lưu, cài app (PWA) | ✅ bản 1.0 |
| M6 | AI: chat với ghi chú của mình kèm trích dẫn, tìm theo nghĩa, gợi ý liên kết và tag, dọn Inbox giúp (AI đề xuất, bạn đồng ý mới đổi); nối Claude qua MCP để nạp paper thành wiki nghiên cứu; đọc chữ trong PDF | Tiếp theo |
| M5 | Bản đồ não tua thời gian, trang tổng hợp học kỳ, weekly review, sao lưu tự động, giao diện điện thoại, bản `.exe` không cần Node.js | Sau đó |

## Gặp sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| "Chưa tìm thấy Node.js" | Cài Node.js 24 LTS rồi mở lại launcher. |
| Báo cổng 4747 đang bị dùng | Hộp thoại ghi tên chương trình đang chiếm cổng. Đóng chương trình đó, hoặc đổi cổng trong Cài đặt rồi cài lại app. |
| App đã cài báo "Chưa kết nối với máy chủ" | Bấm đúp launcher. App tự kết nối lại, không cần tải lại trang. |
| Lịch sử phiên bản báo cần Git | Cài Git for Windows. Các tính năng khác không bị ảnh hưởng. |

Nhật ký (không chứa nội dung ghi chú) mở được ở **Cài đặt → Mở thư mục log**. Chi tiết thêm ở [`docs/deployment-guide.md`](docs/deployment-guide.md).

## Giấy phép

Bản quyền © 2026 khangnie. Mã nguồn chưa được phát hành theo giấy phép mã nguồn mở, mọi quyền được bảo lưu.

App dùng các thư viện mã nguồn mở, mỗi thư viện theo giấy phép riêng của nó. Trong đó có phông [Be Vietnam Pro](https://github.com/bettergui/BeVietnamPro) và [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (SIL OFL 1.1), [Phosphor Icons](https://phosphoricons.com) (MIT), [pdf.js](https://github.com/mozilla/pdf.js) (Apache 2.0), [Tiptap](https://tiptap.dev) (MIT), [Fastify](https://fastify.dev) (MIT) và [SQLite](https://sqlite.org) (public domain).
