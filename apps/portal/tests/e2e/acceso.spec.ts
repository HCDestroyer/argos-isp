import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Entrada al portal con documento y contraseña, cambio obligatorio de la contraseña de la empresa y
 * «Ver mi cuenta» desde `/corte`, en el portal con fixtures: claro y oscuro, 390 px y 1280 px (los dos
 * proyectos de `playwright.config.ts`). Axe sin violaciones WCAG 2.1 A/AA y sin desborde horizontal.
 *
 * Fixtures: documento `12345679`, contraseña propia `MiClave2026`. La sesión vive en memoria del
 * navegador: después de entrar se sigue por la SPA, nunca con `page.goto`.
 *
 * Con `PW_CAPTURAS=/ruta` deja además las capturas de las pantallas nuevas en esa carpeta.
 */

const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const CAPTURAS = process.env.PW_CAPTURAS

async function revisar(page: Page, nombre: string, proyecto: string, tema: string): Promise<void> {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze()
    const resumen = resultado.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => `${n.target.join(' ')} ${n.html.slice(0, 160)}`).join(' | ')}`)
    expect.soft(resumen, `${nombre}: violaciones de axe`).toEqual([])
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect.soft(desborde, `${nombre}: desborde horizontal`).toBeLessThanOrEqual(0)
    if (CAPTURAS) {
        mkdirSync(CAPTURAS, { recursive: true })
        await page.screenshot({ path: join(CAPTURAS, `${nombre}-${tema}-${proyecto}.png`), fullPage: true })
    }
}

/** Lo escrito antes de la hidratación se pierde: reintenta hasta que la entrada funcione. */
async function entrarConContrasena(page: Page, contrasena: string, destino: RegExp): Promise<void> {
    await expect(async () => {
        await page.getByLabel('NIT, CUI o pasaporte').fill('1234567-9')
        await page.getByTestId('campo-contrasena').fill(contrasena)
        await page.getByTestId('entrar-contrasena').click()
        await expect(page).toHaveURL(destino, { timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
}

for (const tema of ['light', 'dark'] as const) {
    const nombreTema = tema === 'light' ? 'claro' : 'oscuro'

    test.describe(`acceso, tema ${nombreTema}`, () => {
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

        test('documento y contraseña: error genérico y entrada a /cuenta', async ({ page }, info) => {
            await page.goto('/entrar')
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await revisar(page, 'entrar-contrasena', info.project.name, nombreTema)

            await expect(async () => {
                await page.getByLabel('NIT, CUI o pasaporte').fill('12345679')
                await page.getByTestId('campo-contrasena').fill('equivocada')
                await page.getByTestId('entrar-contrasena').click()
                await expect(page.getByTestId('error-acceso')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await expect(page.getByTestId('error-acceso')).toContainText('El documento o la contraseña no son correctos')
            await revisar(page, 'entrar-error', info.project.name, nombreTema)

            await entrarConContrasena(page, 'MiClave2026', /\/cuenta/)
            await page.getByTestId('cuenta').waitFor()

            // Desde la cuenta se puede cambiar cuando quiera.
            await page.getByRole('link', { name: 'Cuenta', exact: true }).first().click()
            await page.getByTestId('ir-cambiar-contrasena').click()
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cambiar contraseña')
            await revisar(page, 'cambiar-contrasena', info.project.name, nombreTema)
        })

        test('con la contraseña de la empresa: primero elige la suya', async ({ page }, info) => {
            await page.goto('/entrar?contrasena=defecto')
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await entrarConContrasena(page, 'Bienvenido2026', /\/cambiar-contrasena/)
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Elige tu contraseña')
            await revisar(page, 'elige-contrasena', info.project.name, nombreTema)

            await page.getByTestId('campo-actual').fill('Bienvenido2026')
            await page.getByTestId('campo-nueva').fill('NuevaClave2026')
            await page.getByTestId('campo-confirmacion').fill('OtraCosa2026')
            await page.getByTestId('guardar-contrasena').click()
            await expect(page.getByText('Las dos contraseñas no coinciden')).toBeVisible()
            await revisar(page, 'elige-contrasena-error', info.project.name, nombreTema)

            await page.getByTestId('campo-confirmacion').fill('NuevaClave2026')
            // El aviso de error se va al validar el campo y el botón sube: se espera antes de tocarlo.
            await expect(page.getByText('Las dos contraseñas no coinciden')).toBeHidden()
            await page.getByTestId('guardar-contrasena').click()
            await expect(page).toHaveURL(/\/cuenta/)
            await page.getByTestId('cuenta').waitFor()
        })

        test('«Ver mi cuenta» en /corte abre la cuenta sin pedir nada', async ({ page }, info) => {
            await page.goto('/corte')
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await expect(page.getByTestId('ver-mi-cuenta')).toContainText('Ver mi cuenta')
            await revisar(page, 'corte-ver-mi-cuenta', info.project.name, nombreTema)
            await expect(async () => {
                await page.getByTestId('ver-mi-cuenta').click()
                await expect(page).toHaveURL(/\/cuenta/, { timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
            await page.getByTestId('cuenta').waitFor()
        })

        test('pestaña del código sigue igual', async ({ page }) => {
            await page.goto('/entrar')
            await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 90_000 })
            await expect(async () => {
                await page.getByRole('tab', { name: 'Código' }).click()
                await expect(page.getByLabel('NIT, CUI o usuario de conexión')).toBeVisible({ timeout: 3_000 })
            }).toPass({ timeout: 60_000 })
        })
    })
}
