import { expect, test } from '@playwright/test'
import { elegirEmpresa, entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Plan de contabilidad, lote P4 (decisión del PM): «Cargo único» pasa a llamarse «Nueva factura» y
 * se ve sin buscarlo. En la ficha del cliente (junto a Cobrar; en el teléfono, en la barra de abajo),
 * en Facturas y en la ficha del servicio. El formulario es un panel lateral. «Guardar y cobrar ahora»
 * emite y sigue a Cobrar con ese cliente. Escritorio y teléfono.
 */
async function abrirDesdeCliente(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/clientes/2')
    const boton = page.locator('[data-prueba="franja-nueva-factura"]:visible, [data-prueba="nueva-factura-telefono"]:visible').first()
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
}

test('ficha del cliente: «Nueva factura» a la vista; guardar y cobrar ahora sigue a Cobrar', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    // Una factura sin servicio se emite en una empresa: con «Todas» la API no sabe cuál.
    await elegirEmpresa(page, /ArgosNet/)
    await abrirDesdeCliente(page)
    const panel = page.getByRole('dialog', { name: 'Nueva factura' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-prueba="factura-nueva-quien"]')).toContainText('Juan Carlos')
    await panel.locator('[data-prueba="cargo-concepto-1"]').click()
    await page.getByRole('option', { name: 'Visita técnica' }).click()
    await panel.locator('[data-prueba="cargo-precio-1"]').fill('100')
    await expect(panel.locator('[data-prueba="cargo-total"]')).toContainText('Q 100.00')
    await panel.locator('[data-prueba="emitir-y-cobrar"]').click()
    await expect(page).toHaveURL(/\/cobro\?cliente=2/)
})

test('Facturas: «Nueva factura» pide primero el cliente y emite la factura', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await elegirEmpresa(page, /ArgosNet/)
    await ir(page, 'Facturas', /\/facturas/)
    await page.locator('[data-prueba="nueva-factura"]').click()
    const panel = page.getByRole('dialog', { name: 'Nueva factura' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-prueba="emitir-cargo"]')).toBeDisabled()
    await panel.getByPlaceholder('Nombre, NIT, teléfono, usuario PPP o IP').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).first().click()
    await expect(panel.locator('[data-prueba="factura-nueva-quien"]')).toContainText('Juan Carlos Ramírez')
    await panel.locator('[data-prueba="cargo-concepto-1"]').click()
    await page.getByRole('option', { name: 'Visita técnica' }).click()
    await panel.locator('[data-prueba="cargo-precio-1"]').fill('75')
    await expect(panel.locator('[data-prueba="emitir-cargo"]')).toBeEnabled()
    await panel.locator('[data-prueba="emitir-cargo"]').click()
    await expect(page).toHaveURL(/\/facturas\/\d+$/)
})

test('ficha del servicio: «Nueva factura» está a la vista', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    const boton = page.locator('[data-prueba="nueva-factura-servicio"]:visible, [data-prueba="nueva-factura-telefono"]:visible').first()
    await expect(boton).toBeVisible({ timeout: 30_000 })
    await boton.click()
    await expect(page.getByRole('dialog', { name: 'Nueva factura' })).toBeVisible()
})
