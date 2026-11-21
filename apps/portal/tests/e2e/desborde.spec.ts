import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Banner de bienvenida e indicadores del inicio de `/cuenta`: a 390 px (y a 1280 px) ningún texto se
 * recorta ni se desborda, las piezas del banner no se montan unas sobre otras, «Total pendiente» y
 * «Vencida desde el …» quedan en una línea, y la barra inferior fija no tapa el final de la página.
 */

interface Caja {
    x: number
    y: number
    width: number
    height: number
}

function seSolapan(a: Caja, b: Caja): boolean {
    return a.x < b.x + b.width - 0.5
        && b.x < a.x + a.width - 0.5
        && a.y < b.y + b.height - 0.5
        && b.y < a.y + a.height - 0.5
}

/** Entra con el código de los fixtures (`123456`) y espera el inicio de la cuenta. */
async function entrar(page: Page): Promise<void> {
    await page.goto('/entrar?con=codigo')
    await expect(async () => {
        await page.getByLabel('NIT, CUI o usuario de conexión').fill('12345679')
        await page.getByRole('button', { name: 'Enviarme un código' }).click()
        await expect(page.getByTestId('destino-codigo')).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 90_000 })
    await page.locator('input').first().click()
    await page.keyboard.type('123456')
    await page.getByTestId('seccion-inicio').waitFor({ timeout: 30_000 })
    await page.getByTestId('indicadores').waitFor()
}

/** Textos (hojas con texto) dentro de `raiz` que se desbordan o se cortan con elipsis. */
async function desbordados(raiz: Locator): Promise<string[]> {
    return raiz.evaluate((nodo) => {
        const malos: string[] = []
        for (const el of nodo.querySelectorAll<HTMLElement>('*')) {
            const texto = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? '').join('').trim()
            if (!texto || el.closest('.sr-only')) {
                continue
            }
            const estilo = getComputedStyle(el)
            const recortado = el.scrollWidth > el.clientWidth + 1 && (estilo.overflow !== 'visible' || estilo.textOverflow === 'ellipsis')
            const sale = el.getBoundingClientRect().right > nodo.getBoundingClientRect().right + 1
            if (recortado || sale) {
                malos.push(texto)
            }
        }
        return malos
    })
}

/** Alto en líneas de un elemento de una sola línea esperada. */
async function lineas(el: Locator): Promise<number> {
    return el.evaluate((nodo) => {
        const alto = nodo.getBoundingClientRect().height
        const linea = Number.parseFloat(getComputedStyle(nodo).lineHeight) || 20
        return alto / linea
    })
}

for (const tema of ['light', 'dark'] as const) {
    test.describe(`banner e indicadores sin desborde (${tema === 'light' ? 'claro' : 'oscuro'})`, () => {
        test.use({ colorScheme: tema })

        test('el banner apila sin solaparse, los KPI no cortan y la barra inferior no tapa nada', async ({ page }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.addInitScript((t) => {
                try {
                    localStorage.setItem('nuxt-color-mode', t)
                }
                catch {
                    // sin almacenamiento: el tema sale de prefers-color-scheme
                }
            }, tema)
            await entrar(page)

            const banner = page.getByTestId('resumen-cuenta')
            expect(await desbordados(banner), 'textos del banner recortados').toEqual([])
            expect(await desbordados(page.getByTestId('indicadores')), 'textos de los indicadores recortados').toEqual([])

            // Ninguna pieza del banner se monta sobre otra.
            const piezas = ['banner-saludo', 'saldo-cuenta', 'banner-total-etiqueta', 'banner-vence', 'banner-estado', 'actualizar-cuenta', 'banner-pagar']
            const cajas: [string, Caja][] = []
            for (const id of piezas) {
                const caja = await banner.getByTestId(id).boundingBox()
                expect(caja, id).not.toBeNull()
                cajas.push([id, caja!])
            }
            for (const [i, [idA, a]] of cajas.entries()) {
                for (const [idB, b] of cajas.slice(i + 1)) {
                    if (idA === 'saldo-cuenta' && idB === 'banner-total-etiqueta') {
                        continue
                    }
                    expect(seSolapan(a, b), `${idA} se monta sobre ${idB}`).toBe(false)
                }
            }

            // Etiqueta y vencimiento en una sola línea (no se parten palabra por palabra).
            expect(await lineas(banner.getByTestId('banner-total-etiqueta'))).toBeLessThan(1.5)
            expect(await lineas(banner.getByTestId('banner-vence'))).toBeLessThan(1.5)

            // Sin scroll horizontal.
            const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            expect(ancho).toBeLessThanOrEqual(0)

            // La barra inferior fija (teléfono) no tapa el final de la página.
            const barra = page.getByTestId('navegacion-inferior')
            if (await barra.isVisible()) {
                await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
                await page.waitForTimeout(200)
                const arriba = (await barra.boundingBox())!.y
                const ultimo = page.getByTestId('pie-politicas')
                const caja = (await ultimo.boundingBox())!
                expect(caja.y + caja.height, 'el pie queda debajo de la barra inferior').toBeLessThanOrEqual(arriba + 0.5)
            }
        })
    })
}

