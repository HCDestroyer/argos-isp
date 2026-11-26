import { expect, test } from '@playwright/test'
import { accionServicio, elegirEmpresa, empresaActiva, entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Multiempresa con fixtures de dos empresas: ArgosNet (1) y Fibra del Sur (2, las sucursales de los
 * clientes 3 y 11). El admin tiene alcance global (selector con "Todas"); el cajero, solo la 1.
 */

test('el admin elige una empresa y la lista de servicios muestra solo los suyos', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await expect(empresaActiva(page)).toContainText('Todas las empresas')
    await page.getByPlaceholder('Usuario PPP, IP o nombre del cliente').fill('comercial')
    await expect(page.getByRole('link', { name: 'comercial.el3', exact: true })).toBeVisible()

    await elegirEmpresa(page, /Fibra del Sur/)
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
    await accionServicio(page, 'Cambiar empresa')
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
    await expect(empresaActiva(page)).toHaveCount(0)
    await page.locator('[data-prueba="menu-usuario"]').click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Todas las empresas|ArgosNet/ })).toHaveCount(0)
})

test('cobro repartido: un pago por empresa y el recibo con una sección por empresa', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cobrar', /\/cobro/)
    await page.getByPlaceholder(/Buscar cliente: nombre/).fill('Comercial El Progreso')
    await page.getByRole('option', { name: /Comercial El Progreso/ }).click()
    await page.locator('[data-factura="310"] button[role="checkbox"]').click()
    await page.locator('[data-factura="410"] button[role="checkbox"]').click()
    const continuar = page.locator('[data-prueba="continuar-cobro"]')
    if (await continuar.isVisible()) {
        await continuar.click()
    }
    await expect(page.locator('[data-prueba="reparto-empresas"]')).toContainText('Fibra del Sur')
    await page.locator('[data-prueba="cobrar"]').click()

    const partes = page.locator('[data-prueba="pagos-por-empresa"]')
    await expect(partes).toContainText('ArgosNet')
    await expect(partes).toContainText('Fibra del Sur')
    const recibo = page.locator('article[aria-label="Recibo del cobro"]')
    await expect(recibo.locator('section[data-empresa]')).toHaveCount(2)
    await expect(recibo.locator('[data-prueba="total-cobro"]')).toContainText('Q 900.00')
})

test('libro: balance por empresa con el total del grupo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Reportes', /\/reportes/)
    await page.locator('[data-prueba="reporte-balance"]').click()
    await expect(page).toHaveURL(/\/reportes\/balance/)
    await expect(page.locator('[data-prueba="total-grupo"]')).toBeVisible()
    await expect(page.locator('[data-prueba="libro-balance"] section[data-empresa="2"]')).toContainText('Fibra del Sur')
})

test('alta de empresa con NIT de letras (DEMO-123): avisa el dígito verificador y guarda', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/empresas?nueva=1')
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('Nueva empresa')
    await dialogo.getByLabel('NIT').fill('DEMO-123')
    await expect(dialogo.locator('[data-prueba="aviso-nit-empresa"]')).toContainText('sirve para pruebas')
    await dialogo.getByLabel('Razón social').fill('DEMO COMERCIAL, S.A.')
    await dialogo.getByLabel('Nombre comercial').fill('Demo pruebas')
    await page.getByRole('button', { name: 'Crear empresa', exact: true }).click()
    await expect(page.getByText('Empresa creada', { exact: true })).toBeVisible()
})
