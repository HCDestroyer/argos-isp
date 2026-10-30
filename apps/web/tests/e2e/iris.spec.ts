import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Configuración → Integraciones → Iris (`contratos/iris.md` §1.3), en modo fixtures, a 1280 y
 * 390 px: el índice lleva a Iris, «Generar enlace de conexión» muestra el enlace una sola vez con
 * su instrucción y la caducidad, y al cerrar ya no está en ningún lado. El menú también tiene la
 * entrada directa. Las capturas (claro y oscuro) quedan en `test-results/capturas-iris/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-iris/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

/** Sin desborde horizontal de la página (390 px). */
async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

test('Iris: generar el enlace de conexión y verlo una sola vez', async ({ page }) => {
    await entrar(page, 'admin@argos.test')

    await ir(page, 'Integraciones', /\/configuracion\/integraciones$/)
    await expect(page.locator('[data-prueba="estado-tarjeta-iris"]')).toHaveText('Sin conectar')
    await page.locator('[data-prueba="configurar-iris"]').click()
    await expect(page).toHaveURL(/\/configuracion\/integraciones\/iris$/)
    await expect(page.locator('[data-prueba="estado-conector-iris"]')).toHaveText('Sin conectar')
    await expect(page.locator('[data-prueba="interruptor-iris"]')).toBeDisabled()
    await expect(page.locator('[data-prueba="resumen-envios-iris"]')).toBeVisible()
    await sinDesborde(page)
    await capturar(page, 'configuracion')

    await page.getByRole('button', { name: 'Generar enlace de conexión' }).click()
    const modal = page.locator('[data-prueba="valor-una-vez"]')
    await expect(modal).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText('Pégalo en Iris → Administración → Integraciones → Conectar. Vence en 15 minutos y sirve una sola vez')
    await expect(page.locator('[data-prueba="caducidad"]')).toContainText(/Vence en 1[45]:\d\d/)
    const enlace = (await page.locator('[data-prueba="valor-Enlace"]').textContent()) ?? ''
    expect(enlace).toMatch(/\/conectar#\w{20,}/)
    await expect(page.getByRole('button', { name: 'Copiar enlace' })).toBeVisible()
    await sinDesborde(page)
    await capturar(page, 'enlace')

    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(modal).toHaveCount(0)
    // Una sola vez: cerrado, el enlace no queda en la página.
    expect(await page.content()).not.toContain(enlace)

    // Un enlace nuevo es otro (el anterior queda anulado en la API).
    await page.getByRole('button', { name: 'Generar enlace de conexión' }).click()
    await expect(page.locator('[data-prueba="valor-Enlace"]')).not.toHaveText(enlace)
    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(modal).toHaveCount(0)

    // La entrada directa del menú lleva a la misma pantalla.
    await ir(page, 'Integraciones', /\/configuracion\/integraciones$/)
    await ir(page, 'Iris', /\/configuracion\/integraciones\/iris$/)
    await expect(page.locator('[data-prueba="estado-conector-iris"]')).toHaveText('Sin conectar')
})
