import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests cover the pure TypeScript layer (domain/, services/, utils/, constants/, layout maths). They run in Node
// with no React Native runtime. Browser behaviour is covered by `npm run e2e` (scripts/e2e-dashboard.mjs).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
