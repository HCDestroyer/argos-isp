import { expect, test, type Locator } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Identificación del cliente cortado (`contratos/corte-identificacion.md` §5 y §5 bis), en escritorio y
 * teléfono, claro y oscuro: el alta del router obliga a elegirla (sin API «Por código» no se puede), el
 * diagnóstico de corte de un router con NAT («el portal ve otra IP») lleva a «Editar router» y, ya en
 * código, sale en verde; la ficha del servicio muestra el estado del código de corte sin el código.
 */
function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('alta del router: hay que elegir la identificación; «Por código» necesita la API', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="nuevo-router"]').click({ timeout: 30_000 })
    const alta = page.getByRole('dialog', { name: 'Nuevo router' })
    const corte = alta.locator('[data-prueba="router-corte-identificacion"]')
    await expect(corte.getByRole('radio', { name: /^Por código/ })).not.toBeChecked()
    await expect(corte.getByRole('radio', { name: /^Por IP/ })).not.toBeChecked()
    await expect(corte.getByRole('radio', { name: /^Por código/ })).toBeDisabled()
    await campo(alta, 'router-nombre').fill('RB-Norte')
    await campo(alta, 'router-host').fill('10.40.0.1')
    await campo(alta, 'router-nas').fill('10.40.0.1')
    await alta.locator('[data-prueba="router-guardar"]').click()
    await expect(corte).toContainText('Elige cómo identificar al cliente cortado')

    await alta.getByLabel('Usuario de la API').fill('argos')
    await alta.getByLabel('Contraseña de la API').fill('clave-api-segura')
    await expect(corte.getByRole('radio', { name: /^Por código/ })).toBeEnabled()
    await corte.getByRole('radio', { name: /^Por código/ }).click()
    await expect(corte).toContainText('puerto 3346, cerrado desde afuera')
    await alta.locator('[data-prueba="router-guardar"]').click()
    await expect(page).toHaveURL(/\/routers\/\d+$/)
    await expect(page.locator('[data-prueba="router-corte-identificacion"]')).toContainText('Corte por código')
})

test('el portal ve otra IP: «Editar router», pasar a código y el diagnóstico queda en verde', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="acciones-router-4"]').click({ timeout: 30_000 })
    await page.getByRole('menuitem', { name: /Probar conexión/ }).click()
    const prueba = page.getByRole('dialog', { name: /Probar conexión · RB-Centro PCQ/ })
    const ip = prueba.locator('[data-corte="portal_ip_cliente"]')
    await expect(ip).toContainText('Falla', { timeout: 30_000 })
    await expect(ip).toContainText('«Identificación del cliente cortado: Por código»')
    await ip.locator('[data-prueba="corte-editar-router"]').click()

    const editar = page.getByRole('dialog', { name: 'Editar RB-Centro PCQ' })
    const corte = editar.locator('[data-prueba="router-editar-corte-identificacion"]')
    await expect(corte.getByRole('radio', { name: /^Por IP/ })).toBeChecked()
    await corte.getByRole('radio', { name: /^Por código/ }).click()
    await expect(editar.locator('[data-prueba="aviso-corte-codigo"]')).toBeVisible()
    await editar.locator('[data-prueba="router-editar-guardar"]').click()
    await expect(editar).toBeHidden()

    await prueba.locator('[data-prueba="probar-de-nuevo"]').click()
    await expect(ip).toContainText('Bien')
    await expect(ip).toContainText('Este router identifica por código de corte')
    await expect(prueba.locator('[data-corte="proxy_corte"]')).toContainText('Reconciliar ahora» lo deja como debe estar')
})

test('ficha del servicio: estado del código de corte sin el código, en claro y oscuro', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // Andrea Paola Gómez: suspendida en CCR-Mixco, que identifica por código.
    await page.goto('/servicios/14')
    const tarjeta = page.locator('[data-prueba="codigo-corte-servicio"]')
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await expect(tarjeta.locator('[data-prueba="codigo-corte-estado"]')).toHaveText('Activo', { timeout: 30_000 })
        await expect(tarjeta).toContainText('Activo desde')
        await expect(tarjeta).toContainText('El código no se muestra')
        await tarjeta.scrollIntoViewIfNeeded()
        const caja = await tarjeta.boundingBox()
        const ancho = page.viewportSize()?.width ?? 0
        expect(caja && caja.x >= 0 && caja.x + caja.width <= ancho + 1).toBe(true)
    }
    await page.emulateMedia({ colorScheme: 'light' })
})
