import { expect, test, type Locator, type Page } from '@playwright/test'
import { HOY_FIXTURES } from '../../fixtures/facturacion/datos'

/**
 * Piezas comunes de las pruebas de flujo. En modo fixtures los datos viven en memoria: después
 * de entrar se navega por la SPA (menú, enlaces), nunca con `page.goto`, que los reiniciaría.
 */

/**
 * Fija la fecha del navegador en el "hoy" de los fixtures (`HOY_FIXTURES`, mediodía en Guatemala),
 * como `fijarHoyFixtures()` de Vitest: las pantallas comparan contra el reloj real y, sin esto, una
 * factura de los fixtures pasa a vencida cuando el calendario la alcanza. Pone `Date` en esa fecha y
 * lo deja correr desde ahí (`setSystemTime`, no `setFixedTime`): con `Date.now()` congelado, el
 * `USelect` de un modal no llega a abrir sus opciones (bloqueos del libro). Los temporizadores siguen
 * reales. Va antes de `entrar`.
 */
export async function fijarHoyFixtures(page: Page): Promise<void> {
    await page.clock.setSystemTime(new Date(`${HOY_FIXTURES}T18:00:00.000Z`))
}

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
    const contenedor = (await lateral.isVisible()) ? lateral : abierto
    await expandirGrupos(contenedor)
    return contenedor
}

/**
 * El menú va en grupos plegables (solo el de la página actual abierto): abre todos para que las
 * pruebas vean cada enlace permitido. Un grupo sin secciones permitidas no existe.
 */
export async function expandirGrupos(contenedor: Locator): Promise<void> {
    const cerrados = contenedor.locator('[data-prueba="menu-principal"] button[aria-expanded="false"]')
    while (await cerrados.count()) {
        await cerrados.first().click()
    }
}

/** Va a una sección por el menú lateral. */
export async function ir(page: Page, seccion: string, url: RegExp): Promise<void> {
    const contenedor = await menu(page)
    const enlace = contenedor.getByRole('link', { name: seccion, exact: true })
    const antes = await enlace.boundingBox()
    await enlace.click()
    try {
        await expect(page).toHaveURL(url)
    }
    catch (error) {
        // Sin reintento: si el clic no navegó, la falla dice qué había en pantalla (menú del
        // teléfono abierto o cerrado, grupos plegados, si el enlace se movió) para hallar la causa.
        const diagnostico = {
            url: page.url(),
            dialogos: await page.getByRole('dialog').count(),
            lateralVisible: await page.locator('#dashboard-sidebar-principal').isVisible(),
            gruposPlegados: await contenedor.locator('[data-prueba="menu-principal"] button[aria-expanded="false"]').count().catch(() => -1),
            enlaceAntes: antes,
            enlaceDespues: await enlace.boundingBox({ timeout: 1000 }).catch(() => null),
        }
        await test.info().attach('diagnostico-ir', { body: JSON.stringify(diagnostico, null, 2), contentType: 'application/json' })
        throw error
    }
}
