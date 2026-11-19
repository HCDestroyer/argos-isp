import { expect, test, type Page } from '@playwright/test'
import Decimal from 'decimal.js'
import { servicios } from '../../fixtures/servicios/datos'
import { entrar, fijarHoyFixtures } from './ayudas'

/**
 * Pedido del PM (19 nov): «No puedo agregar facturas siguientes (pago por adelantado)». Desde la
 * ficha del servicio 1 se abre «Emitir facturas de periodos» (pantalla propia), «Adelantar 3 meses»
 * marca noviembre, diciembre y enero, el resumen da el total y se emiten las tres. Hoy de los
 * fixtures: 15 de octubre de 2026. Corre en escritorio (1280 px) y en teléfono (390 px), en claro y
 * oscuro.
 */

const PRECIO = new Decimal(servicios.find(s => s.id === 1)?.precio_mensual ?? '0')

function quetzales(monto: Decimal): string {
    return `Q ${monto.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/** Sin desborde horizontal de la página (390 px). */
async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

async function capturas(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(200)
        await sinDesborde(page)
        await page.screenshot({ path: `test-results/capturas-facturas-periodo/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

test('adelantar 3 meses desde la ficha del servicio', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    // Con el servidor de desarrollo, la primera visita a la ficha la compila (varios segundos).
    const abrir = page.locator('[data-prueba="abrir-facturas-periodo"]')
    await expect(abrir).toBeVisible({ timeout: 20_000 })
    await abrir.click()
    await expect(page).toHaveURL(/\/servicios\/1\/facturas-periodo$/)

    const lista = page.locator('[data-prueba="lista-periodos"]')
    await expect(lista).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toContainText('Emitir facturas de periodos')
    await expect(lista.locator('[data-periodo="2026-10-01"]')).toContainText('Emitida')
    await expect(lista.locator('[data-periodo="2026-11-01"]')).toContainText('Futuro')
    // Lo emitido se ve pero no tiene casilla.
    await expect(lista.locator('[data-periodo="2026-10-01"] [role="checkbox"]')).toHaveCount(0)
    await capturas(page, 'vista-previa')

    await page.locator('[data-prueba="adelantar-meses"] input, input[data-prueba="adelantar-meses"]').first().fill('3')
    await page.locator('[data-prueba="adelantar"]').click()
    for (const periodo of ['2026-11-01', '2026-12-01', '2027-01-01']) {
        await expect(lista.locator(`[data-periodo="${periodo}"] [role="checkbox"]`)).toHaveAttribute('aria-checked', 'true')
    }
    await expect(lista.locator('[data-periodo="2027-02-01"] [role="checkbox"]')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('[data-prueba="resumen-total"]')).toHaveText(quetzales(PRECIO.times(3)))
    await expect(page.locator('[data-prueba="resumen-por-cobrar"]')).toHaveText(quetzales(PRECIO.times(3)))
    await capturas(page, 'adelantar-3')

    const emitir = page.locator('[data-prueba="emitir-periodos"]')
    await expect(emitir).toHaveText(/Emitir 3 facturas/)
    await emitir.click()

    const resultado = page.locator('[data-prueba="facturas-periodo-resultado"]')
    await expect(resultado).toBeVisible()
    await expect(resultado).toContainText('3 facturas emitidas')
    await expect(resultado.locator('[data-creada]')).toHaveCount(3)
    await expect(page.getByText('3 facturas emitidas').first()).toBeVisible()
    await expect(lista.locator('[data-periodo="2026-12-01"]')).toContainText('Emitida')
    await capturas(page, 'resultado')

    await resultado.locator('[data-prueba="facturas-periodo-ver-facturas"]').click()
    await expect(page).toHaveURL(/\/facturas\?.*servicio=1/)
})
