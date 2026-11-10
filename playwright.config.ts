import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5178', headless: true },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', env: { VITE_SOCKET_URL: 'http://127.0.0.1:4318' }, reuseExistingServer: false },
})
