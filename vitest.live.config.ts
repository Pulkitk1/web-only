import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Live tests talk to the REAL Firebase project with a dedicated test account. They are never part of `npm test`.
//   $env:LIVE_TEST_EMAIL = '...'; $env:LIVE_TEST_PASSWORD = '...'; npm run test:live
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['tests/live/**/*.live.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
