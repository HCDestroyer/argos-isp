import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Decisión B (A3): un pago que deja Q 0.33 sin cubrir se cierra como gasto desde su ficha. El
 * resultado lista `diferencias[]` (factura, monto y asiento), la ficha deja de ofrecer la acción y
 * el estado de cuenta del cliente muestra el abono como «Diferencia cerrada (gasto)».
 */
test('cerrar la diferencia de un pago como gasto y verla en el estado de cuenta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)

    await page.getByPlaceholder('Buscar cliente…').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).click()
    await expect(page.locator('[data-prueba="vencido"]')).toHaveText('Q 300.00')
    const monto = page.getByLabel('Monto')
    await expect(monto).toHaveValue('300.00')
    await monto.fill('299.67')
    await monto.press('Enter')
    await expect(page.getByRole('article', { name: 'Recibo de pago' })).toBeVisible()

    // El pago recién registrado es el primero de la lista (id desc).
    await ir(page, 'Pagos', /\/pagos/)
    await page.locator('a[href^="/pagos/"]').first().click()
    await expect(page).toHaveURL(/\/pagos\/\d+$/)
    await expect(page.locator('[data-prueba="pago-saldo-facturas"]')).toContainText('Q 0.33')

    await page.locator('[data-prueba="abrir-cerrar-diferencia"]').click()
    const modal = page.getByRole('dialog', { name: 'Cerrar diferencia' })
    await expect(modal).toContainText('como gasto')
    await modal.getByLabel('Motivo').fill('Pagó Q 0.33 de menos por redondeo')
    await modal.getByRole('button', { name: 'Cerrar diferencia' }).click()

    const resultado = page.locator('[data-prueba="resultado-diferencia"]')
    await expect(resultado).toContainText('Diferencia de Q 0.33 cerrada')
    await expect(resultado.locator('[data-prueba="diferencia-cerrada"]')).toHaveCount(1)
    await expect(resultado).toContainText(/Q 0\.33 a gasto \(5\.3\.05 Diferencias de cobro\) · asiento #\d+/)
    await expect(page.locator('[data-prueba="abrir-cerrar-diferencia"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="pago-saldo-facturas"]')).toHaveCount(0)

    await page.getByRole('link', { name: 'Juan Carlos Ramírez' }).first().click()
    await expect(page).toHaveURL(/\/clientes\/2\?tab=cuenta/)
    await expect(page.locator('[data-prueba="movimiento-diferencia"]')).toHaveText('Diferencia cerrada (gasto)')
})
