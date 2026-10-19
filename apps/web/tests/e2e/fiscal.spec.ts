import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Configuración → Fiscal (localización GT, fase 2): régimen con su aviso, parámetros con vigencia
 * y la marca «confirmar con contador», e impuestos con la tasa en positivo. Fixtures: la empresa 1
 * (ArgosNet) tiene cerrado 2026-09, así que una vigencia en ese mes responde 422.
 */
async function elegirArgosNet(page: Page) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: /ArgosNet/ }).click()
    await expect(selector).toContainText('ArgosNet')
}

test('parámetros: un valor en un mes cerrado se explica y uno futuro se inserta sin tocar el vigente', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Fiscal', /\/configuracion\/fiscal/)
    await expect(page.locator('[data-prueba="elegir-empresa"]')).toBeVisible()
    await elegirArgosNet(page)
    await expect(page.locator('[data-prueba="regimen-actual"]')).toContainText('Sobre utilidades')

    await page.getByRole('tab', { name: 'Parámetros' }).click()
    await page.getByText(/^Solo por confirmar con contador/).click()
    const fila = page.locator('[data-parametro="ret_iva_minimo"]')
    await expect(fila).toContainText('Confirmar con contador')
    await page.getByRole('button', { name: 'Nuevo valor de ret_iva_minimo', exact: true }).click()

    const modal = page.getByRole('dialog')
    await expect(modal.locator('[data-prueba="aviso-contador"]')).toBeVisible()
    await modal.getByLabel('Vigente desde').fill('2026-09-15')
    await modal.getByLabel('Motivo').fill('Confirmado con el contador')
    await modal.getByRole('button', { name: 'Guardar valor' }).click()
    await expect(modal).toContainText('La fecha cae en un mes cerrado')
    await expect(modal).toContainText('2026-09')

    await modal.getByLabel('Vigente desde').fill('2027-01-01')
    await modal.getByRole('button', { name: 'Guardar valor' }).click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('ret_iva_minimo actualizado').first()).toBeVisible()
    // Hoy sigue el del paquete (pendiente de confirmar); el nuevo rige desde 2027.
    await expect(fila).toContainText('Confirmar con contador')
    await page.getByRole('button', { name: 'Historial de ret_iva_minimo', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('01/01/2027')
})

test('impuestos: la retención se muestra con signo menos y la tasa nueva se escribe en positivo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Fiscal', /\/configuracion\/fiscal/)
    await elegirArgosNet(page)
    await page.getByRole('tab', { name: 'Impuestos' }).click()
    await expect(page.locator('[data-impuesto="RET_IVA_ESP"]')).toBeVisible()
    await expect(page.getByText('−15.00 %').first()).toBeVisible()

    await page.getByRole('button', { name: 'Nueva versión de RET_IVA_ESP', exact: true }).click()
    const modal = page.getByRole('dialog')
    await modal.getByLabel('Tasa').fill('-15')
    await modal.getByLabel('Motivo').fill('Prueba de signo')
    await modal.getByRole('button', { name: 'Guardar versión' }).click()
    await expect(modal).toContainText('Escribe la tasa en positivo')
})
