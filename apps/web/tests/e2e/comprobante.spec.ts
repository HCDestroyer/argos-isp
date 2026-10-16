import { expect, test } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Criterio del plan (semana 2): "comprobante subido desde el portal, aprobado en el panel,
 * reactiva". Con fixtures, Juan Carlos Ramírez (servicio 2, suspendido) subió una boleta de
 * Q 300.00. El cajero la ve en la cola, compara la foto con los datos y la aprueba: la respuesta
 * trae `pago.servicios[]` y el panel muestra el servicio reactivado sin sondear.
 */
test('aprobar un comprobante del portal reactiva el servicio', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')

    const contenedor = await menu(page)
    const enlace = contenedor.getByRole('link', { name: /^Comprobantes/ })
    await expect(enlace).toContainText('3')
    await enlace.click()
    await expect(page).toHaveURL(/\/comprobantes$/)

    await page.getByRole('link', { name: 'Comprobante #2' }).click()
    await expect(page).toHaveURL(/\/comprobantes\/2$/)
    await expect(page.locator('[data-prueba="comprobante-imagen"]')).toBeVisible()
    await expect(page.getByText('40022931')).toBeVisible()

    await page.getByRole('button', { name: 'Aprobar', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Aprobar comprobante' })
    await expect(modal.locator('[data-factura="209"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="distribucion-comprobante"]')).toContainText('Aviso #210')
    await modal.getByRole('button', { name: 'Aprobar y registrar pago' }).click()

    await expect(page.locator('[data-prueba="comprobante-aprobado"]')).toBeVisible()
    await expect(page.locator('[data-prueba="servicio-reactivado"]')).toContainText('Suspendido → Activo', { timeout: 2_000 })
    await expect(page.locator('[data-prueba="estado-comprobante"]')).toHaveText('Aprobado')
    await expect(page.getByRole('button', { name: 'Aprobar', exact: true })).toHaveCount(0)
})
