import { expect, test, type Page } from '@playwright/test'
import { elegirClienteCobro, ir } from './ayudas'

/**
 * El comprobante por WhatsApp lo manda Iris (decisión del PM), no el navegador del cajero. La
 * pantalla de éxito del cobro muestra el estado del envío con el canal encendido y, apagado, ningún
 * botón de WhatsApp. En escritorio y teléfono.
 */
async function cobrarJuanCarlos(page: Page) {
    await page.goto('/login')
    await page.getByLabel('Correo').fill('cajero@argos.test')
    await page.getByLabel('Contraseña').fill('cajero12345')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).not.toHaveURL(/\/login/)
}

async function cobrar(page: Page) {
    await ir(page, 'Cobrar', /\/cobro/)
    const boton = await elegirClienteCobro(page, 'Juan Carlos', /Juan Carlos Ramírez/)
    await page.getByRole('button', { name: 'Q 500', exact: true }).click()
    await boton.click()
    await expect(page.locator('[data-prueba="cobro-listo"]')).toContainText('¡Cobro listo!')
}

test('canal WhatsApp apagado: sin botón de WhatsApp en el cobro', async ({ page }) => {
    await cobrarJuanCarlos(page)
    await cobrar(page)
    const listo = page.locator('[data-prueba="cobro-listo"]')
    await expect(listo.locator('[data-prueba="whatsapp-apagado"]')).toBeAttached()
    await expect(listo.locator('[data-prueba="recibo-whatsapp"]')).toHaveCount(0)
    await expect(listo.locator('a[href*="wa.me"]')).toHaveCount(0)
    await expect(listo.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0)
})

test('canal WhatsApp activo: muestra el estado del envío de Iris', async ({ page }) => {
    await cobrarJuanCarlos(page)
    await page.evaluate(() => localStorage.setItem('argos_fixtures_whatsapp_activo', '1'))
    await cobrar(page)
    const listo = page.locator('[data-prueba="cobro-listo"]')
    await expect(listo.locator('[data-prueba="whatsapp-envio"]')).toContainText(/Comprobante (por WhatsApp en cola|enviado por WhatsApp)/)
    await expect(listo.locator('[data-prueba="whatsapp-envio"]')).toContainText('Comprobante enviado por WhatsApp', { timeout: 10_000 })
    await expect(listo.locator('a[href*="wa.me"]')).toHaveCount(0)
})
