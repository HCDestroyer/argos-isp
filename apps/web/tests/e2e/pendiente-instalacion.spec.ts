import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Servicio pendiente de instalación (`contratos/instalacion.md`, pedido A1 de Iris): el
 * administrador da de alta un servicio que nace «Pendiente de instalación», la ficha no ofrece
 * suspender ni promesa, y «Activar instalación» con datos de planta lo deja activo con su fecha.
 */
test('alta pendiente de instalación y activación con planta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)

    await page.getByRole('link', { name: 'Nuevo cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/nuevo/)
    await page.getByLabel('Nombre', { exact: true }).fill('Ramiro Instalación Pendiente')
    await page.getByLabel('Teléfono').fill('5555-4321')
    await page.getByRole('button', { name: 'Crear cliente' }).click()
    await expect(page).toHaveURL(/\/clientes\/\d+$/)

    await page.getByRole('link', { name: 'Nuevo servicio' }).first().click()
    await expect(page).toHaveURL(/\/servicios\/nuevo\?cliente=\d+/)
    await page.getByRole('radio', { name: /RB-Centro(?! PCQ)/ }).click()
    await page.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    for (let i = 0; i < 4; i++) {
        await page.getByRole('button', { name: 'Siguiente' }).click()
    }
    // Paso «Facturación»: nace pendiente de instalación.
    await page.getByRole('switch', { name: 'Pendiente de instalación' }).click()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.locator('[data-prueba="resumen-estado-inicial"]')).toContainText('Pendiente de instalación')
    await page.getByRole('button', { name: 'Crear servicio' }).click()

    await expect(page).toHaveURL(/\/clientes\/\d+\?tab=servicios/)
    const enlace = page.getByRole('link', { name: /^ramiro\./ })
    await expect(enlace).toBeVisible()
    await enlace.click()
    await expect(page).toHaveURL(/\/servicios\/\d+$/)

    const encabezado = page.getByRole('heading', { level: 2, name: /^ramiro\./ })
    await expect(encabezado.locator('..')).toContainText('Pendiente de instalación')
    await expect(page.locator('[data-prueba="aviso-pendiente-instalacion"]')).toBeVisible()
    const acciones = page.getByRole('group', { name: 'Acciones del servicio' })
    await expect(acciones.getByRole('button', { name: 'Retirar' })).toBeVisible()
    await expect(acciones.getByRole('button', { name: 'Suspender' })).toHaveCount(0)
    await expect(acciones.getByRole('button', { name: 'Promesa de pago' })).toHaveCount(0)

    await acciones.getByRole('button', { name: 'Activar instalación' }).click()
    const modal = page.getByRole('dialog', { name: 'Activar instalación' })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Datos de planta (opcional)' }).click()
    await modal.getByLabel('Caja (NAP)').fill('NAP-21')
    await modal.getByLabel('Potencia óptica').fill('-19.4')
    await modal.getByRole('button', { name: 'Activar instalación' }).click()

    await expect(modal).toBeHidden()
    await expect(encabezado.locator('..')).toContainText('Activo')
    await expect(page.locator('[data-prueba="aviso-pendiente-instalacion"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="planta-servicio"]')).toContainText('NAP-21')
    await expect(page.locator('[data-prueba="planta-servicio"]')).toContainText('-19.40 dBm')
    await expect(page.locator('[data-prueba="instalado-en-servicio"]')).not.toContainText('Pendiente')
    await expect(acciones.getByRole('button', { name: 'Suspender' })).toBeVisible()
})
