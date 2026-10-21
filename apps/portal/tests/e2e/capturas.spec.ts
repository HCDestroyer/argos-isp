import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Capturas para revisión (no es una prueba): con `PW_CAPTURAS=/ruta` deja en esa carpeta las
 * pantallas de las promociones en claro y oscuro, a 390 px y 1280 px. Sin la variable, se salta.
 */
const DESTINO = process.env.PW_CAPTURAS

async function capturar(page: Page, nombre: string, proyecto: string, tema: string) {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(DESTINO!, `${nombre}-${tema}-${proyecto}.png`), fullPage: true })
}

for (const tema of ['light', 'dark'] as const) {
    test.describe(`capturas ${tema}`, () => {
        test.skip(!DESTINO, 'Solo con PW_CAPTURAS')
        test.use({ colorScheme: tema })

        test('promociones', async ({ page }, info) => {
            mkdirSync(DESTINO!, { recursive: true })
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('nuxt-color-mode', t)
                }
                catch {
                    // sin almacenamiento: el tema sale de prefers-color-scheme
                }
            }, tema)
            const nombreTema = tema === 'light' ? 'claro' : 'oscuro'
            await page.goto('/corte?anuncios=1')
            await page.getByTestId('promociones-pagina_corte').waitFor({ timeout: 90_000 })
            await capturar(page, 'corte-una-promo', info.project.name, nombreTema)
            await page.goto('/corte?anuncios=3')
            await page.getByTestId('promo-carrusel').waitFor()
            await capturar(page, 'corte-carrusel', info.project.name, nombreTema)

            // inicio de /cuenta (la sesión de los fixtures vive en memoria: se entra con el código)
            await page.goto('/entrar')
            await expect(async () => {
                await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
                await page.getByRole('button', { name: 'Enviarme un código' }).click()
                await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await page.locator('input').first().click()
            await page.keyboard.type('123456')
            await page.getByTestId('promociones-portal_inicio').waitFor({ timeout: 30_000 })
            await capturar(page, 'cuenta-inicio-promos', info.project.name, nombreTema)
        })

        test('sorteos', async ({ page }, info) => {
            mkdirSync(DESTINO!, { recursive: true })
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('nuxt-color-mode', t)
                }
                catch {
                    // sin almacenamiento: el tema sale de prefers-color-scheme
                }
            }, tema)
            const nombreTema = tema === 'light' ? 'claro' : 'oscuro'
            // `?sorteos=1&anuncios=1` se recuerdan en la pestaña
            await page.goto('/corte?sorteos=1&anuncios=1')
            await page.getByTestId('aviso-sorteo').first().waitFor({ timeout: 90_000 })
            await capturar(page, 'sorteos-corte', info.project.name, nombreTema)
            await page.goto('/sorteos/27')
            await page.getByTestId('verificacion').waitFor()
            await capturar(page, 'sorteos-publico', info.project.name, nombreTema)
            await page.goto('/entrar')
            await expect(async () => {
                await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
                await page.getByRole('button', { name: 'Enviarme un código' }).click()
                await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await page.locator('input').first().click()
            await page.keyboard.type('123456')
            await page.getByTestId('aviso-sorteo-boletos').first().click()
            await page.getByTestId('seccion-sorteos').waitFor()
            await page.getByTestId('sorteo-27').waitFor()
            await capturar(page, 'sorteos-cuenta', info.project.name, nombreTema)
        })

        test('puntos', async ({ page }, info) => {
            mkdirSync(DESTINO!, { recursive: true })
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('nuxt-color-mode', t)
                }
                catch {
                    // sin almacenamiento: el tema sale de prefers-color-scheme
                }
            }, tema)
            const nombreTema = tema === 'light' ? 'claro' : 'oscuro'
            // `?puntos=canje` se recuerda en la pestaña: programa visible y canje activo
            await page.goto('/entrar?puntos=canje')
            await expect(async () => {
                await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
                await page.getByRole('button', { name: 'Enviarme un código' }).click()
                await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await page.locator('input').first().click()
            await page.keyboard.type('123456')
            await page.getByTestId('resumen-puntos').waitFor({ timeout: 30_000 })
            await capturar(page, 'puntos-inicio', info.project.name, nombreTema)
            await page.getByTestId('nav-puntos').filter({ visible: true }).first().click()
            await page.getByTestId('premios').waitFor({ timeout: 30_000 })
            await capturar(page, 'puntos-seccion', info.project.name, nombreTema)
            await page.getByTestId('premio-501').getByTestId('canjear').click()
            await page.getByTestId('confirmar-canje').waitFor()
            await page.waitForTimeout(400)
            await page.screenshot({ path: join(DESTINO!, `puntos-confirmar-${nombreTema}-${info.project.name}.png`) })
        })
    })
}
