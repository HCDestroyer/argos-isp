import { expect, test, type Locator } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Router sin RADIUS (A1, `modo_seguridad = 'api'`), en escritorio y teléfono: el alta no pide la IP
 * del NAS ni el secreto, la ficha y la lista lo marcan «Sin RADIUS», el script de conexión queda
 * deshabilitado con su motivo y un servicio en ese router solo puede ser IP estática o DHCP fija.
 * En modo fixtures se navega por la SPA (sin `page.goto` después de entrar).
 */
function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('alta de un router sin RADIUS y de un servicio con IP estática en él', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)

    // Alta: el modo va arriba; «Sin RADIUS» quita la IP del NAS y el secreto.
    await page.locator('[data-prueba="nuevo-router"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo router' })
    await expect(alta.getByRole('radio', { name: /RADIUS \(recomendado\)/ })).toBeChecked()
    await expect(alta.locator('[data-prueba="router-nas"]')).toBeVisible()
    await alta.getByRole('radio', { name: /Sin RADIUS \(solo API: IP estática y DHCP fija\)/ }).click()
    await expect(alta.locator('[data-prueba="router-nas"]')).toBeHidden()
    await expect(alta.getByText('Secreto RADIUS', { exact: true })).toBeHidden()
    await campo(alta, 'router-nombre').fill('RB-Norte API')
    await campo(alta, 'router-host').fill('10.40.0.1')
    await alta.locator('[data-prueba="router-guardar"]').click()
    await expect(page).toHaveURL(/\/routers\/\d+$/)
    const routerId = page.url().split('/').pop()

    // Ficha: NAS «Sin RADIUS», distintivo del modo y script deshabilitado con su motivo.
    await expect(page.locator('[data-prueba="router-nas-ip"]')).toContainText('Sin RADIUS')
    await expect(page.locator('[data-prueba="router-modo-seguridad"]')).toHaveText('Sin RADIUS')
    const conexion = page.locator('[data-prueba="conexion-router"]')
    await expect(conexion.locator('[data-prueba="abrir-script"]')).toBeDisabled()
    await expect(conexion.locator('[data-prueba="script-sin-radius"]')).toContainText('el script de conexión configura RADIUS y CoA')

    // Una red IPv4 de IP fija por servicio: la de un servicio sin PPPoE.
    const direccionamiento = page.locator('[data-prueba="router-direccionamiento"]')
    await direccionamiento.locator('[data-prueba="agregar-red"]').click()
    const red = page.getByRole('dialog', { name: 'Agregar red IPv4' })
    await campo(red, 'red-cidr').fill('100.64.40.0/24')
    await red.getByRole('combobox', { name: /Tipo/ }).click()
    await page.getByRole('option', { name: /Estático/ }).click()
    await red.locator('[data-prueba="red-guardar"]').click()
    await expect(direccionamiento.locator('[data-prueba="redes-router"]')).toContainText('100.64.40.0/24')

    // Lista: el distintivo del modo junto al nombre.
    await ir(page, 'Routers', /\/routers$/)
    await expect(page.locator(`[data-prueba="modo-${routerId}"]`)).toHaveText('Sin RADIUS')
    await expect(page.locator('[data-prueba="modo-1"]')).toHaveText('RADIUS')

    // Servicio en ese router: PPPoE no se ofrece y queda IP estática.
    await ir(page, 'Clientes', /\/clientes$/)
    // El primer cliente de la lista (activo, sin servicio en este router).
    await page.locator('table a[href^="/clientes/"]').first().click()
    await expect(page).toHaveURL(/\/clientes\/\d+/)
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const servicio = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(servicio).toBeVisible()
    await servicio.getByRole('radio', { name: /RB-Norte API/ }).click()
    await expect(servicio.locator('[data-prueba="router-sin-radius"]')).toContainText('RB-Norte API no usa RADIUS')
    await expect(servicio.getByRole('radio', { name: /^PPPoE/ })).toBeDisabled()
    await expect(servicio.getByRole('radio', { name: /^IP estática/ })).toBeChecked()
    await servicio.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    // Conexión → Red y equipo → Instalación y cobro → Resumen.
    for (let i = 0; i < 3; i++) {
        await servicio.getByRole('button', { name: 'Siguiente' }).click()
    }
    const resumen = servicio.locator('[data-prueba="resumen-alta"]')
    await expect(resumen).toContainText('RB-Norte API')
    await expect(resumen).toContainText('IP estática')
    await page.getByRole('button', { name: 'Crear servicio' }).click()
    await expect(servicio).toBeHidden()
    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)

    const enlace = page.getByRole('link', { name: /^100\.64\.40\./ })
    await expect(enlace).toBeVisible()
    await enlace.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)
    const encabezado = page.getByRole('heading', { level: 2, name: /^100\.64\.40\./ })
    await expect(encabezado.locator('..')).toContainText('Activo')
    await expect(page.getByText('RB-Norte API').first()).toBeVisible()
})
