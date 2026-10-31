import { expect, test, type Locator } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Router sin RADIUS (A1, `modo_seguridad = 'api'`), en escritorio y teléfono: el alta no pide la IP
 * del NAS ni el secreto, la ficha y la lista lo marcan «Sin RADIUS» y explican PPPoE con secrets
 * locales, y el script de conexión sale en su variante sin RADIUS. Un servicio PPPoE en ese router
 * (`contratos/pppoe-local.md`) se da de alta con la ayuda del secret local y su ficha muestra la
 * sesión «Por sondeo», sin NAS ni consumo. En modo fixtures se navega por la SPA (sin `page.goto`
 * después de entrar).
 */
function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('alta de un router sin RADIUS y de un servicio PPPoE en él, con su sesión por sondeo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)

    // Alta: el modo va arriba; «Sin RADIUS» quita la IP del NAS y el secreto.
    await page.locator('[data-prueba="nuevo-router"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo router' })
    await expect(alta.getByRole('radio', { name: /RADIUS \(recomendado\)/ })).toBeChecked()
    await expect(alta.locator('[data-prueba="router-nas"]')).toBeVisible()
    await alta.getByRole('radio', { name: /Sin RADIUS \(todo por la API REST\)/ }).click()
    await expect(alta.locator('[data-prueba="router-nas"]')).toBeHidden()
    await expect(alta.getByText('Secreto RADIUS', { exact: true })).toBeHidden()
    await campo(alta, 'router-nombre').fill('RB-Norte API')
    await campo(alta, 'router-host').fill('10.40.0.1')
    // PPPoE sin RADIUS crea los secrets con las credenciales de la API.
    await expect(alta.getByText('Sin RADIUS, PPPoE se crea como secret con este usuario')).toBeVisible()
    await alta.getByLabel('Usuario de la API').fill('argos')
    await alta.getByLabel('Contraseña de la API').fill('clave-api-segura')
    await alta.locator('[data-prueba="router-guardar"]').click()
    await expect(page).toHaveURL(/\/routers\/\d+$/)
    const routerId = page.url().split('/').pop()

    // Ficha: NAS «Sin RADIUS», distintivo del modo y script deshabilitado con su motivo.
    await expect(page.locator('[data-prueba="router-nas-ip"]')).toContainText('Sin RADIUS')
    await expect(page.locator('[data-prueba="router-modo-seguridad"]')).toHaveText('Sin RADIUS')
    await expect(page.locator('[data-prueba="router-pppoe-sin-radius"]')).toContainText('PPPoE va con secrets locales')
    await expect(page.locator('[data-prueba="router-pppoe-sin-radius"]')).toContainText('cada minuto')
    // Script de conexión en su variante sin RADIUS (túnel y API, `use-radius=no`).
    const conexion = page.locator('[data-prueba="conexion-router"]')
    await expect(conexion.locator('[data-prueba="abrir-script"]')).toBeEnabled()
    await expect(conexion.locator('[data-prueba="script-sin-radius"]')).toContainText('el script conecta el túnel y la API, y deja use-radius=no')
    await conexion.locator('[data-prueba="abrir-script"]').click()
    const script = page.getByRole('dialog', { name: /^Script de conexión/ })
    await expect(script).toContainText('Sin RADIUS: deja use-radius=no.')
    await script.locator('[data-prueba="script-generar"]').click()
    await expect(script.locator('[data-prueba="script-listo"]')).toBeVisible()
    await expect(script.locator('[data-prueba="script-texto"] textarea, textarea[data-prueba="script-texto"]').first()).toHaveValue(/use-radius=no/)
    await script.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect(script).toBeHidden()

    // Una red IPv4 para las IP de los servicios.
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

    // Servicio PPPoE en ese router: queda elegido, con la ayuda del secret local.
    await ir(page, 'Clientes', /\/clientes$/)
    // El primer cliente de la lista (activo, sin servicio en este router).
    await page.locator('table a[href^="/clientes/"]').first().click()
    await expect(page).toHaveURL(/\/clientes\/\d+/)
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const servicio = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(servicio).toBeVisible()
    await servicio.getByRole('radio', { name: /RB-Norte API/ }).click()
    await expect(servicio.locator('[data-prueba="router-sin-radius"]')).toContainText('RB-Norte API no usa RADIUS')
    await expect(servicio.getByRole('radio', { name: /^PPPoE/ })).toBeEnabled()
    await expect(servicio.getByRole('radio', { name: /^PPPoE/ })).toBeChecked()
    await expect(servicio.locator('[data-prueba="tipo-conexion"]')).toContainText('Sin RADIUS: el usuario se crea como secret en el MikroTik; sin consumo de datos ni cambios al instante')
    await expect(servicio.locator('[data-prueba="pppoe-local-requiere-api"]')).toBeHidden()
    await servicio.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    await servicio.getByRole('button', { name: 'Siguiente' }).click()
    // Red y acceso: usuario PPP generado (se lee para encontrar el servicio después).
    const usuario = await servicio.locator('[name="user_ppp"] input, input[name="user_ppp"]').first().inputValue()
    expect(usuario).not.toBe('')
    // → Instalación y cobro → Resumen.
    for (let i = 0; i < 2; i++) {
        await servicio.getByRole('button', { name: 'Siguiente' }).click()
    }
    const resumen = servicio.locator('[data-prueba="resumen-alta"]')
    await expect(resumen).toContainText('RB-Norte API')
    await expect(resumen).toContainText('PPPoE')
    await page.getByRole('button', { name: 'Crear servicio' }).click()
    await expect(servicio).toBeHidden()
    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)

    const enlace = page.getByRole('link', { name: usuario, exact: true })
    await expect(enlace).toBeVisible()
    await enlace.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)
    await expect(page.getByText('RB-Norte API').first()).toBeVisible()

    // Sesión leída por el sondeo de /ppp/active: «Por sondeo», sin NAS ni consumo.
    await expect(page.locator('[data-prueba="sesion-activa-sondeo"]')).toHaveText('Por sondeo')
    await expect(page.locator('[data-prueba="sesion-activa-consumo"]')).toContainText('— (sin RADIUS no hay consumo)')
    await expect(page.getByText(/^— · sondeo:/)).toBeVisible()
    const historial = page.locator('[data-prueba="sesiones-servicio"]')
    await expect(historial.locator('[data-prueba="sesion-por-sondeo"]').first()).toBeVisible()
    await expect(historial).toContainText('— (sin RADIUS no hay consumo)')

    // Sin desbordar a lo ancho (teléfono).
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
})
