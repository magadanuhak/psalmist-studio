import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Private fixtures (the author's own voice) are not in the public repo; tests that need them are skipped when absent. */
const PRIVATE_FIXTURE = 'test-audio/real/strofa-curat.wav';
const privateTests = ['src/theory/harmony/real.test.ts', 'src/theory/harmony/dbg.test.ts'];

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT) || 5174, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', ...(existsSync(PRIVATE_FIXTURE) ? [] : privateTests)],
    testTimeout: 120000,
  },
});
