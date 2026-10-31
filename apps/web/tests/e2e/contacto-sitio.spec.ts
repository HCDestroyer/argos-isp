import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Pedidos de Iris A12–A14 (contrato 0.5.0): alta de un cliente con referencia («cómo llegar») y de
 * su servicio con contacto en sitio, con el teléfono validado en el formulario. Corre en escritorio
 * (1280 px) y en teléfono (390 px).
 */
test('alta de cliente con referencia y de su servicio con contacto en sitio', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)

    await page.getByRole('button', { name: 'Nuevo cliente' }).click()
    const altaCliente = page.getByRole('dialog', { name: 'Nuevo cliente' })
    await expect(altaCliente).toBeVisible()
    await altaCliente.getByLabel('Nombre', { exact: true }).fill('Julia Referencia Pruebas')
    await altaCliente.getByLabel('Referencia', { exact: true }).fill('Casa verde frente a la iglesia')

    // Un teléfono que no cumple se marca en su campo, con ejemplo, y no se envía.
    const telefono = altaCliente.getByLabel('Teléfono', { exact: true })
    await telefono.fill('1234')
    await altaCliente.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(altaCliente.getByText(/Teléfono de Guatemala de 8 dígitos/)).toBeVisible()
    await expect(altaCliente).toBeVisible()

    await telefono.fill('5512 3344')
    await altaCliente.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Julia Referencia Pruebas' }).first()).toBeVisible()
    await expect(page.locator('[data-prueba="referencia-cliente"]')).toContainText('Casa verde frente a la iglesia')
    await expect(page.getByText('+502 5512-3344')).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(alta).toBeVisible()
    await page.getByRole('radio', { name: /RB-Centro(?! PCQ)/ }).click()
    await page.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    // Conexión → Red y PPPoE → Instalación y cobro.
    for (let i = 0; i < 2; i++) {
        await alta.getByRole('button', { name: 'Siguiente' }).click()
    }

    const ubicacion = alta.locator('[data-prueba="alta-ubicacion-contacto"]')
    await expect(ubicacion.getByRole('heading', { name: 'Ubicación y contacto en sitio' })).toBeVisible()
    // La referencia del cliente se propone para el servicio.
    await expect(ubicacion.getByLabel('Referencia', { exact: true })).toHaveValue('Casa verde frente a la iglesia')
    await ubicacion.getByLabel('Contacto en sitio', { exact: true }).fill('Don Julio')
    const telefonoContacto = ubicacion.getByLabel('Teléfono del contacto', { exact: true })
    await telefonoContacto.fill('99')
    await alta.getByRole('button', { name: 'Siguiente' }).click()
    await expect(ubicacion.getByText(/Teléfono de Guatemala de 8 dígitos/)).toBeVisible()

    await telefonoContacto.fill('7712 3344')
    await alta.getByRole('button', { name: 'Siguiente' }).click()
    await expect(alta.locator('[data-prueba="resumen-contacto"]')).toContainText('Don Julio · 7712 3344')
    await alta.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(alta).toBeHidden()
    const servicio = page.getByRole('link', { name: /^julia\./ })
    await expect(servicio).toBeVisible()
    await servicio.click()
    // Con el servidor de desarrollo, la primera visita a la ficha la compila (varios segundos).
    await expect(page).toHaveURL(/\/servicios\/\d+$/, { timeout: 20_000 })
    const tarjeta = page.locator('[data-prueba="ubicacion-contacto-servicio"]')
    await expect(tarjeta).toContainText('Ubicación y contacto en sitio')
    await expect(tarjeta.locator('[data-prueba="referencia-servicio"]')).toContainText('Casa verde frente a la iglesia')
    await expect(tarjeta.locator('[data-prueba="contacto-servicio"]')).toContainText('Don Julio')
    await expect(tarjeta.getByRole('link', { name: '+502 7712-3344' })).toHaveAttribute('href', 'tel:+50277123344')
})
