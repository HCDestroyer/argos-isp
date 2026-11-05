import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Contrato Iris 0.6.3 en el panel, en modo fixtures, a 1280 y 390 px. La clave
 * `argos_fixtures_iris_canje` elige el estado del canje: `pendiente` lleva la marca informativa con
 * su vencimiento; `revocado_por_iris` y `canje_sin_uso` el aviso de error con el motivo, la fecha y
 * «Generar enlace de conexión»; `reconexion` la marca de reconexión pendiente con su hora;
 * `confirmado` y `anterior` (API sin los campos) no muestran nada.
 * Capturas (claro y oscuro) en `test-results/capturas-iris-063/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-iris-063/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

async function conEscenario(page: Page, escenario: string): Promise<void> {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(valor => localStorage.setItem('argos_fixtures_iris_canje', valor), escenario)
}

test('Iris: canje pendiente con su hora de vencimiento', async ({ page }) => {
    await conEscenario(page, 'pendiente')

    await page.goto('/configuracion/integraciones')
    await expect(page.locator('[data-prueba="marca-canje-pendiente-tarjeta-iris"]')).toHaveText('Esperando que Iris active la conexión')
    await expect(page.locator('[data-prueba="canje-vence-tarjeta-iris"]')).toContainText('Vence el')
    await sinDesborde(page)
    await capturar(page, 'pendiente-tarjeta')

    await page.locator('[data-prueba="configurar-iris"]').click()
    await expect(page).toHaveURL(/\/configuracion\/integraciones\/iris$/)
    await expect(page.locator('[data-prueba="marca-canje-pendiente-iris"]')).toHaveText('Esperando que Iris active la conexión')
    await expect(page.locator('[data-prueba="canje-vence-iris"]')).toContainText('Si Iris no la activa antes del')
    await expect(page.locator('[data-prueba="aviso-desconectado-iris"]')).toHaveCount(0)
    await sinDesborde(page)
    await capturar(page, 'pendiente')
})

for (const [motivo, texto] of [
    ['revocado_por_iris', 'Iris rechazó la conexión'],
    ['canje_sin_uso', 'La conexión no se activó en 24 h'],
] as const) {
    test(`Iris: desconectado (${motivo}) con motivo, fecha y enlace de conexión`, async ({ page }) => {
        await conEscenario(page, motivo)

        await page.goto('/configuracion/integraciones')
        await expect(page.locator('[data-prueba="marca-desconectado-tarjeta-iris"]')).toHaveText('Desconectada')
        await expect(page.locator('[data-prueba="motivo-desconexion-tarjeta-iris"]')).toContainText(texto)
        await sinDesborde(page)

        await page.goto('/configuracion/integraciones/iris')
        const aviso = page.locator('[data-prueba="aviso-desconectado-iris"]')
        await expect(aviso).toBeVisible()
        await expect(aviso).toContainText('Iris está desconectado')
        await expect(page.locator('[data-prueba="motivo-desconexion-iris"]')).toHaveText(texto)
        await expect(page.locator('[data-prueba="desconectado-en-iris"]')).toContainText('Desconectado el')
        await expect(page.locator('[data-prueba="marca-desconectado-iris"]')).toHaveText('Desconectada')
        await sinDesborde(page)
        await capturar(page, `desconectado-${motivo}`)

        await aviso.getByRole('button', { name: 'Generar enlace de conexión' }).click()
        await expect(page.locator('[data-prueba="valor-Enlace"]')).toHaveText(/\/conectar#\w{20,}/)
        await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
        await expect(page.locator('[data-prueba="valor-una-vez"]')).toHaveCount(0)
    })
}

test('Iris: reconexión pendiente con su hora y la conexión actual en uso', async ({ page }) => {
    await conEscenario(page, 'reconexion')

    await page.goto('/configuracion/integraciones')
    await expect(page.locator('[data-prueba="estado-tarjeta-iris"]')).toHaveText('Activa')
    await expect(page.locator('[data-prueba="marca-reconexion-tarjeta-iris"]')).toHaveText('Reconexión pendiente')
    await expect(page.locator('[data-prueba="reconexion-vence-tarjeta-iris"]')).toContainText(/Iris la activa antes del .+; mientras tanto sigue la conexión actual\./)
    await sinDesborde(page)
    await capturar(page, 'reconexion-tarjeta')

    await page.goto('/configuracion/integraciones/iris')
    await expect(page.locator('[data-prueba="marca-reconexion-iris"]')).toHaveText('Reconexión pendiente')
    await expect(page.locator('[data-prueba="reconexion-vence-iris"]')).toContainText('mientras tanto sigue la conexión actual')
    await expect(page.locator('[data-prueba="estado-conector-iris"]')).toHaveText('Activa')
    await expect(page.locator('[data-prueba="aviso-desconectado-iris"]')).toHaveCount(0)
    await sinDesborde(page)
    await capturar(page, 'reconexion')
})

for (const escenario of ['confirmado', 'anterior']) {
    test(`Iris: ${escenario} no muestra nada nuevo`, async ({ page }) => {
        await conEscenario(page, escenario)
        await page.goto('/configuracion/integraciones')
        await expect(page.locator('[data-prueba="estado-tarjeta-iris"]')).toHaveText('Activa')
        await expect(page.locator('[data-prueba="marca-canje-pendiente-tarjeta-iris"]')).toHaveCount(0)
        await expect(page.locator('[data-prueba="marca-desconectado-tarjeta-iris"]')).toHaveCount(0)

        await page.goto('/configuracion/integraciones/iris')
        await expect(page.locator('[data-prueba="estado-conector-iris"]')).toHaveText('Activa')
        await expect(page.locator('[data-prueba="marca-canje-pendiente-iris"]')).toHaveCount(0)
        await expect(page.locator('[data-prueba="aviso-desconectado-iris"]')).toHaveCount(0)
        await expect(page.locator('[data-prueba="marca-reconexion-iris"]')).toHaveCount(0)
    })
}
