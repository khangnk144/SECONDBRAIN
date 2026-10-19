/**
 * Templates copied into `Templates/` on first run (SPEC F14). Vietnamese content, English
 * front-matter keys. Variables: {{title}} {{date}} {{time}} {{cursor}}; the Daily template also uses
 * {{date:dddd, D MMMM YYYY}}, {{yesterday}} and {{tomorrow}}. Kept as string constants so the
 * server build needs no asset copy step.
 */
export interface BundledTemplate {
  /** File name inside `Templates/`. */
  name: string;
  content: string;
}

const courseProject = `---
type: project
status: todo
deadline:
course:
created: {{date}}
---

# {{title}}

- [ ] Đọc kỹ đề bài và tiêu chí chấm điểm
- [ ] Lập dàn ý và chia việc
- [ ] Hoàn thành bản nháp và nộp bài

## Yêu cầu

{{cursor}}

## Ghi chú

## Tài liệu
`;

const course = `---
type: course
semester:
teacher:
created: {{date}}
---

# {{title}}

## Lịch học và cách tính điểm

{{cursor}}

## Bài giảng

## Bài tập và đồ án

## Tài liệu
`;

const lecture = `---
type: lecture
course:
created: {{date}}
---

# {{title}}

## Nội dung chính

{{cursor}}

## Khái niệm mới

## Câu hỏi còn thắc mắc

## Ôn tập
`;

const paper = `---
type: paper
authors: []
year:
url:
source:
source_hash:
pages_covered:
verified: false
ingested_at:
created: {{date}}
---

# {{title}}

## Tóm tắt

{{cursor}}

## Phương pháp

## Kết quả (theo tác giả)

## Nhận xét
`;

const researchProject = `---
type: research
status: todo
deadline:
created: {{date}}
---

# {{title}}

## Câu hỏi nghiên cứu

{{cursor}}

## Nguồn đã đọc

## Khoảng trống nghiên cứu (research gap)

## Ghi chú
`;

const book = `---
type: book
author:
year:
created: {{date}}
---

# {{title}}

## Tóm tắt

{{cursor}}

## Ý chính

## Trích dẫn hay

## Cảm nhận
`;

const daily = `---
type: daily
created: {{date}}
---

# {{date:dddd, D MMMM YYYY}}

← [[{{yesterday}}]] · [[{{tomorrow}}]] →

## Việc hôm nay

{{cursor}}

## Ghi chép

## Cuối ngày
`;

const note = `---
type: note
created: {{date}}
---

# {{title}}

{{cursor}}
`;

export const BUNDLED_TEMPLATES: readonly BundledTemplate[] = [
  { name: 'Course project.md', content: courseProject },
  { name: 'Course.md', content: course },
  { name: 'Lecture.md', content: lecture },
  { name: 'Paper.md', content: paper },
  { name: 'Research project.md', content: researchProject },
  { name: 'Book.md', content: book },
  { name: 'Daily.md', content: daily },
  { name: 'Note.md', content: note },
];
