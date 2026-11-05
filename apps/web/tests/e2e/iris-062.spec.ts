import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Contrato Iris 0.6.2 en el panel, en modo fixtures, a 1280 y 390 px: con `requiere_reconectar: true`
 * (clave `argos_fixtures_iris_reconectar`) la tarjeta de Iris lleva la marca «Volver a conectar» y la
 * pantalla del conector el aviso de advertencia con el motivo de la API y «Generar enlace de
 * conexión», que abre el enlace de siempre. Capturas (claro y oscuro) en
 * `test-results/capturas-iris-062/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-iris-062/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

test('Iris: aviso de volver a conectar con su motivo y el enlace de conexión', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(() => localStorage.setItem('argos_fixtures_iris_reconectar', '1'))

    await page.goto('/configuracion/integraciones')
    await expect(page.locator('[data-prueba="estado-tarjeta-iris"]')).toHaveText('Activa')
    await expect(page.locator('[data-prueba="marca-reconectar-tarjeta-iris"]')).toHaveText('Volver a conectar')
    await sinDesborde(page)

    await page.locator('[data-prueba="configurar-iris"]').click()
    await expect(page).toHaveURL(/\/configuracion\/integraciones\/iris$/)
    const aviso = page.locator('[data-prueba="aviso-reconectar-iris"]')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Hay que volver a conectar Iris')
    await expect(page.locator('[data-prueba="motivo-reconectar-iris"]')).toContainText('no tiene guardado el receptor de webhooks de Argos')
    await expect(aviso).toContainText('«Conectar con Argos»')
    await expect(page.locator('[data-prueba="marca-reconectar-iris"]')).toHaveText('Volver a conectar')
    await sinDesborde(page)
    await capturar(page, 'aviso')

    await aviso.getByRole('button', { name: 'Generar enlace de conexión' }).click()
    await expect(page.locator('[data-prueba="valor-Enlace"]')).toHaveText(/\/conectar#\w{20,}/)
    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(page.locator('[data-prueba="valor-una-vez"]')).toHaveCount(0)
})

test('Iris: sin requiere_reconectar no hay aviso ni marca', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/integraciones/iris')
    await expect(page.locator('[data-prueba="estado-conector-iris"]')).toHaveText('Sin conectar')
    await expect(page.locator('[data-prueba="aviso-reconectar-iris"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="marca-reconectar-iris"]')).toHaveCount(0)
})
