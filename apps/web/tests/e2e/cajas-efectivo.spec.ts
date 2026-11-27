import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Cajas y efectivo (tableros PlanCajas y PlanCajasMovil; lotes B1 y B9 del plan de contabilidad):
 * recibir una entrega con diferencia y depositar la custodia; caja chica con gasto con comprobante,
 * conteo con faltante y reposición por lo gastado; el cajero sin acceso a los depósitos del banco.
 * En el teléfono las pestañas son Efectivo, Caja chica y Recibir, con la acción fija abajo.
 */
function esTelefono(page: Page): boolean {
    return (page.viewportSize()?.width ?? 1280) < 1024
}

async function pestana(page: Page, nombre: RegExp) {
    await page.locator('[data-prueba="pestanas-conta"]').getByRole('tab', { name: nombre }).click()
}

test('recibir una entrega con faltante y depositar la custodia', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cajas y efectivo', /\/caja\/efectivo/)

    await expect(page.locator('[data-indicador="custodia"]')).toContainText('Q 2,050.00')
    await expect(page.locator('[data-indicador="caja-chica"]')).toContainText('Q 1,180.00')
    await expect(page.locator('[data-indicador="caja-chica"]')).toContainText('Cuadra')
    await expect(page.locator('[data-indicador="camino"]')).toContainText('Q 900.00')
    if (!esTelefono(page)) {
        await expect(page.locator('[data-prueba="tabla-movimientos"]')).toContainText('E-031')
        await expect(page.locator('[data-prueba="tabla-movimientos"]')).toContainText('Por recibir')
    }

    await pestana(page, /Custodia y depósitos|Recibir/)
    if (esTelefono(page)) {
        await expect(page.locator('[data-prueba="entrega-por-recibir"]')).toContainText('Q 2,850.00')
        await page.locator('[data-prueba="movil-recibir"]').click()
    }
    else {
        await page.locator('[data-prueba="custodia-recibir-31"]').click()
    }
    const recibir = page.getByRole('dialog', { name: 'Recibir la entrega E-031' })
    await expect(recibir.locator('[data-prueba="recibir-monto"]')).toHaveText('Q 2,850.00')
    await recibir.locator('[data-prueba="recibir-contado"]').fill('2840.00')
    await expect(recibir.locator('[data-prueba="recibir-diferencia"]')).toContainText('Falta Q 10.00')
    await recibir.locator('[data-prueba="recibi"]').click()
    await expect(recibir).toContainText('No es lo entregado')
    await recibir.getByLabel('Motivo de la diferencia').fill('Faltó un billete de Q 10')
    await recibir.locator('[data-prueba="recibi"]').click()
    await expect(recibir).toBeHidden()
    await expect(page.locator('[data-indicador="custodia"]')).toContainText('Q 4,890.00')

    if (esTelefono(page)) {
        await page.locator('[data-prueba="movil-depositar"]').click()
    }
    else {
        await page.locator('[data-prueba="abrir-depositar"]').click()
    }
    const deposito = page.getByRole('dialog', { name: 'Depositar lo que tienes en custodia' })
    await expect(deposito.locator('[data-prueba="deposito-custodia-monto"]')).toHaveValue('4890.00')
    await deposito.locator('[data-prueba="deposito-custodia-monto"]').fill('4000.00')
    await deposito.locator('[data-prueba="deposito-custodia-boleta"]').fill('B-7710')
    await deposito.getByLabel('A qué cuenta').click()
    await page.getByRole('option', { name: /Banco Industrial · Monetaria/ }).click()
    await deposito.locator('[data-prueba="deposito-custodia-registrar"]').click()
    await expect(deposito).toBeHidden()
    await expect(page.locator('[data-indicador="custodia"]')).toContainText('Q 890.00')
    await expect(page.locator('[data-indicador="camino"]')).toContainText('Q 4,900.00')
})

