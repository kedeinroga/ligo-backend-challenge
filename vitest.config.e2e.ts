import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// e2e tests need the docker compose dependencies running (Mongo).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
