import { describe, expect, it } from 'vitest';

// The web test project loads CSS as empty modules, so the files are read from disk (module
// names in variables keep Vite from resolving them).
const FS = 'node:fs';
const NODE_URL = 'node:url';

async function readCss(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ FS)) as {
    readFileSync(path: string, encoding: 'utf8'): string;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ NODE_URL)) as {
    fileURLToPath(url: string | URL): string;
  };
  return fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

describe('chat and Today line have no motion of their own (reduced motion by design)', () => {
  it.each(['./ai-chat.css', './ask-screen.css', '../today/ai-today-line.css'])(
    '%s: no animation, transition or keyframes (no typing effect)',
    async (file) => {
      const css = (await readCss(file)).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/animation|transition|@keyframes/);
    },
  );
});
