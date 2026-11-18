import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Contrato Iris 0.8.0 en el panel, en modo fixtures, a 1280 y 390 px: la pantalla del conector con
 * Iris 0.7.1 (funciones apagadas), su sincronización por recurso y la vía de recuperación; el
 * formulario de cuentas bancarias con titular y tipo; el filtro por motivo de reconexión.
 * Capturas (claro y oscuro) en `test-results/capturas-iris-080/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-iris-080/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

test('Iris 0.8.0: contrato, funciones apagadas, sincronización y vía de recuperación', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(() => localStorage.setItem('argos_fixtures_iris_canje', 'sincronizacion'))
    await page.goto('/configuracion/integraciones/iris')

    await expect(page.locator('[data-prueba="contrato-iris-valor"]')).toContainText('0.7.1')
    await expect(page.locator('[data-prueba="funciones-apagadas-iris"]')).toContainText('anterior a 0.8.0')
    await expect(page.locator('[data-prueba="estado-sincronizacion-iris"]')).toHaveText('Con errores')
    await expect(page.locator('[data-recurso="cuentas_bancarias"]')).toContainText('3 de 4')
    await expect(page.locator('[data-recurso="cuentas_bancarias"] [data-prueba="error-etapa"]')).toContainText('Una cuenta sin titular')
    await expect(page.locator('[data-prueba="recuperacion-manual-iris"]')).toHaveText('Vía de recuperación (avanzado)')
    await sinDesborde(page)
    await capturar(page, 'conector')
})

test('Iris 0.8.0: cuentas bancarias con titular y tipo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/cuentas-bancarias')
    await expect(page.locator('[data-cuenta]')).toHaveCount(4)
    await sinDesborde(page)
    await capturar(page, 'cuentas')
    await page.getByRole('button', { name: 'Nueva cuenta' }).click()
    await expect(page.locator('[data-prueba="cuenta-titular"]')).toBeVisible()
    await expect(page.locator('[data-prueba="cuenta-tipo"]')).toBeVisible()
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByText('Escribe el nombre del titular (mínimo 2 caracteres)')).toBeVisible()
    await expect(page.getByText('Elige si es monetaria o de ahorro')).toBeVisible()
    await capturar(page, 'cuenta-formulario')
})

test('Iris 0.8.0: promesas por motivo de reconexión', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/promesas?motivo_reconexion=fuera_de_horario')
    await expect(page.locator('[data-prueba="promesa-motivo-reconexion"]').first()).toHaveText('Fuera de horario')
    await expect(page.locator('[data-prueba="filtro-motivo-reconexion"]')).toBeVisible()
    await sinDesborde(page)
    await capturar(page, 'promesas')
})
