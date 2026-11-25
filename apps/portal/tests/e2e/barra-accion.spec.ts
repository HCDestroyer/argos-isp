import { expect, test, type Page } from '@playwright/test'

/**
 * La barra de acción fija del teléfono no tapa el último control ni el pie: se baja hasta el final
 * y se hace clic en el último control de cada pantalla.
 */
async function alFinal(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(300)
}

async function noTapado(page: Page, selector: string): Promise<void> {
    await alFinal(page)
    const control = page.locator(selector).last()
    await control.scrollIntoViewIfNeeded()
    await alFinal(page)
    const caja = await control.boundingBox()
    expect(caja).not.toBeNull()
    const arriba = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el?.closest('.barra-accion') !== null && el !== null
    }, { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 })
    expect(arriba, 'el control quedó bajo la barra fija').toBe(false)
    await control.click({ trial: true, timeout: 5_000 })
}

const pantallas: Array<{ ruta: string, ultimo: string }> = [
    { ruta: '/corte', ultimo: '[data-testid="pie-politicas"] a' },
    { ruta: '/solicitudes/nueva', ultimo: '[data-testid="pie-politicas"] a' },
    { ruta: '/soporte/nuevo', ultimo: '[data-testid="pie-politicas"] a' },
    { ruta: '/cambiar-contrasena', ultimo: '[data-testid="pie-politicas"] a' },
    { ruta: '/comprobante', ultimo: '[data-testid="pie-politicas"] a' },
]

for (const tema of ['light', 'dark'] as const) {
    for (const { ruta, ultimo } of pantallas) {
        test(`${ruta} (${tema}): el pie y el último control no quedan tapados`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: tema })
            await page.goto(ruta)
            await page.waitForLoadState('networkidle')
            await noTapado(page, ultimo)
            const barra = page.locator('.barra-accion').first()
            if (await barra.count() && await barra.isVisible()) {
                const posicion = await barra.evaluate(el => getComputedStyle(el).position)
                if (posicion === 'fixed') {
                    const alto = await barra.evaluate(el => el.getBoundingClientRect().height)
                    const pegada = await barra.evaluate(el => window.innerHeight - el.getBoundingClientRect().bottom)
                    expect(Math.abs(pegada), 'la barra fija debe quedar pegada al borde inferior').toBeLessThanOrEqual(1)
                    const relleno = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom))
                    expect(relleno).toBeGreaterThanOrEqual(alto)
                }
            }
        })
    }
}
