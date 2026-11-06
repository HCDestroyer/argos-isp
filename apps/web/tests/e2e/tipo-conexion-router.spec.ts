import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Tipo de conexión por router (`contratos/tipo-conexion-router.md`): en la ficha del router, junto al
 * control de velocidad, «Cambiar tipo» con vista previa (qué cambia, qué falta, qué se completa) y el
 * cambio aplicado servicio por servicio; el alta de servicio muestra el tipo del router en solo
 * lectura. Corre en escritorio (1280 px) y en teléfono (390 px).
 */
test('cambiar el tipo de conexión de un router con vista previa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro', exact: true }).click()
    await expect(page).toHaveURL(/\/routers\/1$/, { timeout: 20_000 })

    const seccion = page.locator('[data-prueba="router-tipo-conexion"]')
    await expect(seccion.locator('[data-prueba="router-tipo-actual"]')).toHaveText('PPPoE')
    await expect(page.locator('[data-prueba="router-velocidad"]')).toBeVisible()

    await seccion.getByRole('button', { name: 'Cambiar tipo' }).click()
    const modal = page.getByRole('dialog', { name: /Cambiar tipo de conexión de RB-Centro/ })
    await expect(modal).toBeVisible()
    await modal.getByRole('radio', { name: /^IP estática/ }).click()
    const lista = modal.locator('[data-prueba="tipo-conexion-servicios"]')
    await expect(lista).toBeVisible()
    await expect(modal.locator('[data-prueba="tipo-conexion-resumen"]')).toContainText('cambian')
    await expect(lista).toContainText('PPPoE')
    await expect(lista).toContainText('IPv6 por RADIUS pasa a «Sin IPv6»')
    await modal.locator('[data-prueba="tipo-conexion-motivo"]').fill('Migración a WISP')
    const aplicar = modal.getByRole('button', { name: 'Cambiar a IP estática' })
    await expect(aplicar).toBeEnabled()
    await aplicar.click()
    await expect(modal).toBeHidden()
    await expect(seccion.locator('[data-prueba="router-tipo-actual"]')).toHaveText('IP estática')

    // Alta de servicio en ese router: el tipo es el del router, sin selector y sin credenciales.
    await ir(page, 'Clientes', /\/clientes$/)
    await page.locator('table a[href^="/clientes/"]').first().click()
    await expect(page).toHaveURL(/\/clientes\/\d+/)
    await page.getByRole('button', { name: 'Nuevo servicio' }).first().click()
    const alta = page.getByRole('dialog', { name: /^Nuevo servicio/ })
    await expect(alta).toBeVisible()
    await alta.getByRole('radio', { name: /RB-Centro(?! PCQ)/ }).click()
    await expect(alta.locator('[data-prueba="tipo-conexion"]')).toContainText('IP estática')
    await expect(alta.getByRole('radio', { name: /^PPPoE/ })).toHaveCount(0)
    await alta.getByRole('radio', { name: /Hogar 10 Mbps/ }).click()
    await alta.getByRole('button', { name: 'Siguiente' }).click()
    await expect(alta.locator('input[name="user_ppp"]')).toHaveCount(0)
})
