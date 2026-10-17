import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/** Semana 3 (3.ª tanda) · tarea 3: del menú a la lista, al detalle y a su factura. */
test('notas de crédito: lista, detalle y factura', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Notas de crédito', /\/notas-credito$/)

    const primera = page.getByRole('link', { name: /^Nota #\d+$/ }).first()
    await expect(primera).toBeVisible()
    await primera.click()
    await expect(page).toHaveURL(/\/notas-credito\/\d+$/)
    await expect(page.getByText('Datos de la nota')).toBeVisible()
    await expect(page.getByText('Asiento del libro')).toBeVisible()

    await page.getByRole('link', { name: /^Factura #\d+$/ }).click()
    await expect(page).toHaveURL(/\/facturas\/\d+$/)
    await expect(page.getByRole('link', { name: /^Nota #\d+/ }).first()).toBeVisible()
})
