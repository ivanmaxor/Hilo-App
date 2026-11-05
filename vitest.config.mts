import { defineConfig } from 'vitest/config';
import { readUpdateTarget } from './scripts/update-target.cjs';

export default defineConfig({
  define: { __HILO_UPDATE_TARGET__: JSON.stringify(readUpdateTarget()) },
  test: { include: ['tests/unit/**/*.test.ts'], pool: 'forks' },
});
