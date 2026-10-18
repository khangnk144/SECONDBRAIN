import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import rule from './i18n-no-literal-ui-strings.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const rootDir = mkdtempSync(path.join(tmpdir(), 'sb lint Đồ án '));
const allowlistPath = path.join(rootDir, 'lint-allowlist.json');
writeFileSync(
  allowlistPath,
  JSON.stringify({
    strings: ['Second Brain', 'Ctrl+K'],
    patterns: ['^[\\s\\d.,:;!?%+\\-–—/()[\\]{}|·•…#@*&\'"]*$'],
    ignoreFiles: ['web/src/**/*.test.tsx'],
  }),
);
const options = [{ allowlistPath, rootDir }];
const file = path.join(rootDir, 'web/src/app/sidebar.tsx');

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('i18n-no-literal-ui-strings', rule, {
  valid: [
    { code: 'const a = <p>{t("today.title")}</p>;', options, filename: file },
    { code: 'const a = <input placeholder={t("search.placeholder")} />;', options, filename: file },
    { code: 'const a = <span>Second Brain</span>;', options, filename: file },
    { code: 'const a = <kbd>Ctrl+K</kbd>;', options, filename: file },
    { code: 'const a = <span>{count} / 12 · …</span>;', options, filename: file },
    {
      code: 'const a = <div className="pane left" data-testid="sidebar" />;',
      options,
      filename: file,
    },
    { code: 'const a = <div>\n  {children}\n</div>;', options, filename: file },
    { code: 'toast(t("saved"));', options, filename: file },
    { code: 'logger.debug("internal message");', options, filename: file },
    { code: 'throw new Error("Disk full while saving");', options, filename: file },
    { code: 'showToast("info", t("saved"));', options, filename: file },
    { code: 'toast({ kind: "error", message: t("saveFailed") });', options, filename: file },
    { code: 'setError("fieldName", { message: t("required") });', options, filename: file },
    { code: 'const a = <input type="text" value="abc" />;', options, filename: file },
    { code: 'const a = <div className={`pane ${side}`} />;', options, filename: file },
    { code: 'const a = <span>{`${done} / ${total}`}</span>;', options, filename: file },
    { code: "const a = <span>{done + ' / ' + total}</span>;", options, filename: file },
    { code: 'const a = <Field label={t("name")} />;', options, filename: file },
    {
      code: 'const a = <p>Literal allowed in tests</p>;',
      options,
      filename: path.join(rootDir, 'web/src/app/sidebar.test.tsx'),
    },
  ],
  invalid: [
    {
      code: 'const a = <p>Hôm nay</p>;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'const a = <p>{"Việc cần làm"}</p>;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'const a = <p>{done ? `Đã lưu` : "Đang lưu…"}</p>;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'const a = <button aria-label="Đóng" title={"Close"} />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'const a = <input placeholder="Gõ gì đó…" />; const b = <img alt="logo" />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'toast("Đã lưu vào Inbox");',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'toast.error(`Lỗi lưu`);',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'showError("Disk full");',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    { code: 'window.alert("Hello");', options, filename: file, errors: [{ messageId: 'literal' }] },
    {
      code: 'const a = <p>{`Còn ${n} ngày`}</p>;',
      options,
      filename: file,
      errors: [{ messageId: 'literal', data: { text: 'Còn … ngày' } }],
    },
    {
      code: "const a = <p>{`${saved ? 'Đã lưu' : 'Đang lưu'}`}</p>;",
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'const a = <button aria-label={`Mở ${name}`} />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: "const a = <p>{'Còn ' + n + ' ngày'}</p>;",
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'toast({ message: "Đã lưu" });',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'showToast("info", "Đã xoá");',
      options,
      filename: file,
      errors: [{ messageId: 'literal', data: { text: 'Đã xoá' } }],
    },
    { code: 'setError("Lỗi lưu");', options, filename: file, errors: [{ messageId: 'literal' }] },
    {
      code: 'window.confirm("Xoá ghi chú?"); prompt(`Tên ghi chú?`);',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'const a = <div aria-placeholder="Tìm" aria-valuetext="Ba phần" aria-roledescription="Thẻ" />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }, { messageId: 'literal' }],
    },
    {
      code: 'const a = <input type="submit" value="Lưu" />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: 'const a = <option label="Tiếng Việt" />; const b = <Field label="Tên" />;',
      options,
      filename: file,
      errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
    },
  ],
});
