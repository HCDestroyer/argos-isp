import { expect, test } from '@playwright/test'
import { entrar, ir, menu } from './ayudas'

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
    // Caja y Cobrar van en «Día a día», el grupo abierto en la caja.
    const lateral = await menu(page)
    await expect(lateral.getByRole('link', { name: 'Caja', exact: true })).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Cobrar', exact: true })).toBeVisible()
})

test('menú compacto (rail): un icono por área con su menú flotante, por teclado, y se recuerda al expandir', async ({ page, isMobile }) => {
    test.skip(isMobile, 'En el teléfono el menú vive en un panel aparte y no se compacta')
    await entrar(page, 'admin@argos.test')
    const lateral = page.locator('#dashboard-sidebar-principal')
    const rail = lateral.locator('[data-prueba="menu-rail"]')
    // Por defecto, compacto: áreas con etiqueta corta y sin la lista de secciones.
    await expect(rail).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Notas de crédito', exact: true })).toHaveCount(0)
    const area = rail.locator('[aria-label="Día a día"]')
    await area.focus()
    await page.keyboard.press('Enter')
    const flotante = page.locator('[data-prueba="menu-area-dia"]')
    await expect(flotante).toBeVisible()
    await expect(area).toHaveAttribute('data-state', 'open')
    await page.keyboard.press('Escape')
    await expect(flotante).toBeHidden()
    await area.click()
    await flotante.getByRole('link', { name: /^Promesas/ }).click()
    await expect(page).toHaveURL(/\/promesas$/)
    await expect(flotante).toBeHidden()
    // Expandir: nombres y grupos en acordeón; la elección se recuerda por usuario.
    await lateral.locator('[data-prueba="alternar-menu"]').click()
    await expect(lateral.locator('[data-prueba="menu-principal"]')).toBeVisible()
    const clave = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('argos_menu_compacto:')))
    expect(await page.evaluate(k => localStorage.getItem(k ?? ''), clave)).toBe('0')
})

test('menú expandido: grupos en acordeón con el de la página abierto y encabezado de página con ayuda', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Facturas', /\/facturas$/)
    const lateral = page.locator('#dashboard-sidebar-principal')
    const contenedor = (await lateral.isVisible()) ? lateral : page.getByRole('dialog')
    if (!(await lateral.isVisible())) {
        await page.getByRole('button', { name: 'Abrir barra lateral' }).click()
    }
    const menuPrincipal = contenedor.locator('[data-prueba="menu-principal"]')
    // El grupo de la página (Facturación) está abierto; los demás, cerrados.
    await expect(menuPrincipal.getByRole('link', { name: 'Notas de crédito', exact: true })).toBeVisible()
    await expect(menuPrincipal.getByRole('link', { name: 'Routers', exact: true })).toHaveCount(0)
    await expect(menuPrincipal.getByRole('button', { name: 'Día a día' })).toHaveAttribute('aria-expanded', 'false')
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

test('accesos rápidos de un clic: 2 directos y «Más» con el resto, Alt+número y personalizar', async ({ page, isMobile }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)
    const barra = page.locator('[data-prueba="accesos-rapidos"]')
    // De fábrica (admin): Clientes y Servicios directos; el resto en «Más».
    await expect(barra.locator('[data-acceso="clientes"]')).toBeVisible()
    await expect(barra.locator('[data-acceso="servicios"]')).toBeVisible()
    await expect(barra.locator('[data-acceso="cobro"]')).toHaveCount(0)
    await barra.locator('[data-prueba="mas-accesos"]').click()
    const mas = page.locator('[data-prueba="menu-accesos-rapidos"]')
    await expect(mas.getByRole('link', { name: /Cobrar/ })).toBeVisible()
    await mas.locator('[data-prueba="personalizar-accesos"]').click()
    const editor = page.getByRole('dialog', { name: 'Personalizar accesos rápidos' })
    // Se sube «Cobrar» al primer lugar y se guarda.
    await editor.getByRole('button', { name: 'Subir Cobrar' }).click()
    await editor.getByRole('button', { name: 'Subir Cobrar' }).click()
    await editor.locator('[data-prueba="guardar-accesos"]').click()
    await expect(editor).toBeHidden()
    await expect(barra.locator('[data-acceso="cobro"]')).toBeVisible()
    test.skip(isMobile, 'El atajo de teclado es para escritorio')
    await page.keyboard.press('Alt+Digit2')
    await expect(page).toHaveURL(/\/clientes$/)
    await page.keyboard.press('Alt+Digit1')
    await expect(page).toHaveURL(/\/cobro$/)
})

test('caja en la barra: icono con su estado y, en el menú, ir a la caja', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)
    await page.locator('[data-prueba="acceso-caja"]').click()
    const menuCaja = page.locator('[data-prueba="menu-caja"]')
    await expect(menuCaja).toContainText('abierta')
    await menuCaja.getByRole('link', { name: 'Ir a la caja' }).click()
    await expect(page).toHaveURL(/\/caja$/)
})
