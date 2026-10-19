import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Fase 4 · cobros y bancos (A3, §10.3 y §10.9) en modo fixtures, en escritorio y teléfono:
 *
 * 1. Cobros por liquidar: la pasarela tiene la anomalía de 12 días y un contracargo; se registra la
 *    liquidación (bruto propuesto = Σ pagos − contracargos, comisión, neto) y queda en la lista.
 * 2. Depósito de caja y conciliación: se deposita desde el turno abierto, el depósito queda en
 *    tránsito y se concilia con su línea del extracto (pasa a acreditado); las reglas concilian la
 *    comisión y la transferencia; deshacer pide motivo.
 * 3. Cartera: el castigo pide la frase escrita y muestra el estado de la factura que dice la API
 *    (`castigada`, decisión g).
 */
test('registrar la liquidación de la pasarela', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cobros por liquidar', /\/cobros\/por-liquidar/)

    const pasarela = page.locator('[data-proveedor="1"]')
    await expect(pasarela.locator('[data-prueba="saldo-puente"]')).toContainText('Q 218.33')
    await expect(pasarela.locator('[data-prueba="anomalias"]')).toHaveText('1 con más de 7 días')
    await expect(pasarela.locator('[data-anomalia="si"]')).toHaveText('12 días')

    await pasarela.getByRole('button', { name: 'Registrar liquidación' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.getByLabel('Bruto')).toHaveValue('218.33')
    await modal.getByLabel('Comisión').fill('6.55')
    await expect(modal.locator('[data-prueba="liquidacion-neto"]')).toHaveText('Q 211.78')
    await modal.getByLabel('Referencia').fill('LIQ-2026-10-15')
    await modal.getByRole('button', { name: 'Registrar liquidación' }).click()

    await expect(page.locator('[data-prueba="tabla-liquidaciones"]')).toContainText('LIQ-2026-10-15')
    await expect(pasarela.locator('[data-prueba="saldo-puente"]')).toContainText('Q 0.00')
    await page.getByRole('link', { name: 'LIQ-2026-10-15' }).click()
    await expect(page).toHaveURL(/\/cobros\/liquidaciones\/2$/)
    await expect(page.getByText('Q 211.78', { exact: true })).toBeVisible()
})

test('depositar desde la caja y conciliarlo con el extracto', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Caja', /\/caja/)
    await page.locator('[data-caja="2"]').click()
    const turno = page.locator('[data-prueba="turno-abierto"]')
    await expect(turno.locator('[data-prueba="turno-esperado"]')).toBeVisible()
    await turno.getByRole('button', { name: 'Depositar al banco' }).click()
    const deposito = page.getByRole('dialog', { name: 'Depositar al banco' })
    await deposito.getByLabel('Monto').fill('100.00')
    await deposito.getByLabel('Boleta').fill('B-9001')
    await deposito.getByLabel('Cuenta que recibe').click()
    await page.getByRole('option', { name: /Banco Industrial · Monetaria/ }).click()
    await deposito.getByRole('button', { name: 'Depositar' }).click()
    await expect(turno.locator('[data-prueba="turno-depositos"]')).toContainText('− Q 100.00')
    await expect(turno.locator('[data-prueba="depositos-turno"]')).toContainText('boleta B-9001')

    await ir(page, 'Conciliación bancaria', /\/bancos\/extractos/)
    await page.getByRole('link', { name: /#1 · Banco Industrial/ }).click()
    await expect(page.locator('[data-prueba="avance-conciliacion"]')).toHaveText('1 de 6')

    await page.getByRole('button', { name: 'Aplicar reglas' }).click()
    await expect(page.locator('[data-prueba="resultado-reglas"]')).toContainText('2 líneas conciliadas')
    await expect(page.locator('[data-prueba="avance-conciliacion"]')).toHaveText('3 de 6')

    // La línea del depósito en efectivo de B-4471 (del día anterior) se concilia con su depósito.
    const fila = page.getByRole('row').filter({ hasText: 'DEPOSITO EN EFECTIVO' })
    await fila.getByRole('button', { name: 'Conciliar' }).first().click()
    const panel = page.getByRole('dialog', { name: 'Conciliar línea' })
    await expect(panel.locator('[data-partida="d1"]')).toBeVisible()
    await expect(panel.locator('[data-prueba="diferencia-conciliacion"]')).toContainText('Cuadra')
    await panel.getByRole('button', { name: 'Conciliar' }).click()
    await expect(page.locator('[data-prueba="avance-conciliacion"]')).toHaveText('4 de 6')

    await fila.getByRole('button', { name: /Deshacer/ }).first().click()
    const deshacer = page.getByRole('dialog', { name: 'Deshacer conciliación' })
    await deshacer.getByRole('button', { name: 'Deshacer conciliación' }).click()
    await expect(deshacer).toContainText('Escribe el motivo')
    await deshacer.getByLabel('Motivo').fill('Fecha equivocada')
    await deshacer.getByRole('button', { name: 'Deshacer conciliación' }).click()
    await expect(page.locator('[data-prueba="avance-conciliacion"]')).toHaveText('3 de 6')

    await ir(page, 'Fondos en tránsito', /\/bancos\/transito/)
    await expect(page.locator('[data-prueba="tabla-depositos"]')).toContainText('B-9001')
})

test('castigar una factura con la frase escrita', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cartera', /\/cartera/)
    await page.getByRole('button', { name: 'Castigar cartera' }).click()
    const modal = page.getByRole('dialog', { name: 'Castigar cartera' })
    await modal.getByPlaceholder('Nombre, NIT, teléfono, usuario PPP o IP').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).click()
    const facturas = modal.locator('[data-prueba="castigo-facturas"]')
    await expect(facturas).toBeVisible()
    await facturas.getByRole('checkbox').first().check()
    await modal.getByLabel('Motivo').fill('Cliente se mudó del país')
    await modal.getByLabel('Evidencia de la gestión de cobro').fill('Llamadas del 02, 09 y 16 de octubre; carta certificada sin respuesta')
    await modal.getByRole('button', { name: 'Castigar facturas' }).click()
    await expect(modal).toContainText('Escribe CASTIGAR para confirmar')
    await modal.getByLabel('Confirmación').fill('CASTIGAR')
    await modal.getByRole('button', { name: 'Castigar facturas' }).click()

    const resultado = page.locator('[data-prueba="resultado-castigo"]')
    await expect(resultado).toContainText('Juan Carlos Ramírez')
    await expect(resultado.locator('[data-estado-factura]').first()).toHaveText('Castigada')
    await expect(page.locator('[data-prueba="tabla-castigos"]')).toContainText('Cliente se mudó del país')
})
