import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Eliminar sin historial y las vistas «Retirados» / «Inactivos» (`contratos/eliminar.md`), en
 * escritorio y teléfono: lo que nunca se usó se elimina con confirmación; lo demás dice por qué no
 * y ofrece retirar o desactivar.
 */
test('router: «Inactivos» aparte, eliminar uno sin historial y desactivar uno con historial', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    const tabla = page.locator('[data-prueba="tabla-routers"]')
    await expect(tabla.getByRole('link', { name: 'RB-Centro', exact: true })).toBeVisible()
    await expect(tabla.getByRole('link', { name: /RB-Bodega/ })).toHaveCount(0)

    await page.locator('[data-prueba="vista-routers"]').getByRole('tab', { name: 'Inactivos' }).click()
    await expect(page).toHaveURL(/vista=inactivos/)
    await expect(tabla.getByRole('link', { name: 'RB-Centro', exact: true })).toHaveCount(0)
    await tabla.getByRole('link', { name: /RB-Bodega/ }).click()
    await expect(page).toHaveURL(/\/routers\/3$/)

    await page.locator('[data-prueba="eliminar-router"]').click()
    const modal = page.getByRole('dialog', { name: /Eliminar RB-Bodega/ })
    await expect(modal.locator('[data-prueba="eliminar-libera"]')).toContainText('Red IPv4 100.64.30.0/24')
    await expect(modal.locator('[data-prueba="eliminar-confirmar"]')).toBeDisabled()
    await modal.getByRole('checkbox', { name: 'Entiendo que no se puede deshacer' }).click()
    await modal.locator('[data-prueba="eliminar-confirmar"]').click()
    await expect(page).toHaveURL(/\/routers$/)
    await expect(page.getByText('RB-Bodega (respaldo) eliminado', { exact: true })).toBeVisible()

    await tabla.getByRole('link', { name: 'RB-Centro', exact: true }).click()
    await expect(page).toHaveURL(/\/routers\/1$/)
    await expect(page.locator('[data-prueba="no-eliminable"]')).toContainText('No se puede eliminar: tiene 22 servicios y 41 sesiones PPPoE. Puedes desactivarlo.')
    await expect(page.locator('[data-prueba="eliminar-router"]')).toHaveCount(0)
    await page.locator('[data-prueba="cambiar-activo-router"]').click()
    await page.getByRole('dialog', { name: /Desactivar RB-Centro/ }).locator('[data-prueba="confirmar-activo-router"]').click()
    await expect(page.getByText('RB-Centro desactivado', { exact: true })).toBeVisible()
    await expect(page.locator('[data-prueba="cambiar-activo-router"]')).toHaveText('Activar')
})

test('servicio: «Retirados» aparte, el motivo de no eliminar y eliminar uno recién creado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios$/)
    const tabla = page.locator('[data-prueba="tabla-servicios"]')
    await expect(tabla.locator('a[href^="/servicios/"]').first()).toBeVisible()
    await expect(tabla).not.toContainText('Retirado')

    await page.getByRole('button', { name: 'Retirados', exact: true }).click()
    await expect(page).toHaveURL(/estado=retirado/)
    const servicios = tabla.locator('a[href^="/servicios/"]')
    await expect(servicios).toHaveCount(1)
    await expect(tabla).toContainText('Retirado')
    await servicios.first().click()
    await expect(page.locator('[data-prueba="no-eliminable"]')).toContainText('Ya está retirado: lo encuentras en «Retirados».')

    // Un servicio recién dado de alta nunca se usó: se elimina.
    await ir(page, 'Clientes', /\/clientes$/)
    // Desde #180 el alta de cliente es un modal y el de servicio un panel lateral de la ficha.
    await page.getByRole('button', { name: 'Nuevo cliente' }).click()
    const altaCliente = page.getByRole('dialog', { name: 'Nuevo cliente' })
    await expect(altaCliente).toBeVisible()
    await altaCliente.getByLabel('Nombre', { exact: true }).fill('Mario Prueba Borrar')
    await altaCliente.getByLabel('Teléfono').fill('5555-9876')
    await altaCliente.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(alta).toBeVisible()
    await alta.getByRole('radio', { name: /^RB-Centro(?! PCQ)/ }).click()
    await alta.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    // Conexión → Red y PPPoE → Instalación y cobro → Resumen.
    for (let i = 0; i < 3; i++) {
        await alta.getByRole('button', { name: 'Siguiente' }).click()
    }
    await expect(alta.locator('[data-prueba="resumen-alta"]')).toContainText('RB-Centro')
    await alta.getByRole('button', { name: 'Crear servicio' }).click()
    await expect(alta).toBeHidden()
    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)
    await page.getByRole('link', { name: /^mario\./ }).click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)

    await page.locator('[data-prueba="eliminar-servicio"]').click()
    const modal = page.getByRole('dialog', { name: /Eliminar mario\./ })
    await expect(modal.locator('[data-prueba="eliminar-libera"]')).toContainText('IPv4')
    await modal.getByRole('checkbox', { name: 'Entiendo que no se puede deshacer' }).click()
    await modal.locator('[data-prueba="eliminar-confirmar"]').click()
    await expect(page).toHaveURL(/\/servicios$/)
    await expect(page.getByText('Servicio eliminado', { exact: true })).toBeVisible()
})
