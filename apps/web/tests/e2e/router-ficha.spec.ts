import { expect, test, type Page } from '@playwright/test'
import { entrar, ir, pestanaRouter } from './ayudas'

/**
 * Ficha del router (núcleo de routers, pedido del PM), en escritorio y teléfono: abre en «Control de
 * velocidad» con el modo único del router en tarjetas y la salud arriba; «Cambiar modo» lleva a la
 * vista previa; un router con excepciones heredadas por plan muestra «Unificar» con su vista previa.
 * Con `CAPTURAS_DIR` guarda capturas en claro y oscuro de cada proyecto (390 y 1280 px).
 */

const CAPTURAS = process.env.CAPTURAS_DIR

async function capturar(page: Page, nombre: string, proyecto: string) {
    if (!CAPTURAS) {
        return
    }
    // El cuerpo del panel tiene su propio scroll: para la página completa se alarga la ventana.
    const tamano = page.viewportSize()
    if (tamano) {
        await page.setViewportSize({ width: tamano.width, height: 2400 })
    }
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(400)
        await page.screenshot({ path: `${CAPTURAS}/${nombre}-${proyecto}-${tema === 'light' ? 'claro' : 'oscuro'}.png` })
    }
    await page.emulateMedia({ colorScheme: 'light' })
    if (tamano) {
        await page.setViewportSize(tamano)
    }
}

test('abre en «Control de velocidad»: tarjetas del modo, salud y vista previa al cambiar', async ({ page }, info) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await capturar(page, 'routers-lista', info.project.name)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro', exact: true }).click()
    await expect(page).toHaveURL(/\/routers\/1$/)

    const pestanas = page.locator('[data-prueba="pestanas-router"]')
    await expect(pestanas.getByRole('tab', { name: 'Control de velocidad' })).toHaveAttribute('aria-selected', 'true')
    const pppoe = page.locator('[data-prueba="control-actual"] [data-tipo="pppoe"]')
    await expect(pppoe).toContainText('RADIUS por sesión')
    await expect(pppoe).toContainText('Qué crea en el MikroTik')
    await expect(page.locator('[data-prueba="salud-tunel"]')).toHaveText('Conectado')
    await expect(page.locator('[data-prueba="salud-ipv4"]')).toContainText('libres')
    await capturar(page, 'router-ficha-velocidad', info.project.name)

    await page.locator('[data-prueba="abrir-cambio-control"]').click()
    const modal = page.getByRole('dialog', { name: /Control de velocidad · RB-Centro/ })
    await modal.locator('[data-prueba="capa-tipo-cola"]').getByRole('radio', { name: 'CAKE' }).click()
    await modal.locator('[data-prueba="revisar-estrategia"]').click()
    await expect(modal.locator('[data-prueba="vista-previa-estrategia"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="previa-conservan"]')).toBeVisible()
    await modal.getByRole('button', { name: 'Volver a editar' }).click()
    await modal.getByRole('button', { name: 'Cancelar' }).click()
    await expect(modal).toBeHidden()

    await pestanaRouter(page, 'Red de acceso')
    await expect(page).toHaveURL(/pestana=red-acceso/)
    await expect(page.locator('[data-prueba="router-red-acceso"]')).toBeVisible()
    await pestanaRouter(page, 'Pools e IPs')
    await expect(page.locator('[data-prueba="router-direccionamiento"]')).toBeVisible()
})

test('excepción heredada por plan: «Unificar» muestra qué planes cambian y aplica', async ({ page }, info) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: /CCR-Mixco/ }).click()
    const aviso = page.locator('[data-prueba="excepciones-heredadas"]')
    await expect(aviso).toContainText('1 plan tiene su propia velocidad en este router')
    await expect(aviso).toContainText('Fibra Mixco 100 Mbps')
    await capturar(page, 'router-ficha-excepciones', info.project.name)
    await aviso.getByRole('button', { name: 'Unificar' }).click()
    const modal = page.getByRole('dialog', { name: /Unificar el control de velocidad · CCR-Mixco/ })
    await expect(modal.locator('[data-prueba="unificar-planes"] [data-plan="4"]')).toContainText('Fibra Mixco 100 Mbps')
    await expect(modal.locator('[data-prueba="vista-previa-estrategia"]')).toBeVisible()
    await capturar(page, 'router-unificar', info.project.name)
    await modal.locator('[data-prueba="unificar-confirmar"]').click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('CCR-Mixco: un solo modo de velocidad', { exact: true })).toBeVisible()
    await expect(aviso).toBeHidden()
})

test('red de acceso: árbol con local-address, detectar (501 en el CCR) e importar en el RB-Centro', async ({ page }, info) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: /CCR-Mixco/ }).click()
    await pestanaRouter(page, 'Red de acceso')
    const red = page.locator('[data-prueba="router-red-acceso"]')
    await expect(red.locator('[data-vlan]')).toHaveCount(2)
    await expect(red.locator('[data-prueba="local-address-2"]')).toHaveText('100.64.20.1')
    await capturar(page, 'router-red-acceso', info.project.name)

    await red.locator('[data-prueba="abrir-descubrir"]').click()
    const descubrir = page.getByRole('dialog', { name: /Detectar en el router · CCR-Mixco/ })
    await expect(descubrir.locator('[data-prueba="descubrir-no-disponible"]')).toContainText('Todavía no disponible')
    await expect(descubrir.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await capturar(page, 'router-descubrir-no-disponible', info.project.name)
    await descubrir.getByRole('button', { name: 'Cerrar' }).first().click()

    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro', exact: true }).click()
    await pestanaRouter(page, 'Red de acceso')
    await red.locator('[data-prueba="abrir-descubrir"]').click()
    const leido = page.getByRole('dialog', { name: /Detectar en el router · RB-Centro/ })
    const nuevo = leido.locator('[data-descubierto="*C"]')
    await expect(nuevo).toContainText('Nuevo')
    await nuevo.getByRole('checkbox').click()
    await capturar(page, 'router-descubrir', info.project.name)
    await leido.locator('[data-prueba="descubrir-importar"]').click()
    await expect(leido).toBeHidden()
    await expect(red.locator('[data-servidor]')).toHaveCount(2)
    await expect(red).toContainText('edificio-150')
})

test('alta de servicio en un router con varios servidores PPPoE: se elige y se ve el gateway', async ({ page }, info) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)
    await page.locator('table a[href^="/clientes/"]').first().click()
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await alta.getByRole('radio', { name: /CCR-Mixco/ }).click()
    await alta.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    await alta.getByRole('button', { name: 'Siguiente' }).click()
    const seccion = alta.locator('[data-prueba="alta-servidor-pppoe"]')
    await expect(seccion).toBeVisible()
    await seccion.locator('[data-prueba="selector-servidor-pppoe"]').click()
    await page.getByRole('option', { name: /fibra-202/ }).click()
    await expect(seccion.locator('[data-prueba="gateway-servicio"]')).toContainText('100.64.20.1')
    await capturar(page, 'servicio-selector-servidor', info.project.name)
})
