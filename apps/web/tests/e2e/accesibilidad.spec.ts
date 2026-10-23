import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Identidad "vidrio y luz" (checklist de la skill): axe sin violaciones WCAG 2.1 A/AA —contraste
 * AA incluido— en claro y en oscuro, y foco visible. Recorre las pantallas principales del panel
 * en modo fixtures.
 */
const PANTALLAS = [
    ['bloqueos del libro', '/libro/bloqueos'],
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
    // Multiempresa (dos empresas en los fixtures).
    ['empresas', '/configuracion/empresas'],
    ['sugerencias por zona y router', '/configuracion/empresas?tab=sugerencias'],
    ['usuarios', '/usuarios'],
    ['notificaciones', '/configuracion/notificaciones'],
    ['notificaciones de una empresa', '/configuracion/notificaciones?empresa=2'],
    ['servicio de otra empresa', '/servicios/4'],
    ['cliente con dos empresas', '/clientes/3?tab=cuenta'],
    ['cobro con dos empresas', '/cobro?cliente=3'],
    ['balance por empresa', '/libro?tab=balance'],
    ['estado de resultados', '/libro?tab=resultados'],
    ['bitácora con empresas', '/bitacora'],
    // Fase 4 (cobros y bancos).
    ['cobros por liquidar', '/cobros/por-liquidar'],
    ['fondos en tránsito', '/bancos/transito'],
    ['extracto y conciliación', '/bancos/extractos/1'],
    ['reporte de conciliación', '/bancos/conciliacion'],
    ['cartera', '/cartera'],
    ['pago con proveedor de cobro', '/pagos/7003'],
    // Lealtad, fase 1.
    ['lealtad', '/lealtad'],
    ['puntos del cliente', '/clientes/2?tab=puntos'],
    ['reporte de lealtad', '/reportes/lealtad'],
    // Sorteos.
    ['sorteos', '/lealtad/sorteos'],
    ['sorteo ejecutado', '/lealtad/sorteos/5'],
    ['sorteo con corte cerrado', '/lealtad/sorteos/4'],
    // Anuncios del portal.
    ['anuncios', '/anuncios'],
    ['ficha de anuncio', '/anuncios/1'],
    // Servicios adicionales y tipo de plan.
    ['adicionales', '/adicionales'],
    ['motivos de cortesía', '/adicionales/motivos'],
    ['ficha de plan', '/planes/3'],
    ['bonificaciones', '/bonificaciones'],
    ['ficha de bonificación', '/bonificaciones/3'],
    ['reporte de bonificaciones', '/reportes/bonificaciones'],
    // Libros legales con folio (fase 6 PR D).
    ['libros legales', '/libros'],
    ['emisiones de libros', '/libros/emisiones?emision=3'],
    ['habilitaciones de folios', '/libros/habilitaciones'],
    // Calendario fiscal y feriados (fase 7 PR A).
    ['calendario fiscal', '/fiscal/calendario'],
    ['calendario fiscal en lista', '/fiscal/calendario?vista=lista'],
    ['obligación fiscal', '/fiscal/calendario?obligacion=8'],
    // Tablero fiscal (fase 8 PR A): bloques en error y que no aplican, alertas y vencidas.
    ['tablero fiscal', '/fiscal/tablero'],
    ['feriados', '/configuracion/fiscal?pestana=feriados'],
    // Declaraciones de IVA y pequeño contribuyente (fase 7 PR B).
    ['declaraciones', '/declaraciones'],
    ['declaración de IVA', '/declaraciones/3'],
    ['declaración sustituida', '/declaraciones/2'],
    // ISR, ISO, retenciones, ajustes y cierre anual (fase 7 PR C).
    ['declaración de ISR anual', '/declaraciones/5'],
    ['declaración de retenciones', '/declaraciones/6'],
    ['ajustes fiscales', '/declaraciones/ajustes?anio=2026'],
    ['ejercicios anuales', '/libro?tab=ejercicios'],
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
            // Puede ser la primera página que pide el servidor recién levantado (Vite compila y
            // recarga): se espera sin el plazo corto de expect.
            await page.getByRole('button', { name: 'Entrar' }).waitFor()
            await revisar(page, 'login')
        })

        test('pantallas principales sin violaciones de axe', async ({ page }) => {
            // ~40 pantallas; en frío la primera compilación de cada página se lleva varios segundos.
            test.setTimeout(300_000)
            await entrar(page, 'admin@argos.test')
            for (const [nombre, ruta] of PANTALLAS) {
                // Un paso por pantalla y esperas acotadas: si una no llega a estar lista, falla
                // con su nombre en segundos en vez de agotar el plazo de la prueba.
                await test.step(nombre, async () => {
                    await page.goto(ruta)
                    await page.locator('main, [id^="dashboard-panel"]').first().waitFor({ timeout: 15_000 })
                    await page.waitForLoadState('networkidle', { timeout: 15_000 })
                    await page.waitForTimeout(400)
                    await revisar(page, nombre)
                })
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
