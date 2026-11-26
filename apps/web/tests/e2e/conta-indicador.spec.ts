import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Plan de contabilidad, lote P3: el indicador con ayuda «?» (tablero PlanIndicadorAyuda). En
 * escritorio la ayuda es una ventana pequeña junto al «?»; en el teléfono, una hoja desde abajo.
 * Siempre las cuatro partes, y se cierra con Esc. Sin violaciones de axe en claro y oscuro.
 */
const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function entrarComoAdmin(page: Page): Promise<void> {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
}

test('cartera: el «?» abre la ayuda con las cuatro partes y Esc la cierra', async ({ page }) => {
    await entrarComoAdmin(page)
    await ir(page, 'Cartera', /\/cartera/)
    const tarjeta = page.locator('[data-prueba="kpi-conta"]').filter({ hasText: 'Con promesa activa' })
    await expect(tarjeta.locator('[data-prueba="kpi-estado"], .tabular-nums').first()).toBeVisible()
    const ayuda = tarjeta.locator('[data-prueba="indicador-ayuda"]')
    await ayuda.focus()
    await page.keyboard.press('Enter')
    const cuerpo = page.locator('[data-ayuda-indicador="con-promesa"]')
    await expect(cuerpo).toBeVisible()
    for (const parte of ['Qué es', 'Cómo se calcula', 'Qué hacer', 'Nombre contable: Promesa de pago']) {
        await expect(cuerpo).toContainText(parte)
    }
    await expect(cuerpo.getByRole('link', { name: 'Abrir el manual' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(cuerpo).toHaveCount(0)
    await expect(ayuda).toBeFocused()
})

test('panel financiero: cada indicador tiene su «?» y la tarjeta de la cartera lleva al detalle', async ({ page }) => {
    await entrarComoAdmin(page)
    await ir(page, 'Panel financiero', /\/finanzas/)
    const tarjetas = page.locator('[data-prueba="kpi-conta"]:visible')
    await expect(tarjetas.first()).toBeVisible()
    const cuantas = await tarjetas.count()
    expect(cuantas).toBeGreaterThanOrEqual(3)
    await expect(page.locator('[data-prueba="kpi-conta"]:visible [data-prueba="indicador-ayuda"]')).toHaveCount(cuantas)
    if (test.info().project.name === 'escritorio') {
        await page.locator('[data-prueba="kpi-conta"]').filter({ hasText: 'Cartera vencida' }).locator('[data-prueba="kpi-enlace"]').click()
        await expect(page).toHaveURL(/\/cartera/)
    }
})

for (const tema of ['light', 'dark'] as const) {
    test(`indicadores y su ayuda abierta sin violaciones de axe (${tema === 'light' ? 'claro' : 'oscuro'})`, async ({ page }) => {
        await page.addInitScript((t) => {
            try {
                localStorage.setItem('nuxt-color-mode', t)
            }
            catch {
                // Sin almacenamiento: el tema sale de prefers-color-scheme.
            }
        }, tema)
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: tema })
        await entrarComoAdmin(page)
        await ir(page, 'Cartera', /\/cartera/)
        await expect(page.locator('[data-prueba="kpi-conta"]').first()).toBeVisible()
        await page.locator('[data-prueba="indicador-ayuda"]').first().click()
        await expect(page.locator('[data-ayuda-indicador]')).toBeVisible()
        const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze()
        const resumen = resultado.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
        expect(resumen).toEqual([])
    })
}
