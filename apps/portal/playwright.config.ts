import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas en navegador del portal (accesibilidad con axe). Por defecto corren contra el portal en
 * modo fixtures (`NUXT_PUBLIC_USE_FIXTURES=true`), sin backend. Contra otro portal:
 * `PW_BASE_URL=http://localhost:3001 pnpm --filter @argosisp/portal test:e2e`.
 *
 * Los navegadores se toman de `PLAYWRIGHT_BROWSERS_PATH` (no se descargan aquí). Teléfono (390 px,
 * la mayoría de los clientes llega desde el teléfono) y escritorio (1280 px).
 */
const PUERTO = Number(process.env.PW_PUERTO ?? 3151)
const BASE_URL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PUERTO}`

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 120_000,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        locale: 'es-GT',
        timezoneId: 'America/Guatemala',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'telefono', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
        { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    ],
    webServer: process.env.PW_BASE_URL
        ? undefined
        : {
                command: `pnpm exec nuxt dev --port ${PUERTO} --host 127.0.0.1`,
                url: BASE_URL,
                env: { NUXT_PUBLIC_USE_FIXTURES: 'true' },
                reuseExistingServer: !process.env.CI,
                timeout: 180_000,
            },
})
