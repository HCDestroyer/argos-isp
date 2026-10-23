import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Pantallas de la fase 5 (A3, contrato fiscal §19) en modo fixtures, en escritorio y teléfono. Hoy es el
 * 15/10/2026. ArgosNet: Servicios de Limpieza Ramírez con la limpieza de octubre al crédito (retención de
 * ISR Q150, abono de Q1,000, saldo Q2,210) y el egreso 2 de EEGSA (Q1,850.40) sin compra.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

function aviso(page: Page, texto: string) {
    return page.getByLabel('Notifications (F8)').getByText(texto)
}

test('proveedor nuevo, compra al crédito con un activo fijo y su pago desde la ficha', async ({ page }) => {
    test.setTimeout(150_000)
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Proveedores', /\/proveedores/)
    await elegirEmpresa(page, /ArgosNet/)

    await page.locator('[data-prueba="nuevo-proveedor"]').click()
    const dialogo = page.getByRole('dialog', { name: 'Nuevo proveedor' })
    await dialogo.locator('[data-prueba="proveedor-nit"]').fill('1234567-0')
    await dialogo.locator('[data-prueba="proveedor-nombre"]').fill('Redes Totales, S.A.')
    await dialogo.locator('[data-prueba="guardar-proveedor"]').click()
    await expect(dialogo).toContainText('dígito verificador')
    await dialogo.locator('[data-prueba="proveedor-nit"]').fill('1234567-9')
    await dialogo.locator('[data-prueba="guardar-proveedor"]').click()
    await expect(page).toHaveURL(/\/proveedores\/6/)
    await expect(page.locator('[data-prueba="proveedor-saldo"]')).toContainText('Q 0.00')

    // Registrar compra desde la ficha: el proveedor ya viene elegido.
    await page.getByRole('link', { name: 'Registrar compra' }).click()
    await expect(page).toHaveURL(/\/compras\/nueva\?proveedor=6/)
    await page.locator('[data-prueba="compra-numero"]').fill('4410')
    const linea = page.locator('[data-linea="0"]')
    await linea.locator('[data-prueba="linea-descripcion"]').fill('Switch de núcleo')
    await linea.locator('[data-prueba="linea-tipo"]').click()
    await page.getByRole('option', { name: 'Activo fijo' }).click()
    await linea.getByRole('combobox', { name: /Clase/ }).or(linea.locator('button[role="combobox"]').nth(1)).first().click()
    await page.getByRole('option', { name: 'Equipo de red' }).click()
    await linea.locator('[data-prueba="linea-total"]').fill('11200.00')
    await expect(page.locator('[data-prueba="totales-compra"]')).toContainText('1,200.00')
    await page.locator('[data-prueba="guardar-compra"]').click()
    await expect(aviso(page, 'Compra #6 registrada')).toBeVisible()
    await expect(page).toHaveURL(/\/compras\/6/)
    await expect(page.getByRole('link', { name: /Activo #5 · Switch de núcleo/ })).toBeVisible()

    // Pago total desde la ficha del proveedor.
    await page.getByRole('link', { name: 'Redes Totales, S.A.' }).click()
    await expect(page.locator('[data-prueba="proveedor-saldo"]')).toContainText('11,200.00')
    await page.locator('[data-prueba="abrir-pago-proveedor"]').click()
    const pago = page.getByRole('dialog', { name: /Pagar a Redes Totales/ })
    await pago.locator('[data-pendiente="6"]').click()
    await expect(pago.locator('[data-prueba="pago-proveedor-monto"]')).toHaveValue('11200.00')
    await pago.locator('[data-prueba="confirmar-pago-proveedor"]').click()
    await expect(pago).toHaveCount(0)
    await expect(page.locator('[data-prueba="proveedor-saldo"]')).toContainText('Q 0.00')
})

test('compra desde el egreso de EEGSA, constancia de la retención y anular que pide anular el pago', async ({ page }) => {
    test.setTimeout(150_000)
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Egresos', /\/egresos/)
    await elegirEmpresa(page, /ArgosNet/)
    await page.locator('[data-prueba="compra-de-egreso-2"]').click()
    await expect(page).toHaveURL(/\/compras\/nueva\?egreso=2/)
    await expect(page.locator('[data-prueba="compra-desde-egreso"]')).toContainText('Q 1,850.40')
    await page.locator('[data-prueba="compra-proveedor"]').click()
    await page.getByRole('option', { name: /EEGSA/ }).click()
    await page.locator('[data-prueba="compra-numero"]').fill('E-77812')
    await page.locator('[data-linea="0"] [data-prueba="linea-descripcion"]').fill('Energía de octubre')
    await page.locator('[data-linea="0"] [data-prueba="linea-total"]').fill('1850.40')
    await page.locator('[data-prueba="guardar-compra"]').click()
    await expect(page).toHaveURL(/\/compras\/6/)
    await expect(page.getByText('Registrada desde')).toBeVisible()

    // La limpieza de octubre: su constancia y la anulación que pide anular primero el abono.
    await page.goto('/compras/5')
    await page.locator('[data-prueba="abrir-constancia"]').click({ timeout: 30_000 })
    const constancia = page.getByRole('dialog', { name: 'Registrar constancia de retención' })
    await constancia.locator('[data-prueba="constancia-numero"]').fill('CR-0001')
    await constancia.locator('[data-prueba="guardar-constancia"]').click()
    await expect(constancia).toHaveCount(0)
    await expect(page.locator('[data-retencion="RET_ISR_OPC_C"] [data-prueba="constancia-estado"]')).toHaveText('Constancia CR-0001')
    await page.locator('[data-prueba="anular-compra"]').click()
    const anular = page.getByRole('dialog', { name: 'Anular compra #5' })
    await anular.getByRole('textbox').fill('Se facturó dos veces')
    await anular.getByRole('button', { name: 'Anular compra' }).click()
    await expect(anular).toContainText('La compra tiene pagos')
})

test('activos: alta, depreciación al día y baja por retiro', async ({ page }) => {
    test.setTimeout(150_000)
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Activos fijos', /\/activos/)
    await elegirEmpresa(page, /ArgosNet/)
    await page.locator('[data-prueba="depreciar-pendiente"]').click()
    await expect(aviso(page, 'Nada pendiente')).toBeVisible()

    await page.locator('[data-prueba="alta-activo"]').click()
    const alta = page.getByRole('dialog', { name: 'Alta de activo fijo' })
    await alta.locator('[data-prueba="activo-descripcion"]').fill('Torre de 30 metros')
    await alta.locator('[data-prueba="activo-costo"]').fill('24000.00')
    await alta.locator('[data-prueba="activo-tasa"]').fill('12.00')
    await alta.locator('[data-prueba="guardar-activo"]').click()
    await expect(alta).toContainText('Hasta 10.00 %')
    await alta.locator('[data-prueba="activo-tasa"]').fill('')
    await alta.locator('[data-prueba="guardar-activo"]').click()
    await expect(page).toHaveURL(/\/activos\/5/)
    await expect(page.locator('[data-prueba="valor-libros"]')).toContainText('24,000.00')

    await page.locator('[data-prueba="abrir-baja"]').click()
    const baja = page.getByRole('dialog', { name: /Dar de baja/ })
    await baja.locator('[data-prueba="baja-motivo"]').fill('Dañada por una tormenta')
    await baja.locator('[data-prueba="confirmar-baja"]').click()
    await expect(page.locator('[data-prueba="activo-baja"]')).toContainText('Retiro')
})

test('el cajero no ve Compras', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Proveedores', exact: true })).toHaveCount(0)
    await expect(contenedor.getByRole('link', { name: 'Activos fijos', exact: true })).toHaveCount(0)
})
