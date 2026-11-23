import { expect, test } from '@playwright/test'
import { elegirClienteCobro, ir } from './ayudas'

/**
 * Prueba obligatoria 3 del brief de A4: "Registrar pago y ver el servicio reactivarse".
 *
 * Con fixtures: Juan Carlos Ramírez (cliente 2) tiene su servicio `juan.carlos2` suspendido y
 * debe Q 300.00 vencidos. El cajero lo cobra en el cobro POS (tablero NuevoCobro): Pago completo,
 * efectivo, recibe Q 500.00 y ve el cambio. `POST /pagos` evalúa el servicio en la misma
 * transacción y lo devuelve en `Pago.servicios[]`: la ventana «¡Cobro listo!» dice que se
 * reactivó, sin recargar ni sondear.
 */
test('registrar pago y ver el servicio reactivarse', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Correo').fill('cajero@argos.test')
    await page.getByLabel('Contraseña').fill('cajero12345')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).not.toHaveURL(/\/login/)

    // Navegación dentro de la SPA (los fixtures viven en memoria y un page.goto los reiniciaría).
    await ir(page, 'Cobrar', /\/cobro/)
    const cobrar = await elegirClienteCobro(page, 'Juan Carlos', /Juan Carlos Ramírez/)

    await expect(page.locator('[data-prueba="pendiente"]')).toHaveText('Q 300.00')
    await expect(page.locator('[data-servicio="2"]').first()).toContainText('Suspendido')
    await expect(page.locator('[data-prueba="a-cobrar"]')).toHaveText('Q 300.00')

    // «Recibido» destacado y el cambio justo debajo.
    await page.getByRole('button', { name: 'Q 500', exact: true }).click()
    await expect(page.locator('[data-prueba="cambio"]')).toHaveText('Cambio a entregar: Q 200.00')
    await expect(cobrar).toHaveText('Cobrar Q 300.00')
    await cobrar.click()

    const listo = page.locator('[data-prueba="cobro-listo"]')
    await expect(listo).toContainText('¡Cobro listo!')
    await expect(listo).toContainText('Q 300.00')
    await expect(listo.locator('[data-prueba="cambio-entregar"]')).toContainText('Q 200.00')
    // Sale en la respuesta del pago: no hay que esperar al sondeo de respaldo (3 s).
    await expect(listo).toContainText('se reactivó', { timeout: 2_000 })

    const recibo = page.locator('article[aria-label="Recibo de pago"]')
    await expect(recibo).toContainText('Juan Carlos Ramírez')
    await expect(recibo).toContainText('Efectivo en caja')
    await expect(recibo).toContainText('Caja Central')
    await expect(recibo).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2} \(hora de Guatemala\)/)
    await expect(recibo).toContainText('Servicio juan.carlos2 reactivado')

    // La ficha del servicio también lo ve activo.
    await listo.getByRole('link').first().click()
    await expect(page).toHaveURL(/\/servicios\/2$/)
    const encabezado = page.locator('[data-prueba="franja-servicio"]')
    await expect(encabezado).toBeVisible()
    await expect(encabezado).toContainText('Activo')
    await expect(encabezado).not.toContainText('Suspendido')
})
