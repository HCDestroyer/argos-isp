import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Identidad "vidrio y luz" (checklist de la skill): axe sin violaciones WCAG 2.1 A/AA —contraste
 * AA incluido— en claro y en oscuro, y foco visible. Recorre las pantallas principales del panel
 * en modo fixtures.
 */
const PANTALLAS = [
    ['inicio', '/'],
    ['clientes', '/clientes'],
    ['ficha de cliente', '/clientes/1'],
    ['servicios', '/servicios'],
    ['ficha de servicio', '/servicios/1'],
    ['cobro', '/cobro?cliente=1'],
    ['facturas', '/facturas'],
    ['caja', '/caja'],
    ['reportes', '/reportes'],
    ['reporte de cartera', '/reportes/cartera-vencida'],
    ['migración de router', '/routers/migracion?router=1'],
] as const

const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function revisar(page: Page, nombre: string): Promise<void> {
    // Sin animaciones a medias (aura, números): axe mide el color final.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze()
    const resumen = resultado.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
    expect.soft(resumen, `${nombre}: violaciones de axe`).toEqual([])
}

for (const tema of ['light', 'dark'] as const) {
    test.describe(`tema ${tema === 'light' ? 'claro' : 'oscuro'}`, () => {
        test.use({ colorScheme: tema })

        test.beforeEach(async ({ page }) => {
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('nuxt-color-mode', t)
                }
                catch {
                    // Sin almacenamiento: el tema sale de prefers-color-scheme.
                }
            }, tema)
        })

        test('login sin violaciones de axe', async ({ page }) => {
            await page.goto('/login')
            await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
            await revisar(page, 'login')
        })

        test('pantallas principales sin violaciones de axe', async ({ page }) => {
            test.setTimeout(180_000)
            await entrar(page, 'admin@argos.test')
            for (const [nombre, ruta] of PANTALLAS) {
                await page.goto(ruta)
                await expect(page.locator('main, [id^="dashboard-panel"]').first()).toBeVisible()
                await page.waitForLoadState('networkidle')
                await page.waitForTimeout(400)
                await revisar(page, nombre)
            }
        })

        test('el foco se ve: contorno de 2 px en el color primario', async ({ page }) => {
            await page.goto('/login')
            await page.getByLabel('Correo').focus()
            await page.keyboard.press('Tab')
            await page.keyboard.press('Tab')
            const foco = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null
                if (!el) {
                    return null
                }
                const estilo = getComputedStyle(el)
                return { estilo: estilo.outlineStyle, ancho: estilo.outlineWidth, visible: el.matches(':focus-visible') }
            })
            expect(foco).not.toBeNull()
            expect(foco?.visible).toBe(true)
            expect(foco?.estilo).not.toBe('none')
            expect(Number.parseFloat(foco?.ancho ?? '0')).toBeGreaterThanOrEqual(2)
        })
    })
}