/**
 * Escritorio (1280 y 1440 px): la navegación de escritorio a la vista, sin la barra inferior; el
 * contenido en rejilla (lo último a la derecha de los servicios), dentro de 1200 px y sin scroll
 * horizontal. Igual en «Pagar», «Facturas», «Cuenta» y en la página del comprobante.
 */
for (const ancho of [1280, 1440]) {
    test.describe(`escritorio ${ancho} px`, () => {
        test.use({ viewport: { width: ancho, height: 900 } })

        test('navegación de escritorio, sin barra inferior y en rejilla', async ({ page }, info) => {
            test.skip(info.project.name !== 'escritorio', 'Solo en el proyecto de escritorio')
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await entrar(page)

            await expect(page.getByTestId('navegacion-superior')).toBeVisible()
            await expect(page.getByTestId('navegacion-inferior')).toBeHidden()

            // Lo último va al lado de los servicios, no debajo.
            const servicios = (await page.locator('[data-testid^="grupo-"]').first().boundingBox())!
            const recientes = (await page.getByTestId('recientes').boundingBox())!
            expect(recientes.x).toBeGreaterThan(servicios.x + servicios.width - 1)
            expect(Math.abs(recientes.y - servicios.y)).toBeLessThan(40)

            // Ancho cómodo: hasta 1200 px, centrado, sin scroll horizontal.
            const banner = (await page.getByTestId('resumen-cuenta').boundingBox())!
            expect(banner.width).toBeLessThanOrEqual(1200)
            expect(banner.width).toBeGreaterThan(900)
            const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            expect(sobra).toBeLessThanOrEqual(0)

            for (const [seccion, testid] of [['nav-pagar', 'seccion-pagar'], ['nav-facturas', 'seccion-facturas'], ['nav-cuenta', 'seccion-cuenta']] as const) {
                await page.getByTestId('navegacion-superior').getByTestId(seccion).click()
                await page.getByTestId(testid).waitFor()
                await expect(page.getByTestId('navegacion-inferior')).toBeHidden()
                const columnas = await page.getByTestId(testid).evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)
                expect(columnas, `${testid} en rejilla`).toBeGreaterThan(1)
            }

            await page.getByTestId('navegacion-superior').getByTestId('nav-pagar').click()
            await page.getByTestId('cuenta-subir-comprobante').click()
            await page.getByTestId('comprobante-formulario').waitFor()
            const formulario = (await page.getByTestId('comprobante-formulario').boundingBox())!
            const pasos = (await page.getByLabel('Cómo funciona').boundingBox())!
            expect(pasos.x).toBeGreaterThan(formulario.x + formulario.width - 1)
        })
    })
}
