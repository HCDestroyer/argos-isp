import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Decisión del PM (A3): nunca una factura de Q0. Un cargo único con descuento del 100 % se registra
 * como bonificación (motivo y explicación obligatorios) y se abre su ficha; la ficha del servicio
 * lista sus periodos bonificados y el reporte agrupa por motivo, origen y mes.
 */
test('cargo único sin costo: queda como bonificación con su motivo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await page.goto('/servicios/1')

    // La ficha carga en serie (servicio, sesión, asignaciones…): se espera la sección, no un tiempo fijo.
    const periodos = page.locator('[data-prueba="periodos-bonificados"]')
    await expect(periodos).toBeVisible({ timeout: 15_000 })
    await expect(periodos.locator('[data-bonificacion="3"]')).toContainText('Cargo sin costo')

    await page.locator('[data-prueba="abrir-cargo-unico"]').click()
    const modal = page.getByRole('dialog', { name: 'Cargo único' })
    await modal.locator('[data-prueba="cargo-concepto-1"]').click()
    await page.getByRole('option', { name: 'Visita técnica' }).click()
    await modal.locator('[data-prueba="cargo-precio-1"]').fill('100')
    await modal.locator('[data-prueba="cargo-descuento-1"]').fill('100')
    await modal.locator('[data-prueba="cargo-descuento-concepto-1"]').fill('Garantía de la instalación')
    await expect(modal.locator('[data-prueba="cargo-total"]')).toContainText('Q 0.00')
    await expect(modal.locator('[data-prueba="cargo-sin-costo"]')).toBeVisible()

    await modal.locator('[data-prueba="cargo-motivo"]').click()
    await page.getByRole('option', { name: 'Garantía', exact: true }).click()
    await modal.locator('[data-prueba="cargo-motivo-texto"]').fill('El router falló en la primera semana')
    await modal.locator('[data-prueba="emitir-cargo"]').click()

    await expect(page).toHaveURL(/\/bonificaciones\/\d+$/)
    await expect(page.locator('[data-prueba="bonificacion-origen"]')).toHaveText('Cargo sin costo')
    await expect(page.locator('[data-prueba="bonificacion-motivo"]')).toContainText('Garantía')
    await expect(page.locator('[data-prueba="bonificacion-bruto"]')).toContainText('Q 100.00')
    await expect(page.getByText('Descuentos y bonificaciones').first()).toBeVisible()

    await page.goto('/reportes/bonificaciones')
    // `page.goto` a una pantalla aún sin compilar en `nuxt dev` tarda más que los 5 s por defecto
    await expect(page.getByText('Programa de lealtad').first()).toBeVisible({ timeout: 15_000 })
    // En el teléfono los filtros van plegados tras el botón «Filtros».
    const filtros = page.getByRole('button', { name: /^Filtros/ })
    if (await filtros.isVisible()) {
        await filtros.click()
    }
    await expect(page.locator('[data-prueba="filtro-motivo"]')).toBeVisible()
    await expect(page.locator('[data-prueba="filtro-origen-bonificacion"]')).toBeVisible()
})
