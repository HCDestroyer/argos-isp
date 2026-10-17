import { expect, test } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Menú resumido (decisión del PM): grupos plegables con el de la página abierto, barra compacta
 * recordada por usuario y buscador de secciones con Ctrl/Cmd+K filtrado por permisos.
 */
test('buscador de secciones con Ctrl+K, solo con las permitidas', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    // El atajo vive en el layout: esperar a que la página de inicio esté pintada.
    await expect(page.getByRole('heading', { name: /^Hola,/ })).toBeVisible()
    const buscador = page.getByRole('dialog')
    await expect(async () => {
        await page.keyboard.press('ControlOrMeta+k')
        await expect(buscador.getByPlaceholder('Ir a una sección…')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await page.keyboard.type('Rout')
    await expect(buscador.getByRole('option', { name: /Routers/ })).toHaveCount(0)
    await buscador.getByPlaceholder('Ir a una sección…').fill('Caja')
    await buscador.getByRole('option', { name: /^Caja/ }).click()
    await expect(page).toHaveURL(/\/caja/)
    // El grupo de la página actual se abre solo.
    const lateral = page.locator('#dashboard-sidebar-principal')
    if (await lateral.isVisible()) {
        await expect(lateral.getByRole('link', { name: 'Caja', exact: true })).toBeVisible()
        await expect(lateral.getByRole('link', { name: 'Cobrar', exact: true })).toHaveCount(0)
    }
})

test('la barra compacta muestra solo iconos con su nombre y se recuerda', async ({ page, isMobile }) => {
    test.skip(isMobile, 'En el teléfono el menú vive en un panel aparte y no se compacta')
    await entrar(page, 'admin@argos.test')
    const lateral = page.locator('#dashboard-sidebar-principal')
    await page.getByRole('button', { name: /barra lateral/i }).first().click()
    await expect(lateral.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible()
    await expect(lateral.getByText('Operación', { exact: true })).toBeHidden()
    await expect(lateral.locator('[aria-label="Cobros"]')).toBeVisible()
    const clave = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('argos_menu_compacto:')))
    expect(clave).toBeTruthy()
    expect(await page.evaluate(k => localStorage.getItem(k ?? ''), clave)).toBe('1')
})
