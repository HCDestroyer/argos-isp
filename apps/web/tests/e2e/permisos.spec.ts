import { expect, test } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Prueba obligatoria 1 del brief de A4: "Login y navegación por permiso (cajero no ve routers)".
 * El menú sale de `GRUPOS_PANEL` filtrado con `GET /me`; la ruta repite el permiso y manda a
 * `/sin-permiso` si se escribe a mano.
 */
test('el cajero no ve Routers y la ruta lo manda a sin permiso', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')

    const lateral = await menu(page)
    await expect(lateral.getByRole('link', { name: 'Cobrar', exact: true })).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Caja', exact: true })).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Promesas', exact: true })).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Routers', exact: true })).toHaveCount(0)
    await expect(lateral.getByRole('link', { name: 'Plantillas', exact: true })).toHaveCount(0)
    await expect(lateral.getByRole('link', { name: 'Bitácora', exact: true })).toHaveCount(0)
    await expect(lateral.getByRole('link', { name: 'Libro', exact: true })).toHaveCount(0)
    await expect(lateral.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
    // Sin ninguna sección permitida, el grupo entero no aparece.
    await expect(lateral.getByRole('button', { name: 'Reportes y bitácora' })).toHaveCount(0)

    // Escribir la ruta a mano: el middleware de permisos la bloquea.
    await page.goto('/routers')
    await expect(page).toHaveURL(/\/sin-permiso/)
})

test('el administrador ve Routers, Bitácora y Libro', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    const lateral = await menu(page)
    for (const seccion of ['Routers', 'Planes', 'Bitácora', 'Libro', 'Usuarios', 'Facturas', 'Pagos']) {
        await expect(lateral.getByRole('link', { name: seccion, exact: true })).toBeVisible()
    }
})
