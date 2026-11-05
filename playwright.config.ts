import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Las pruebas de las auditorías se corren aparte: HILO_AUDIT=1 HILO_A2=1 npx playwright test
  testIgnore: process.env.HILO_AUDIT ? [] : ['**/a[0-9]-*.spec.ts'],
  // Una ventana a la vez: la RAM de la máquina es justa y comparten portapapeles de prueba.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results',
});
