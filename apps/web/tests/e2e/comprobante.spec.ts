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
    await expect(enlace).toContainText('4')
    await enlace.click()
    await expect(page).toHaveURL(/\/comprobantes$/)

    // Decisión 13: lista, foto y decisión en una sola pantalla (en el teléfono, la del comprobante).
    await page.getByRole('link', { name: /^Comprobante #2 / }).click()
    const revision = page.locator('[data-prueba="revision-comprobante"]:visible')
    await expect(revision.locator('[data-prueba="comprobante-imagen"]')).toBeVisible()
    await expect(revision.getByText('40022931')).toBeVisible()
    await expect(revision.locator('[data-factura="209"]')).toBeVisible()
    await expect(revision.getByRole('list', { name: 'Cómo se aplicará el pago' })).toContainText('Aviso #210')

    await revision.locator('[data-prueba="aprobar-comprobante"]').click()

    // Decisión 13: al aprobar la pantalla pasa al siguiente por revisar; el servicio reactivado
    // (de `pago.servicios[]`, sin sondear) se dice en el aviso.
    const aviso = page.locator('li').filter({ hasText: 'Comprobante aprobado' }).first()
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Servicio 2: Suspendido → Activo', { timeout: 2_000 })
})
