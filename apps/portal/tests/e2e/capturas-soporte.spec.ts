import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Capturas para revisión (no es una prueba) de Soporte con Iris, «Mis contactos» y «Está a tu
 * cargo»: con `PW_CAPTURAS=/ruta` deja las pantallas en claro y oscuro, a 390 px y 1280 px.
 */
const DESTINO = process.env.PW_CAPTURAS

async function capturar(page: Page, nombre: string, proyecto: string, tema: string) {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(DESTINO!, `${nombre}-${tema}-${proyecto}.png`), fullPage: true })
}

for (const tema of ['light', 'dark'] as const) {
    test.describe(`capturas de soporte ${tema}`, () => {
        test.skip(!DESTINO, 'Solo con PW_CAPTURAS')
        test.use({ colorScheme: tema })

        test('soporte, solicitudes, contactos y a cargo', async ({ page }, info) => {
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
            const p = info.project.name
            await page.goto('/entrar?con=codigo&soporte=disponible')
            await expect(async () => {
                await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
                await page.getByRole('button', { name: 'Enviarme un código' }).click()
                await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await page.locator('input').first().click()
            await page.keyboard.type('123456')
            await page.waitForURL(/\/cuenta/, { timeout: 30_000 })

            // La sesión de los fixtures vive en memoria: se navega con el router, sin recargar.
            const ir = (ruta: string) => page.evaluate((r) => {
                const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (r: string) => Promise<void> } } } } }).__vue_app__
                return app.config.globalProperties.$router.push(r)
            }, ruta)

            await page.getByTestId('a-cargo').waitFor({ timeout: 30_000 })
            await capturar(page, 'inicio-a-cargo', p, nombreTema)

            await ir('/cuenta?seccion=soporte')
            await page.getByTestId('soporte-tickets').waitFor({ timeout: 30_000 })
            await capturar(page, 'soporte-tickets', p, nombreTema)

            await page.getByTestId('soporte-pestanas').getByText('Solicitudes').click()
            await page.getByTestId('soporte-solicitudes').waitFor()
            await capturar(page, 'soporte-solicitudes', p, nombreTema)

            await ir('/soporte/nuevo')
            await page.getByTestId('ticket-enviar').waitFor()
            await capturar(page, 'soporte-nuevo', p, nombreTema)

            await ir('/soporte/998')
            await page.getByTestId('ticket-mensajes').waitFor()
            await capturar(page, 'soporte-ticket', p, nombreTema)

            await ir('/solicitudes/nueva?tipo=traslado')
            await page.getByTestId('solicitud-enviar').waitFor()
            await capturar(page, 'solicitud-nueva', p, nombreTema)

            await ir('/cuenta?seccion=cuenta')
            await page.getByTestId('mis-contactos').getByTestId('contacto').first().waitFor({ timeout: 30_000 })
            await page.getByTestId('mis-contactos').scrollIntoViewIfNeeded()
            await capturar(page, 'cuenta-contactos', p, nombreTema)

            await ir('/contactos/501')
            await page.getByTestId('contacto-guardar').waitFor()
            await capturar(page, 'contacto-formulario', p, nombreTema)
        })
    })
}
