import { expect, test, type Page } from '@playwright/test'
import { abrirAjustes, entrar, irAjuste } from './ayudas'

/**
 * Ajustes (plan del menú y Ajustes, lotes 2 y 3; respuestas del PM del 26 nov 2026; tableros
 * AjustesEscritorio y AjustesMovil). La página de tarjetas con su buscador, los 8 grupos del admin,
 * buscar «correo» y abrir con Enter, pasar de un ajuste a otro con un clic, un rol con pocos permisos
 * sin grupos vacíos y, en el teléfono, lista → ajuste → «‹ Ajustes» con el pie fijo sin tapar campos.
 */
const esTelefono = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024

function buscador(page: Page) {
    return page.locator('input[data-prueba="buscar-ajuste"], [data-prueba="buscar-ajuste"] input').first()
}

test('el admin ve los 8 grupos, busca «correo» y abre el primero con Enter', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrirAjustes(page)
    await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible()
    const indice = page.locator('[data-prueba="indice-ajustes"]')
    await expect(indice.locator('[data-grupo-ajustes]')).toHaveCount(8)
    for (const grupo of ['Empresa y fiscal', 'Facturación y cobro', 'Clientes y portal', 'Red y equipos', 'Comunicación e integraciones', 'Usuarios y seguridad', 'Apariencia y reportes', 'Sistema']) {
        await expect(indice.getByRole('heading', { name: grupo })).toHaveCount(1)
    }
    await expect(page.getByText('Configuración', { exact: true })).toHaveCount(0)

    await buscador(page).fill('correo')
    await expect(indice.locator('[data-prueba="resultados-ajustes"]')).toContainText('4 resultados')
    await expect(indice.locator('[data-activo="true"]')).toContainText('Canales de aviso')
    await buscador(page).press('Enter')
    await expect(page).toHaveURL(/\/configuracion\/notificaciones$/)
    await expect(page.getByRole('heading', { name: 'Canales de aviso', level: 1 })).toBeVisible()
})

test('de un ajuste a otro con un clic, con la lista a la izquierda o «‹ Ajustes» en el teléfono', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await irAjuste(page, 'Datos de la empresa', /\/configuracion\/empresas$/)
    await expect(page.getByRole('heading', { name: 'Datos de la empresa', level: 1 })).toBeVisible()
    if (esTelefono(page)) {
        await expect(page.locator('[data-prueba="navegacion-ajustes"]')).toBeHidden()
        await expect(page.locator('[data-prueba="grupo-ajuste"]')).toHaveText('Empresa y fiscal')
        // El pie fijo («Descartar / Guardar») queda encima de la isla y el último campo se puede llevar por encima.
        const pie = page.locator('[data-prueba="pie-configuracion"]')
        const isla = await page.locator('[data-prueba="isla-movil"]').boundingBox()
        const rectPie = await pie.boundingBox()
        expect(rectPie!.y + rectPie!.height).toBeLessThanOrEqual(isla!.y)
        await page.locator('.panel-cuerpo').first().evaluate((cuerpo) => {
            cuerpo.scrollTop = cuerpo.scrollHeight
        })
        const tarjeta = await page.locator('[data-prueba="tarjeta-configuracion"]').boundingBox()
        expect(tarjeta!.y + tarjeta!.height).toBeLessThanOrEqual(rectPie!.y + 1)
        await page.locator('[data-prueba="volver-ajustes"]').click()
        await expect(page).toHaveURL(/\/configuracion$/)
        await irAjuste(page, 'Régimen e impuestos', /\/configuracion\/fiscal$/)
    }
    else {
        const lateral = page.locator('[data-prueba="navegacion-ajustes"]')
        await expect(lateral.locator('[aria-current="page"]')).toHaveText('Datos de la empresa')
        await expect(page.locator('[data-prueba="migas"]')).toContainText('Empresa y fiscal')
        await lateral.getByRole('link', { name: 'Régimen e impuestos', exact: true }).click()
        await expect(page).toHaveURL(/\/configuracion\/fiscal$/)
        await expect(lateral.locator('[aria-current="page"]')).toHaveText('Régimen e impuestos')
        // El buscador de la lista lleva a otro grupo.
        await buscador(page).fill('mora')
        await buscador(page).press('Enter')
        await expect(page).toHaveURL(/\/plantillas$/)
    }
})

test('el cajero ve solo lo suyo: 2 grupos de 8, sin grupos vacíos', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await abrirAjustes(page)
    const indice = page.locator('[data-prueba="indice-ajustes"]')
    await expect(indice.locator('[data-grupo-ajustes]')).toHaveCount(2)
    await expect(indice.locator('[data-ajuste]')).toHaveCount(5)
    await expect(indice.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
    await buscador(page).fill('logo')
    await expect(page.locator('[data-prueba="ajustes-sin-resultados"]')).toContainText('Nada coincide con «logo»')
    await page.getByRole('button', { name: 'Borrar búsqueda' }).click()
    await expect(indice.locator('[data-grupo-ajustes]')).toHaveCount(2)
})
