import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Varias plantillas por documento (pedido del PM: impresoras POS de 80 mm), en modo fixtures, en
 * escritorio (1280 px) y teléfono (390 px): la lista por documento, crear una plantilla POS desde la
 * de fábrica, el editor, y en la caja «Recibo en PDF» con «Imprimir con…» → «POS 80 mm».
 */

async function sinScrollHorizontal(page: Page): Promise<void> {
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(desborde).toBeLessThanOrEqual(1)
}

async function sinViolaciones(page: Page, nombre: string): Promise<void> {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const resultado = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const resumen = resultado.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
    expect.soft(resumen, `${nombre}: violaciones de axe`).toEqual([])
}

test('crear una plantilla POS 80 mm del recibo y verla en la lista', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/aviso-cobro?tipo=recibo_cobro')

    const lista = page.locator('[data-prueba="lista-plantillas"]')
    await expect(lista.locator('[data-plantilla]')).toHaveCount(2)
    await expect(lista.locator('[data-plantilla="4"]')).toContainText('Predeterminada')
    await expect(lista.locator('[data-plantilla="5"]')).toContainText('POS 80 mm')
    await sinScrollHorizontal(page)
    await sinViolaciones(page, 'lista de plantillas')

    await page.locator('[data-prueba="nueva-plantilla"]').click()
    await expect(page).toHaveURL(/\/configuracion\/plantillas-documentos\/nueva\?tipo=recibo_cobro/)
    await page.locator('[data-prueba="nueva-nombre"]').fill('Ticket mostrador')
    await page.getByText('POS 80 mm', { exact: true }).click()
    await sinScrollHorizontal(page)
    await sinViolaciones(page, 'nueva plantilla')
    await page.locator('[data-prueba="crear-plantilla"]').click()

    await expect(page).toHaveURL(/\/configuracion\/plantillas-documentos\/6$/)
    await expect(page.locator('[data-prueba="version-plantilla"]')).toHaveText('De fábrica')
    await expect(page.locator('[data-prueba="nombre-plantilla"]')).toHaveValue('Ticket mostrador')
    await expect(page.locator('textarea')).toHaveValue(/Recibo de cobro/)
    await sinScrollHorizontal(page)
    await sinViolaciones(page, 'editor de plantilla')

    await page.getByRole('link', { name: 'Plantillas' }).click()
    await expect(page).toHaveURL(/\/configuracion\/aviso-cobro\?tipo=recibo_cobro/)
    await expect(lista.locator('[data-plantilla]')).toHaveCount(3)
    await expect(lista.locator('[data-plantilla="6"]')).toContainText('Ticket mostrador')
})

test('en la caja, el recibo se imprime con la plantilla POS 80 mm', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)
    await page.getByPlaceholder('Buscar cliente…').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).click()
    await expect(page.getByLabel('Monto')).toHaveValue('300.00')
    await page.getByLabel('Monto').press('Enter')

    await expect(page.getByRole('article', { name: 'Recibo de pago' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Recibo en PDF' })).toBeVisible()
    await page.getByRole('button', { name: 'Elegir otra plantilla' }).click()
    const pos = page.getByRole('menuitem', { name: /POS 80 mm/ })
    await expect(pos).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Carta/ })).toContainText('predeterminada')
    await sinScrollHorizontal(page)
    // El PDF se abre en otra pestaña (Chromium sin interfaz lo trata como descarga: la URL no cambia).
    const [pestana] = await Promise.all([page.waitForEvent('popup'), pos.click()])
    await expect(page.getByText('No se pudo generar el recibo')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(pestana.isClosed()).toBe(false)
})
