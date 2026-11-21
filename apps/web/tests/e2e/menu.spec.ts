import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Menú resumido: grupos plegables con el de la página abierto, barra compacta
 * recordada por usuario y buscador de secciones con Ctrl/Cmd+K filtrado por permisos.
 */
test('buscador de secciones con Ctrl+K, solo con las permitidas', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    // El cajero entra directo a su caja; el atajo vive en el layout: esperar a que esté pintada.
    await expect(page).toHaveURL(/\/caja$/)
    await expect(page.locator('[data-prueba="turno-abierto"]')).toBeVisible()
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
    // Caja y Cobrar van en «Día a día»: sueltos en el menú, siempre a la vista.
    const lateral = page.locator('#dashboard-sidebar-principal')
    if (await lateral.isVisible()) {
        await expect(lateral.getByRole('link', { name: 'Caja', exact: true })).toBeVisible()
        await expect(lateral.getByRole('link', { name: 'Cobrar', exact: true })).toBeVisible()
    }
})

test('la barra compacta muestra solo iconos con su nombre y se recuerda', async ({ page, isMobile }) => {
    test.skip(isMobile, 'En el teléfono el menú vive en un panel aparte y no se compacta')
    await entrar(page, 'admin@argos.test')
    const lateral = page.locator('#dashboard-sidebar-principal')
    await page.getByRole('button', { name: /barra lateral/i }).first().click()
    await expect(lateral.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible()
    await expect(lateral.getByText('Gestión', { exact: true })).toBeHidden()
    await expect(lateral.locator('[aria-label="Facturación"]')).toBeVisible()
    const clave = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('argos_menu_compacto:')))
    expect(clave).toBeTruthy()
    expect(await page.evaluate(k => localStorage.getItem(k ?? ''), clave)).toBe('1')
})

test('menú por bloques: día a día suelto, encabezados y solo el grupo actual abierto', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Facturas', /\/facturas$/)
    const lateral = page.locator('#dashboard-sidebar-principal')
    const contenedor = (await lateral.isVisible()) ? lateral : page.getByRole('dialog')
    if (!(await lateral.isVisible())) {
        await page.getByRole('button', { name: 'Abrir barra lateral' }).click()
    }
    const menuPrincipal = contenedor.locator('[data-prueba="menu-principal"]')
    for (const bloque of ['Día a día', 'Gestión', 'Administración', 'Sistema']) {
        await expect(menuPrincipal.getByText(bloque, { exact: true })).toBeVisible()
    }
    for (const seccion of ['Cobrar', 'Caja', 'Clientes', 'Servicios', 'Promesas', 'Comprobantes']) {
        await expect(menuPrincipal.getByRole('link', { name: seccion, exact: true })).toBeVisible()
    }
    // El grupo de la página (Facturación) está abierto; los demás, cerrados.
    await expect(menuPrincipal.getByRole('link', { name: 'Notas de crédito', exact: true })).toBeVisible()
    await expect(menuPrincipal.getByRole('link', { name: 'Routers', exact: true })).toHaveCount(0)
    if (!(await lateral.isVisible())) {
        // En el teléfono el menú es un panel modal: se cierra para volver a la página.
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    // Encabezado de página: migas, título y la ayuda del manual en un panel lateral.
    const encabezado = page.locator('[data-prueba="encabezado-pagina"]')
    await expect(encabezado.getByRole('heading', { level: 1, name: 'Facturas' })).toBeVisible()
    await encabezado.locator('[data-prueba="boton-ayuda"]').click()
    await expect(page.locator('[data-prueba="ayuda-manual"]')).toBeVisible()
})