test('caja chica: gasto con comprobante, conteo con faltante y reposición', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cajas y efectivo', /\/caja\/efectivo/)
    await pestana(page, /Caja chica/)

    const chica = page.locator('[data-prueba="caja-chica"]')
    await expect(chica.locator('[data-prueba="caja-chica-efectivo"]')).toHaveText('Q 1,180.00')
    await expect(chica.locator('[data-prueba="caja-chica-comprobantes"]')).toHaveText('Q 820.00')
    await expect(chica.locator('[data-prueba="tabla-gastos-caja-chica"]')).toContainText('Combustible moto 2')

    await page.locator(esTelefono(page) ? '[data-prueba="movil-gasto"]' : '[data-prueba="abrir-gasto"]').click()
    const gasto = page.getByRole('dialog', { name: 'Gasto de caja chica' })
    await gasto.locator('[data-prueba="gasto-monto"]').fill('100.00')
    await gasto.locator('[data-prueba="gasto-descripcion"]').fill('Conectores RJ45')
    await gasto.locator('[data-prueba="gasto-registrar"]').click()
    // Sin comprobante no hay gasto.
    await expect(gasto).toContainText('Sube la foto del ticket')
    await gasto.locator('input[type="file"]').setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') })
    await gasto.locator('[data-prueba="gasto-registrar"]').click()
    await expect(gasto).toBeHidden()
    await expect(chica.locator('[data-prueba="caja-chica-efectivo"]')).toHaveText('Q 1,080.00')
    await expect(chica.locator('[data-prueba="caja-chica-comprobantes"]')).toHaveText('Q 920.00')

    await chica.locator(esTelefono(page) ? '[data-prueba="movil-contar"]' : '[data-prueba="abrir-contar"]').click()
    const contar = page.getByRole('dialog', { name: 'Contar la caja chica' })
    await contar.locator('[data-prueba="contar-contado"]').fill('1070.00')
    await expect(contar.locator('[data-prueba="contar-resultado"]')).toContainText('Falta Q 10.00')
    await contar.locator('[data-prueba="contar-guardar"]').click()
    await expect(contar).toContainText('No es lo que debe haber')
    await contar.locator('[data-prueba="contar-motivo"]').fill('Vuelto de combustible sin ticket')
    await contar.locator('[data-prueba="contar-guardar"]').click()
    await expect(contar).toBeHidden()
    await expect(chica.locator('[data-prueba="caja-chica-efectivo"]')).toHaveText('Q 1,070.00')

    await page.locator(esTelefono(page) ? '[data-prueba="movil-reponer"]' : '[data-prueba="abrir-reponer"]').click()
    const reponer = page.getByRole('dialog', { name: 'Reponer la caja chica' })
    await expect(reponer.locator('[data-prueba="reponer-monto"]')).toHaveText('Q 930.00')
    await reponer.getByRole('radio', { name: /Del banco/ }).check()
    await reponer.locator('[data-prueba="reponer-referencia"]').fill('Cheque 1043')
    await reponer.locator('[data-prueba="reponer-confirmar"]').click()
    await expect(reponer).toBeHidden()
    await expect(chica.locator('[data-prueba="caja-chica-efectivo"]')).toHaveText('Q 2,000.00')
    await expect(chica.locator('[data-prueba="caja-chica-comprobantes"]')).toHaveText('Q 0.00')
})

test('el cajero ve su efectivo sin los depósitos del banco ni el «Recibir» ajeno', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await ir(page, 'Cajas y efectivo', /\/caja\/efectivo/)
    await expect(page.locator('[data-indicador="camino"]')).toContainText('Sin acceso')
    await expect(page.locator('[data-indicador="cobros"]')).not.toContainText('No se pudo leer')
    await pestana(page, /Custodia y depósitos|Recibir/)
    await expect(page.locator('[data-entrega="31"]')).toContainText('Ana Administradora aún no dice «Recibí»')
    await expect(page.locator('[data-prueba="custodia-recibir-31"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="movil-recibir"]')).toHaveCount(0)
})
