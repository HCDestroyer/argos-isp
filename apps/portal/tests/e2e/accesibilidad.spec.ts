import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Accesibilidad del portal: axe sin violaciones WCAG 2.1 A/AA (contraste AA incluido) en claro y en
 * oscuro, a 390 px (teléfono) y 1280 px (escritorio, los dos proyectos de `playwright.config.ts`).
 *
 * Recorre `/corte`, `/entrar`, `/contacto` y las cuatro secciones de `/cuenta`, con una empresa y
 * con servicios en dos empresas (multiempresa: una sección por empresa con su saldo, sus facturas y
 * una tarjeta de Telegram por empresa). En modo fixtures la sesión vive en memoria: después de
 * entrar se navega por la SPA (barra de secciones), nunca con `page.goto`, que la reiniciaría.
 */

const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function revisar(page: Page, nombre: string): Promise<void> {
    // Sin animaciones a medias: axe mide el color final.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze()
    const resumen = resultado.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => `${n.target.join(' ')} ${n.html.slice(0, 160)}`).join(' | ')}`)
    expect.soft(resumen, `${nombre}: violaciones de axe`).toEqual([])
}

/** Entra con el código de los fixtures (`123456`) y espera la cuenta. */
async function entrar(page: Page, cuenta: string | null): Promise<void> {
    await page.goto(cuenta ? `/entrar?cuenta=${cuenta}` : '/entrar')
    await page.waitForLoadState('networkidle')
    await revisar(page, 'entrar')
    // Lo escrito antes de la hidratación se pierde: se reintenta hasta que aparezca el paso del código.
    await expect(async () => {
        await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
        await page.getByRole('button', { name: 'Enviarme un código' }).click()
        await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
    await page.locator('input').first().click()
    await page.keyboard.type('123456')
    await expect(page).toHaveURL(/\/cuenta/)
    await page.getByTestId('cuenta').waitFor()
}

/** Va a una sección de `/cuenta` por la barra (inferior en el teléfono, superior en escritorio). */
async function seccion(page: Page, etiqueta: string, testId: string): Promise<void> {
    await page.getByRole('link', { name: etiqueta, exact: true }).first().click()
    await page.getByTestId(testId).waitFor()
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

        test('/corte y /contacto sin violaciones de axe', async ({ page }) => {
            await page.goto('/corte')
            // Puede ser la primera página que pide el servidor recién levantado (Vite compila).
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await revisar(page, 'corte')
            await page.goto('/contacto')
            await page.getByRole('heading', { level: 1 }).first().waitFor()
            await revisar(page, 'contacto')
        })

        test('promociones: tarjeta y carrusel en /corte e inicio de /cuenta sin violaciones de axe', async ({ page }) => {
            // `?anuncios=N` en fixtures: N anuncios del panel (se recuerda en la pestaña)
            await page.goto('/corte?anuncios=1')
            await page.getByTestId('promociones-pagina_corte').waitFor({ timeout: 90_000 })
            await revisar(page, 'corte con una promoción')
            await page.goto('/corte?anuncios=3')
            await page.getByTestId('promo-carrusel').waitFor()
            await revisar(page, 'corte con carrusel')
            // la promo va debajo de pagar y de pedir promesa
            const pagar = await page.getByTestId('pagar-en-linea').boundingBox()
            const promesa = await page.getByTestId('solicitar-promesa').boundingBox()
            const promo = await page.getByTestId('promociones-pagina_corte').boundingBox()
            expect(promo!.y).toBeGreaterThan(pagar!.y)
            expect(promo!.y).toBeGreaterThan(promesa!.y)
            // sin desbordar a lo ancho (390 px incluidos)
            const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            expect(ancho).toBeLessThanOrEqual(0)
            await entrar(page, null)
            await page.getByTestId('promociones-portal_inicio').waitFor()
            await revisar(page, 'cuenta con promociones')
        })

        test('puntos: saldo, premios, historial y confirmación sin violaciones de axe', async ({ page }) => {
            // `?puntos=canje` en fixtures: programa visible con canje (se recuerda en la pestaña)
            await page.goto('/corte?puntos=canje')
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await entrar(page, null)
            await page.getByTestId('resumen-puntos').waitFor()
            await revisar(page, 'cuenta con puntos: inicio')
            await seccion(page, 'Puntos', 'premios')
            await revisar(page, 'cuenta: puntos')
            const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            expect(ancho).toBeLessThanOrEqual(0)
            await page.getByTestId('premio-501').getByTestId('canjear').click()
            await page.getByTestId('confirmar-canje').waitFor()
            await revisar(page, 'puntos: confirmar canje')
        })

        test('sorteos: aviso en /corte, página pública y sección de la cuenta sin violaciones de axe', async ({ page }) => {
            await page.goto('/corte?sorteos=1&anuncios=1')
            await page.getByTestId('aviso-sorteo').first().waitFor({ timeout: 90_000 })
            await revisar(page, 'corte con aviso de sorteo')
            await page.goto('/sorteos/27')
            await page.getByTestId('verificacion').waitFor()
            await revisar(page, 'sorteo público')
            const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            expect(ancho).toBeLessThanOrEqual(0)
            await entrar(page, null)
            await page.getByTestId('aviso-sorteo-boletos').first().click()
            await page.getByTestId('sorteo-27').waitFor()
            await revisar(page, 'cuenta: sorteos')
        })

        for (const cuenta of [null, 'dos_empresas'] as const) {
            const nombre = cuenta ? 'dos empresas' : 'una empresa'
            test(`/cuenta con ${nombre} sin violaciones de axe`, async ({ page }) => {
                await entrar(page, cuenta)
                await revisar(page, `cuenta (${nombre}): inicio`)
                if (cuenta) {
                    await expect(page.locator('[data-testid^="grupo-empresa-"]')).toHaveCount(2)
                    await expect(page.getByTestId('facturas-grupo').first()).toBeVisible()
                }
                await seccion(page, 'Pagar', 'seccion-pagar')
                await revisar(page, `cuenta (${nombre}): pagar`)
                await seccion(page, 'Facturas', 'seccion-facturas')
                await revisar(page, `cuenta (${nombre}): facturas`)
                await seccion(page, 'Cuenta', 'seccion-cuenta')
                if (cuenta) {
                    await expect(page.locator('[data-testid^="telegram-empresa-"]')).toHaveCount(2)
                }
                await revisar(page, `cuenta (${nombre}): mi cuenta`)
            })
        }
    })
}
