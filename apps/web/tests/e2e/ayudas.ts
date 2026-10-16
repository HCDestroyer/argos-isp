import { expect, type Page } from '@playwright/test'

/**
 * Piezas comunes de las pruebas de flujo. En modo fixtures los datos viven en memoria: después
 * de entrar se navega por la SPA (menú, enlaces), nunca con `page.goto`, que los reiniciaría.
 */

export async function entrar(page: Page, email: string): Promise<void> {
    await page.goto('/login')
    await page.getByLabel('Correo').fill(email)
    await page.getByLabel('Contraseña').fill('clave-de-prueba')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).not.toHaveURL(/\/login/)
}

/** Abre el menú lateral si está plegado (teléfono) y devuelve su contenedor. */
export async function menu(page: Page) {
    const lateral = page.locator('#dashboard-sidebar-principal')
    const abrir = page.getByRole('button', { name: 'Abrir barra lateral' })
    // Esperar a que el layout pinte el menú (escritorio) o el botón que lo abre (teléfono).
    await expect(lateral.getByRole('link', { name: 'Inicio' }).or(abrir).first()).toBeVisible()
    if (!(await lateral.isVisible())) {
        await page.getByRole('button', { name: 'Abrir barra lateral' }).click()
    }
    // En teléfono el menú se abre en un panel aparte con los mismos enlaces.
    const abierto = page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Inicio' }) })
    return (await lateral.isVisible()) ? lateral : abierto
}

/** Va a una sección por el menú lateral. */
export async function ir(page: Page, seccion: string, url: RegExp): Promise<void> {
    const contenedor = await menu(page)
    await contenedor.getByRole('link', { name: seccion, exact: true }).click()
    await expect(page).toHaveURL(url)
}
