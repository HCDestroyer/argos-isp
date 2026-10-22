import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Declaraciones de IVA (A3, fase 7 PR B) en modo fixtures, en escritorio y teléfono. Hoy es el
 * 15/10/2026: el mes por declarar es septiembre (IVA a pagar Q534.00). Agosto v2 se presentó tarde
 * (02/10, vencía el 30/09) y sigue sin pagar: su pago lleva mora y multa.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('calcular septiembre, revisar con confirmación, marcar presentada y pagar; agosto con mora y multa', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Declaraciones', /\/declaraciones/)
    await elegirEmpresa(page, /ArgosNet/)

    await page.locator('[data-prueba="abrir-calcular"]').click()
    const calcular = page.getByRole('dialog', { name: 'Calcular declaración' })
    await expect(calcular.locator('[data-prueba="calcular-periodo"]')).toHaveValue('2026-09')
    await calcular.getByRole('button', { name: 'Calcular' }).click()
    await expect(page).toHaveURL(/\/declaraciones\/\d+$/)
    await expect(page.locator('[data-prueba="declaracion-estado"]')).toHaveText('Borrador')
    await expect(page.locator('[data-total="impuesto_determinado"]')).toContainText('534.00')

    // Revisar pide la confirmación escrita: liquida y bloquea los impuestos del mes.
    await page.locator('[data-prueba="abrir-revisar"]').click()
    const revisar = page.getByRole('dialog', { name: /Revisar IVA mensual/ })
    await expect(revisar.locator('[data-prueba="revisar-aviso"]')).toContainText('bloquea los impuestos del mes')
    await expect(revisar.getByRole('button', { name: 'Revisar y liquidar' })).toBeDisabled()
    await revisar.getByRole('checkbox').click()
    await revisar.getByRole('button', { name: 'Revisar y liquidar' }).click()
    await expect(revisar).toHaveCount(0)
    await expect(page.locator('[data-prueba="declaracion-estado"]')).toHaveText('Revisada')

    await page.locator('[data-prueba="abrir-presentar"]').click()
    const presentar = page.getByRole('dialog', { name: 'Marcar presentada' })
    await expect(presentar.locator('[data-prueba="presentar-aviso"]')).toContainText('ArgosIsp no presenta nada a la SAT')
    await presentar.locator('[data-prueba="presentar-numero"]').fill('2237-0004700001')
    await presentar.getByRole('button', { name: 'Marcar presentada' }).click()
    await expect(presentar).toHaveCount(0)
    await expect(page.locator('[data-prueba="declaracion-estado"]')).toHaveText('Presentada')

    await page.locator('[data-prueba="abrir-pagar"]').click()
    const pagar = page.getByRole('dialog', { name: 'Registrar pago' })
    await expect(pagar.locator('[data-prueba="pago-pendiente"]')).toContainText('534.00')
    await pagar.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(pagar).toHaveCount(0)
    await expect(page.locator('[data-prueba="pago-total"]')).toContainText('534.00')

    // La obligación del calendario queda presentada y enlaza la declaración.
    await page.locator('[data-prueba="declaracion-obligacion"]').click()
    await expect(page).toHaveURL(/\/fiscal\/calendario\?obligacion=7/)
    await expect(page.locator('[data-prueba="detalle-estado"]')).toHaveText('Presentada')
    await page.locator('[data-prueba="detalle-declaracion"]').click()
    await expect(page).toHaveURL(/\/declaraciones\/\d+$/)

    // Agosto: presentada tarde y pagada hoy.
    await ir(page, 'Declaraciones', /\/declaraciones/)
    await page.locator('[data-declaracion="3"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/declaraciones\/3$/)
    await page.locator('[data-prueba="abrir-pagar"]').click()
    const tarde = page.getByRole('dialog', { name: 'Registrar pago' })
    await tarde.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(tarde).toHaveCount(0)
    await expect(page.locator('[data-prueba="pago-total"]')).toContainText('860.66')
})

test('el cajero no ve las declaraciones', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Declaraciones', exact: true })).toHaveCount(0)
})
