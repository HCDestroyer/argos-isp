import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 2 del brief de A4: "Alta de cliente y servicio". Con fixtures: el
 * administrador crea un cliente, desde su ficha abre "Nuevo servicio", elige router y plan,
 * deja la IPv4 automática y las credenciales generadas, y el servicio aparece activo.
 */
test('alta de cliente y de su servicio', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)

    await page.getByRole('link', { name: 'Nuevo cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/nuevo/)
    await page.getByLabel('Nombre', { exact: true }).fill('Lucía Fernanda Pruebas')
    await page.getByLabel('Teléfono').fill('5555-1234')
    await page.getByRole('button', { name: 'Crear cliente' }).click()

    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Lucía Fernanda Pruebas' }).first()).toBeVisible()

    await page.getByRole('link', { name: 'Nuevo servicio' }).first().click()
    await expect(page).toHaveURL(/\/servicios\/nuevo\?cliente=\d+/)

    await page.getByRole('radio', { name: /RB-Centro/ }).click()
    await page.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    // IPv4 automática, IPv6 por defecto, credenciales generadas y plantilla: se aceptan tal cual.
    for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Siguiente' }).click()
    }
    await page.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)
    const servicio = page.getByRole('link', { name: /^lucia\./ })
    await expect(servicio).toBeVisible()
    await servicio.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)
    const encabezado = page.getByRole('heading', { level: 2, name: /^lucia\./ })
    await expect(encabezado.locator('..')).toContainText('Activo')
})
