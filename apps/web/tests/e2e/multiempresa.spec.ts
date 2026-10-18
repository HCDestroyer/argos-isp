import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Multiempresa con fixtures de dos empresas: ArgosNet (1) y Fibra del Sur (2, las sucursales de los
 * clientes 3 y 11). El admin tiene alcance global (selector con "Todas"); el cajero, solo la 1.
 */
function selector(page: Page) {
    return page.locator('[data-prueba="selector-empresa"]:visible').first()
}

test('el admin elige una empresa y la lista de servicios muestra solo los suyos', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await expect(selector(page)).toContainText('Todas las empresas')
    await page.getByPlaceholder('Usuario PPP, IP o nombre del cliente').fill('comercial')
    await expect(page.getByRole('link', { name: 'comercial.el3', exact: true })).toBeVisible()

    await selector(page).click()
    await page.getByRole('option', { name: /Fibra del Sur/ }).click()
    await expect(selector(page)).toContainText('Fibra del Sur')
    await expect(page.getByRole('link', { name: 'comercial.el3-b', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'comercial.el3', exact: true })).toHaveCount(0)
})

test('cambiar la empresa de un servicio con saldo explica qué hacer', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await page.getByPlaceholder('Usuario PPP, IP o nombre del cliente').fill('comercial')
    // La búsqueda espera 300 ms y repinta la lista: se hace clic cuando ya está filtrada.
    await expect(page.getByText('Página 1 · 2 filas')).toBeVisible()
    await page.getByRole('link', { name: 'comercial.el3-b', exact: true }).click()
    await expect(page).toHaveURL(/\/servicios\/4/)
    await expect(page.locator('[data-prueba="empresa-servicio"]')).toContainText('Fibra del Sur')
    await page.locator('[data-prueba="abrir-cambiar-empresa"]').click()
    const modal = page.getByRole('dialog')
    await modal.getByLabel('Motivo').fill('El cliente se mudó a la zona centro')
    await modal.locator('[data-prueba="confirmar-cambiar-empresa"]').click()
    await expect(modal.locator('[data-prueba="servicio-con-saldo"]')).toContainText('Primero hay que dejar el servicio sin saldo')
    await expect(modal.locator('[data-prueba="servicio-con-saldo"]')).toContainText('Q 450.00 pendientes')
})

test('notificaciones: la prueba de correo muestra el error real y la empresa hereda la global', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Notificaciones', /\/configuracion\/notificaciones/)
    await expect(page.locator('[data-prueba="origen-notificaciones"]')).toContainText('Del entorno')
    await page.getByLabel('Correo de destino de la prueba').fill('cobros@argosnet.gt')
    await page.locator('[data-prueba="probar-correo"]').click()
    await expect(page.locator('[data-prueba="resultado-prueba"]').first()).toContainText('Enviado a cobros@argosnet.gt')

    await page.locator('[data-prueba="ambito-notificaciones"]').click()
    await page.getByRole('option', { name: 'Fibra del Sur' }).click()
    await expect(page.locator('[data-prueba="origen-notificaciones"]')).toContainText('Hereda la global')
})

test('el cajero tiene una sola empresa: no ve el selector', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)
    await expect(page.locator('[data-prueba="selector-empresa"]')).toHaveCount(0)
})

test('cobro repartido: un pago por empresa y el recibo con una sección por empresa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)
    await page.getByPlaceholder('Buscar cliente…').fill('Comercial El Progreso')
    await page.getByRole('option', { name: /Comercial El Progreso/ }).click()
    await page.locator('[data-factura="310"] button[role="checkbox"]').click()
    await page.locator('[data-factura="410"] button[role="checkbox"]').click()
    await expect(page.locator('[data-prueba="reparto-empresas"]')).toContainText('Fibra del Sur')
    await page.getByRole('button', { name: 'Registrar pago' }).click()

    const partes = page.locator('[data-prueba="pagos-por-empresa"]')
    await expect(partes).toContainText('ArgosNet')
    await expect(partes).toContainText('Fibra del Sur')
    const recibo = page.getByRole('article', { name: 'Recibo del cobro' })
    await expect(recibo.locator('section[data-empresa]')).toHaveCount(2)
    await expect(recibo.locator('[data-prueba="total-cobro"]')).toContainText('Q 900.00')
})

test('libro: balance por empresa con el total del grupo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Libro', /\/libro/)
    await page.getByRole('tab', { name: 'Balance' }).click()
    await expect(page.locator('[data-prueba="total-grupo"]')).toBeVisible()
    await expect(page.locator('[data-prueba="libro-balance"] section[data-empresa="2"]')).toContainText('Fibra del Sur')
})
