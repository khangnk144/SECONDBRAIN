import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Deadline logic works on local calendar dates: pin the owner's time zone so results never
    // depend on the machine; run with TZ=America/New_York (or any zone) to check another one.
    env: { TZ: process.env.TZ ?? 'Asia/Ho_Chi_Minh' },
  },
});
