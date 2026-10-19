import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir, menu } from './ayudas'

/**
 * Integración con Horus (contrato 1.2.0), en modo fixtures, a 1280 y 390 px:
 * 1. Configuración → Integraciones → Horus: apagada por defecto, conectar con un enlace de Horus
 *    (queda apagada), activar; en la ficha del servicio, la seguridad con su hallazgo y "Ver en
 *    Horus" abre la URL de autologin en otra pestaña.
 * 2. `/sso/entrar#<ticket>` sin vinculación: login normal que vincula; "Mi cuenta" la lista.
 * Las capturas (claro y oscuro) quedan en `test-results/capturas-horus/` (no se suben).
 */

const TICKET_SIN_VINCULAR = 'tkt_fixture_sin_vincular_0000000001'

async function capturar(page: Page, nombre: string, zona?: Locator): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        const path = `test-results/capturas-horus/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`
        await (zona ? zona.screenshot({ path }) : page.screenshot({ path }))
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

test('Horus: conectar con enlace, activar, ver la seguridad del servicio y abrir Horus', async ({ page, context }) => {
    await context.route('https://horus.example.test/**', ruta => ruta.fulfill({ status: 200, contentType: 'text/html', body: '<title>Horus</title>Horus' }))
    await entrar(page, 'admin@argos.test')

    await ir(page, 'Integraciones', /\/configuracion\/integraciones$/)
    await page.locator('[data-prueba="configurar-horus"]').click()
    await expect(page).toHaveURL(/\/configuracion\/integraciones\/horus$/)
    await expect(page.locator('[data-prueba="estado-conector"]')).toHaveText('Apagada')

    await page.locator('[data-prueba="enlace-horus"]').fill('https://horus.isp.gt/conectar#abc123def456ghi')
    await page.locator('[data-prueba="conectar-enlace"]').click()
    await expect(page.getByText('Conectado con Horus').first()).toBeVisible()
    await expect(page.locator('[data-prueba="estado-conector"]')).toHaveText('Apagada')
    await page.locator('[data-prueba="interruptor-horus"]').click()
    await expect(page.locator('[data-prueba="estado-conector"]')).toHaveText('Activa')
    await expect(page.locator('[data-prueba="tabla-tokens-horus"]')).toContainText('Horus (enlace de conexión)')

    // El enlace de Argos se muestra una vez, con su caducidad.
    await page.locator('[data-prueba="generar-enlace"]').click()
    await expect(page.locator('[data-prueba="caducidad"]')).toContainText(/Vence en 1[45]:\d\d/)
    await capturar(page, 'configuracion-enlace')
    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(page.locator('[data-prueba="valor-una-vez"]')).toHaveCount(0)
    await capturar(page, 'configuracion')

    await ir(page, 'Servicios', /\/servicios$/)
    await page.getByLabel('Buscar servicios').fill('100.64.10.11')
    // Espera a que la búsqueda filtre (tiene espera) y abre el servicio 1.
    const servicio = page.getByRole('link', { name: /^maria\.jose1$/ })
    await expect(servicio).toBeVisible()
    await servicio.click()
    await expect(page).toHaveURL(/\/servicios\/1$/)
    const seguridad = page.locator('[data-prueba="bloque-horus"] [data-prueba="seguridad-horus"]')
    await expect(seguridad).toHaveAttribute('data-estado', 'suspected')
    await expect(seguridad).toContainText('Sospechoso · 1 hallazgo abierto')
    await expect(page.locator('[data-prueba="hallazgos-horus"]')).toContainText('Escaneo saliente')
    await capturar(page, 'ficha-servicio')
    await capturar(page, 'bloque-horus', page.locator('[data-prueba="bloque-horus"]'))

    const pestana = page.waitForEvent('popup')
    await page.locator('[data-prueba="ver-en-horus-servicio"]').first().click()
    const horus = await pestana
    await expect(horus).toHaveURL(/^https:\/\/horus\.example\.test\/sso\/entrar#tkt_servicio_1_/)
})

test('Horus: autologin sin vinculación pide el login normal, vincula y aparece en Mi cuenta', async ({ page }) => {
    await page.goto(`/sso/entrar#${TICKET_SIN_VINCULAR}`)
    // La primera visita a la página puede compilarla (servidor de desarrollo).
    await expect(page.locator('[data-prueba="sso-vincular"]')).toContainText('Luis Pérez (Horus)', { timeout: 30_000 })
    // El ticket ya no está en la URL.
    await expect(page).toHaveURL(/\/sso\/entrar$/)
    await capturar(page, 'sso-vincular')

    await page.getByLabel('Correo de ArgosIsp').fill('admin@argos.test')
    await page.getByLabel('Contraseña').fill('clave-de-prueba')
    await page.getByRole('button', { name: 'Entrar y vincular' }).click()
    await expect(page).toHaveURL(/\/clientes\/1$/)

    const lateral = await menu(page)
    await lateral.getByRole('button', { name: 'Menú de usuario' }).click()
    await page.getByRole('menuitem', { name: 'Mi cuenta' }).click()
    await expect(page).toHaveURL(/\/perfil$/)
    const tabla = page.locator('[data-prueba="tabla-vinculaciones"]')
    await expect(tabla).toContainText('Ana López (Horus)')
    await expect(tabla).toContainText('Luis Pérez (Horus)')
    await capturar(page, 'mi-cuenta')
})
