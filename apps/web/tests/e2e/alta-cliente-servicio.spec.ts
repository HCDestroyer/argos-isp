import { expect, test } from '@playwright/test'
import { accionCliente, elegirRouter, entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 2 del brief de A4: "Alta de cliente y servicio". Con fixtures: el
 * administrador crea un cliente, desde su ficha abre "Nuevo servicio", elige router y plan,
 * deja la IPv4 automática y las credenciales generadas, y el servicio aparece activo.
 */
test('alta de cliente y de su servicio', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)

    // Desde el rediseño el alta de cliente es una página propia (formulario largo).
    await page.getByRole('link', { name: 'Nuevo cliente' }).first().click()
    await expect(page).toHaveURL(/\/clientes\/nuevo$/)
    const altaCliente = page.locator('#dashboard-panel-cliente-nuevo')
    await expect(altaCliente.getByRole('button', { name: 'Crear cliente' })).toBeVisible()
    await page.getByLabel('Nombre', { exact: true }).fill('Lucía Fernanda Pruebas')
    await page.getByLabel('Teléfono').fill('5555-1234')
    await page.getByRole('button', { name: 'Crear cliente' }).click()

    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Lucía Fernanda Pruebas' }).first()).toBeVisible()

    // El alta del servicio se abre en un panel lateral de la ficha: no se sale del cliente.
    await accionCliente(page, 'Nuevo servicio')
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(alta).toBeVisible()

    await elegirRouter(page, 'RB-Centro')
    await page.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    // IPv4 automática, IPv6 recomendada, credenciales generadas y plantilla: se aceptan tal cual.
    // Conexión → Red y PPPoE → Instalación y cobro → Resumen.
    for (let i = 0; i < 3; i++) {
        await alta.getByRole('button', { name: 'Siguiente' }).click()
    }
    await expect(alta.locator('[data-prueba="resumen-alta"]')).toContainText('RB-Centro')
    await page.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(alta).toBeHidden()
    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)
    const servicio = page.getByRole('link', { name: /^lucia\./ })
    await expect(servicio).toBeVisible()
    await servicio.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)
    const encabezado = page.locator('[data-prueba="franja-servicio"]')
    await expect(encabezado).toContainText('Activo')
})
