import { expect, test } from '@playwright/test'
import { entrar, hayAccionServicio, ir } from './ayudas'

/**
 * Servicio pendiente de instalación (`contratos/instalacion.md`, pedido A1 de Iris): el
 * administrador da de alta un servicio que nace «Pendiente de instalación», la ficha no ofrece
 * suspender ni promesa, y «Activar instalación» con datos de planta lo deja activo con su fecha.
 */
test('alta pendiente de instalación y activación con planta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)

    // Desde el rediseño el alta de cliente es una página propia (formulario largo).
    await page.getByRole('link', { name: 'Nuevo cliente' }).first().click()
    await expect(page).toHaveURL(/\/clientes\/nuevo$/)
    const altaCliente = page.locator('#dashboard-panel-cliente-nuevo')
    await expect(altaCliente.getByRole('button', { name: 'Crear cliente' })).toBeVisible()
    await page.getByLabel('Nombre', { exact: true }).fill('Ramiro Instalación Pendiente')
    await page.getByLabel('Teléfono').fill('5555-4321')
    await page.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/\d+$/)

    // El alta del servicio se abre en un panel lateral de la ficha: no se sale del cliente.
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(alta).toBeVisible()
    await page.getByRole('radio', { name: /RB-Centro(?! PCQ)/ }).click()
    await page.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    for (let i = 0; i < 2; i++) {
        await alta.getByRole('button', { name: 'Siguiente' }).click()
    }
    // Paso «Instalación y cobro»: nace pendiente de instalación.
    await alta.getByRole('switch', { name: 'Pendiente de instalación' }).click()
    await alta.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.locator('[data-prueba="resumen-estado-inicial"]')).toContainText('Pendiente de instalación')
    await page.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(alta).toBeHidden()
    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)
    const enlace = page.getByRole('link', { name: /^ramiro\./ })
    await expect(enlace).toBeVisible()
    await enlace.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)

    const encabezado = page.locator('[data-prueba="franja-servicio"]')
    await expect(encabezado).toContainText('Pendiente de instalación')
    await expect(page.locator('[data-prueba="aviso-pendiente-instalacion"]')).toBeVisible()
    const acciones = page.getByRole('group', { name: 'Acciones del servicio' })
    expect(await hayAccionServicio(page, 'Retirar')).toBe(true)
    expect(await hayAccionServicio(page, 'Suspender')).toBe(false)
    expect(await hayAccionServicio(page, 'Promesa de pago')).toBe(false)

    await acciones.getByRole('button', { name: 'Activar instalación' }).click()
    const modal = page.getByRole('dialog', { name: 'Activar instalación' })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Datos de planta (opcional)' }).click()
    await modal.getByLabel('Caja (NAP)').fill('NAP-21')
    await modal.getByLabel('Potencia óptica').fill('-19.4')
    await modal.getByRole('button', { name: 'Activar instalación' }).click()

    await expect(modal).toBeHidden()
    await expect(encabezado).toContainText('Activo')
    await expect(page.locator('[data-prueba="aviso-pendiente-instalacion"]')).toHaveCount(0)
    await page.locator('[data-prueba="pestanas-servicio"]').getByRole('tab', { name: 'Red y equipo' }).click()
    await expect(page.locator('[data-prueba="planta-servicio"]')).toContainText('NAP-21')
    await expect(page.locator('[data-prueba="planta-servicio"]')).toContainText('-19.40 dBm')
    await expect(page.locator('[data-prueba="instalado-en-servicio"]')).not.toContainText('Pendiente')
    expect(await hayAccionServicio(page, 'Suspender')).toBe(true)
})
