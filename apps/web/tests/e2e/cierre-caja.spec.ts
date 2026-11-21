import { expect, test } from '@playwright/test'
import { elegirClienteCobro, entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 5 del brief de A4: "Cierre de caja con diferencia". El cajero cobra
 * Q 300.00 en efectivo en su Caja Central (turno abierto con fondo Q 500.00) y cierra en 3 pasos
 * (tablero NuevoCierreCaja): cuenta Q 795.00 por denominaciones contra Q 800.00 que debe haber
 * (resumen del turno), explica el faltante (obligatorio) y la API cierra con su diferencia.
 */
test('cierre de caja con faltante y motivo obligatorio', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')

    await ir(page, 'Cobrar', /\/cobro/)
    const cobrar = await elegirClienteCobro(page, 'Juan Carlos', /Juan Carlos Ramírez/)
    await expect(cobrar).toHaveText('Cobrar Q 300.00')
    await cobrar.click()
    await expect(page.getByRole('article', { name: 'Recibo de pago' })).toContainText('Caja Central')
    await page.locator('[data-prueba="siguiente-cliente"]').click()

    await ir(page, 'Caja', /\/caja/)
    await page.locator('[data-prueba="cerrar-caja"]').click()
    const modal = page.getByRole('dialog')
    await expect(modal).toContainText('Cerrar Caja Central')

    // Paso 1: contar por billete y moneda (Q 795.00 = 3 × Q200 + Q100 + Q50 + 2 × Q20 + Q5).
    for (const [etiqueta, cantidad] of [['Q 200', '3'], ['Q 100', '1'], ['Q 50', '1'], ['Q 20', '2'], ['Q 5', '1']] as const) {
        await modal.getByLabel(`Cantidad de ${etiqueta} (billete)`).fill(cantidad)
    }
    await expect(modal).toContainText('Q 795.00')
    if (await modal.locator('[data-prueba="cierre-esperado"]').isVisible()) {
        await expect(modal.locator('[data-prueba="cierre-esperado"]')).toContainText('Q 800.00')
        await expect(modal.locator('[data-prueba="cierre-diferencia"]')).toContainText('Falta')
    }
    else {
        await expect(modal).toContainText('Falta Q 5.00')
    }
    await modal.locator('[data-prueba="cierre-revisar"]').click()

    // Paso 2: con diferencia, el motivo es obligatorio.
    await expect(modal.locator('[data-prueba="cierre-motivo"]')).toContainText('Hay una diferencia de − Q 5.00')
    await expect(modal.locator('[data-prueba="cierre-confirmar"]')).toBeDisabled()
    await modal.getByRole('button', { name: 'Faltó cambio' }).click()
    await modal.getByLabel('Nota del motivo de la diferencia').fill('Vuelto mal entregado')
    await modal.locator('[data-prueba="cierre-confirmar"]').click()

    // Paso 3: cerrada, con la diferencia oficial de la API.
    const resultado = modal.locator('[data-prueba="resultado-cierre"]')
    await expect(resultado).toContainText('Caja cerrada')
    await expect(resultado.locator('[data-prueba="cierre-diferencia-oficial"]')).toContainText('− Q 5.00')
    await resultado.locator('[data-prueba="cierre-listo"]').click()
    // Cerrada: la acción principal pasa a «Abrir caja».
    await expect(page.locator('[data-prueba="abrir-caja-barra"]')).toBeVisible()
})
