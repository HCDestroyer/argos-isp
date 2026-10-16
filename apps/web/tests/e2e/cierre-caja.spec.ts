import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 5 del brief de A4: "Cierre de caja con diferencia". Con fixtures (hoy las
 * cajas responden 501 en la API real): el cajero cobra Q 300.00 en efectivo en su Caja Central
 * (turno abierto con fondo Q 500.00), cuenta Q 795.00 y cierra con un faltante de Q 5.00; sin
 * motivo no deja cerrar.
 */
test('cierre de caja con faltante y motivo obligatorio', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')

    await ir(page, 'Cobrar', /\/cobro/)
    await page.getByPlaceholder('Buscar cliente…').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).click()
    await expect(page.getByLabel('Monto')).toHaveValue('300.00')
    await page.getByLabel('Monto').press('Enter')
    await expect(page.getByRole('article', { name: 'Recibo de pago' })).toContainText('Caja Central')

    await ir(page, 'Caja', /\/caja/)
    const turno = page.locator('[data-prueba="turno-abierto"]')
    await expect(turno).toContainText('Turno #41 abierto')
    await expect(turno).toContainText('Q 800.00')

    await turno.getByRole('button', { name: 'Cerrar turno' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.locator('[data-prueba="cierre-esperado"]')).toHaveText('Q 800.00')
    await modal.getByLabel('Efectivo contado').fill('795.00')
    await expect(modal.locator('[data-prueba="cierre-diferencia"]')).toHaveText('Faltante Q 5.00')

    await modal.getByRole('button', { name: 'Cerrar turno' }).click()
    await expect(modal).toContainText('Hay diferencia: explica el motivo')

    await modal.getByLabel('Motivo de la diferencia').fill('Faltaron Q 5.00: vuelto mal entregado')
    await modal.getByRole('button', { name: 'Cerrar turno' }).click()

    const resultado = page.locator('[data-prueba="resultado-cierre"]')
    await expect(resultado).toContainText('Esperado Q 800.00')
    await expect(resultado).toContainText('contado Q 795.00')
    await expect(resultado).toContainText('Faltante Q 5.00')
    await expect(page.locator('[data-caja="1"]')).toContainText('Cerrada')
    await expect(page.getByRole('button', { name: 'Abrir turno' })).toBeVisible()
})
