import { expect, test } from '@playwright/test'

/**
 * Prueba obligatoria 3 del brief de A4: "Registrar pago y ver el servicio reactivarse".
 *
 * Con fixtures: Juan Carlos Ramírez (cliente 2) tiene su servicio `juan.carlos2` suspendido y
 * debe Q 300.00 vencidos. El cajero lo cobra en `/cobro` y recibe el recibo. `POST /pagos`
 * evalúa el servicio en la misma transacción y lo devuelve en `Pago.servicios[]`, así que el
 * panel muestra "Servicio reactivado" de inmediato, sin recargar ni sondear.
 */
test('registrar pago y ver el servicio reactivarse', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Correo').fill('cajero@argos.test')
    await page.getByLabel('Contraseña').fill('cajero12345')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).not.toHaveURL(/\/login/)

    // Navegación dentro de la SPA: los fixtures viven en memoria y un page.goto los reiniciaría.
    // "Cobrar" está en el menú lateral (escritorio) y en la tarjeta de inicio (teléfono, donde
    // el menú va plegado).
    const menu = page.locator('#dashboard-sidebar-principal').getByRole('link', { name: 'Cobrar' })
    if (await menu.isVisible()) {
        await menu.click()
    }
    else {
        // El enlace de la tarjeta cubre toda la tarjeta con un span transparente.
        await page.getByText('Cobro rápido: buscar cliente').click({ force: true })
    }
    await expect(page).toHaveURL(/\/cobro/)

    await page.getByPlaceholder('Buscar cliente…').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).click()

    const servicio = page.locator('[data-servicio="2"]')
    await expect(servicio).toContainText('juan.carlos2')
    await expect(servicio).toContainText('Suspendido')
    await expect(page.locator('[data-prueba="vencido"]')).toHaveText('Q 300.00')

    const monto = page.getByLabel('Monto')
    await expect(monto).toHaveValue('300.00')
    await monto.press('Enter')

    const recibo = page.getByRole('article', { name: 'Recibo de pago' })
    await expect(recibo).toBeVisible()
    await expect(recibo).toContainText('Juan Carlos Ramírez')
    await expect(recibo).toContainText('Efectivo en caja')
    await expect(recibo).toContainText('Caja Central')
    await expect(recibo).toContainText('Q 300.00')
    await expect(recibo).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \(hora de Guatemala\)/)
    await expect(recibo).toContainText('Servicio juan.carlos2 reactivado')
    await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible()

    await expect(page.locator('[data-prueba="vencido"]')).toHaveText('Q 0.00')

    // Sale en la respuesta del pago: no hay que esperar al sondeo de respaldo (3 s).
    await expect(servicio).toContainText('Servicio reactivado', { timeout: 2_000 })
    await expect(servicio).toContainText('Activo')
    await expect(servicio).not.toContainText('Suspendido')

    // La ficha del servicio también lo ve activo.
    await servicio.getByRole('link', { name: 'juan.carlos2' }).click()
    await expect(page).toHaveURL(/\/servicios\/2$/)
    const encabezado = page.getByRole('heading', { level: 2, name: 'juan.carlos2' })
    await expect(encabezado).toBeVisible()
    await expect(encabezado.locator('..')).toContainText('Activo')
    await expect(encabezado.locator('..')).not.toContainText('Suspendido')
})
