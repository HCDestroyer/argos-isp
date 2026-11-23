import { expect, test } from '@playwright/test'
import { elegirClienteCobro, entrar, ir } from './ayudas'

/**
 * Decisión B (A3): un pago que deja Q 0.33 sin cubrir se cierra como gasto desde su ficha. El
 * resultado lista `diferencias[]` (factura, monto y asiento), la ficha deja de ofrecer la acción y
 * el estado de cuenta del cliente muestra el abono como «Diferencia cerrada (gasto)».
 */
test('cerrar la diferencia de un pago como gasto y verla en el estado de cuenta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)

    // Abono de Q 299.67 sobre los Q 300.00 marcados (pestaña «Abono» del cobro POS).
    const cobrar = await elegirClienteCobro(page, 'Juan Carlos', /Juan Carlos Ramírez/)
    await expect(page.locator('[data-prueba="pendiente"]')).toHaveText('Q 300.00')
    await page.getByRole('tab', { name: 'Abono' }).click()
    await page.getByLabel('Monto del abono').fill('299.67')
    await expect(cobrar).toHaveText('Cobrar Q 299.67')
    await cobrar.click()
    await expect(page.locator('[data-prueba="cobro-listo"]')).toContainText('¡Cobro listo!')
    await page.locator('[data-prueba="siguiente-cliente"]').click()

    // El pago recién registrado es el primero de la lista (id desc).
    await ir(page, 'Pagos', /\/pagos/)
    await page.locator('a[href^="/pagos/"]').first().click()
    await expect(page).toHaveURL(/\/pagos\/\d+$/)
    await expect(page.locator('[data-prueba="pago-saldo-facturas"]')).toContainText('Q 0.33')

    await page.locator('[data-prueba="mas-pago"]').click()
    await page.getByRole('menuitem', { name: 'Cerrar diferencia' }).click()
    const modal = page.getByRole('dialog', { name: 'Cerrar diferencia' })
    await expect(modal).toContainText('como gasto')
    await modal.getByLabel('Motivo').fill('Pagó Q 0.33 de menos por redondeo')
    await modal.getByRole('button', { name: 'Cerrar diferencia' }).click()

    const resultado = page.locator('[data-prueba="resultado-diferencia"]')
    await expect(resultado).toContainText('Diferencia de Q 0.33 cerrada')
    await expect(resultado.locator('[data-prueba="diferencia-cerrada"]')).toHaveCount(1)
    await expect(resultado).toContainText(/Q 0\.33 a gasto \(5\.3\.05 Diferencias de cobro\) · asiento #\d+/)
    await expect(page.locator('[data-prueba="pago-saldo-facturas"]')).toHaveCount(0)

    await page.getByRole('link', { name: 'Juan Carlos Ramírez' }).first().click()
    await expect(page).toHaveURL(/\/clientes\/2\?tab=cuenta/)
    await expect(page.locator('[data-prueba="movimiento-diferencia"]')).toHaveText('Diferencia cerrada (gasto)')
})
