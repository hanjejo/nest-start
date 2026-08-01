import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.(t|j)s'],
    },
  },
  oxc: false,
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
