import { defineConfig } from 'vitest/config';

// One vitest run covers the server, the web app and the repo tooling (scripts + lint rules).
export default defineConfig({
  test: {
    projects: [
      'server/vitest.config.ts',
      'web/vitest.config.ts',
      {
        test: {
          name: 'tooling',
          environment: 'node',
          include: ['scripts/**/*.test.ts', 'eslint-rules/**/*.test.ts'],
        },
      },
    ],
  },
});
