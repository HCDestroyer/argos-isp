import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Fase 7 PR C en modo fixtures, en escritorio y teléfono. Hoy es el 15/10/2026. ArgosNet: ISR anual 2025
 * presentado y pagado (sus notas piden confirmar criterios con el contador), IVA de julio pagado,
 * ejercicio 2024 cerrado y 2025 abierto.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('ISR trimestral por trimestre, anular un pago y registrar otro, ajustes y el cierre anual desde la declaración', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Declaraciones', /\/declaraciones/)
    await elegirEmpresa(page, /ArgosNet/)

    // ISR trimestral: el periodo es un trimestre (por defecto el último terminado).
    await page.locator('[data-prueba="abrir-calcular"]').click()
    const calcular = page.getByRole('dialog', { name: 'Calcular declaración' })
    await calcular.locator('[data-prueba="calcular-impuesto"]').click()
    await page.getByRole('option', { name: /ISR trimestral/ }).click()
    await expect(calcular.locator('[data-prueba="calcular-trimestre"]')).toContainText('3.er trimestre')
    await calcular.getByRole('button', { name: 'Calcular' }).click()
    await expect(page).toHaveURL(/\/declaraciones\/\d+$/)
    await expect(page.locator('[data-prueba="declaracion-notas"]')).toContainText('Renta presunta')
    await expect(page.locator('[data-total="a_pagar"]')).toContainText('688.00')

    // IVA de julio: anular su pago (confirmación escrita) y registrar otro.
    await ir(page, 'Declaraciones', /\/declaraciones/)
    await page.locator('[data-declaracion="1"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/declaraciones\/1$/)
    await page.locator('[data-prueba="abrir-anular-pago"]').click()
    const anular = page.getByRole('dialog', { name: 'Anular pago' })
    await anular.locator('[data-prueba="anular-pago-motivo"]').fill('Boleta con el NIT equivocado')
    await expect(anular.getByRole('button', { name: 'Anular pago' })).toBeDisabled()
    await anular.getByRole('checkbox').click()
    await anular.getByRole('button', { name: 'Anular pago' }).click()
    await expect(anular).toHaveCount(0)
    await expect(page.locator('[data-prueba="declaracion-pagos-anulados"]')).toContainText('Boleta con el NIT equivocado')
    await page.locator('[data-prueba="abrir-pagar"]').click()
    const pagar = page.getByRole('dialog', { name: 'Registrar pago' })
    await pagar.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(pagar).toHaveCount(0)
    await expect(page.locator('[data-prueba="pago-total"]')).toBeVisible()

    // Ajustes fiscales: registrar uno anual de 2026.
    await ir(page, 'Declaraciones', /\/declaraciones/)
    await page.getByRole('link', { name: 'Ajustes fiscales' }).click()
    await expect(page).toHaveURL(/\/declaraciones\/ajustes/)
    await expect(page.locator('[data-ajuste]')).toHaveCount(3)
    await page.locator('[data-prueba="abrir-ajuste"]').click()
    const ajuste = page.getByRole('dialog', { name: 'Registrar ajuste fiscal' })
    await ajuste.locator('[data-prueba="ajuste-monto"]').fill('450')
    await ajuste.locator('[data-prueba="ajuste-concepto"]').fill('Multas no deducibles')
    await ajuste.getByRole('button', { name: 'Registrar ajuste' }).click()
    await expect(ajuste).toHaveCount(0)
    await expect(page.locator('[data-ajuste]')).toHaveCount(4)

    // Cierre anual de 2025: el ISR sale de la declaración ISR anual, no se escribe.
    await ir(page, 'Libro', /\/libro/)
    await page.getByRole('tab', { name: 'Ejercicios' }).click()
    await expect(page.locator('[data-ejercicio="2024"]')).toBeVisible()
    await page.locator('[data-prueba="abrir-cerrar-ejercicio"]').click()
    const cerrar = page.getByRole('dialog', { name: 'Cerrar ejercicio' })
    await expect(cerrar.locator('[data-prueba="cerrar-isr-declaracion"]')).toContainText('El ISR sale de la declaración ISR anual 2025')
    await expect(cerrar.locator('[data-prueba="cerrar-isr-manual"]')).toHaveCount(0)
    await cerrar.getByRole('checkbox').click()
    await cerrar.getByRole('button', { name: 'Cerrar 2025' }).click()
    await expect(cerrar).toHaveCount(0)
    await expect(page.locator('[data-ejercicio="2025"]')).toHaveAttribute('data-estado', 'cerrado')
})
