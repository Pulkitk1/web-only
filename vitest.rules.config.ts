import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Firestore security-rules tests run against the local Firestore EMULATOR, never against the real project. Run them with
//   npm run test:rules
// which starts the emulator, runs this config, and stops it again. They are not part of `npm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['tests/rules/**/*.rules.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
