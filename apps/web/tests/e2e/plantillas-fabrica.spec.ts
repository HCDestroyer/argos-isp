import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Plantillas de fábrica (decisión del PM, 18 nov), en escritorio (1280 px) y teléfono (390 px), claro
 * y oscuro: «Marcar como por defecto» para «Genera 1 · vence 15» y «Asignar a servicios sin
 * plantilla» con su vista previa, sin cobrar nada atrasado.
 */

/** La página no se desborda a lo ancho (ni el diálogo). */
async function sinDesborde(page: Page): Promise<void> {
    const anchos = await page.evaluate(() => ({ documento: document.documentElement.scrollWidth, ventana: window.innerWidth }))
    expect(anchos.documento).toBeLessThanOrEqual(anchos.ventana + 1)
}

test('marcar «Genera 1 · vence 15» por defecto y asignarla a los servicios sin plantilla', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/plantillas')

    const tabla = page.locator('[data-prueba="tabla-plantillas"]')
    await expect(tabla.locator('[data-plantilla="3"]')).toContainText('Genera 1 · vence 15', { timeout: 30_000 })
    await expect(tabla.locator('[data-plantilla="4"]')).toContainText('Genera 14 · vence 29')
    await expect(tabla.locator('[data-plantilla="5"]')).toContainText('Genera 1 · vence 5')

    // Otra es la de por defecto: el aviso ofrece marcar la de fábrica.
    const aviso = page.locator('[data-prueba="marcar-por-defecto"]')
    await expect(aviso).toContainText('Genera 1 · vence 15 no es la plantilla por defecto')
    await sinDesborde(page)
    await aviso.getByRole('button', { name: 'Marcar como por defecto' }).click()
    await expect(page.getByText('Genera 1 · vence 15 es la plantilla por defecto', { exact: true })).toBeVisible()
    await expect(aviso).toBeHidden()
    await expect(tabla.locator('[data-plantilla="3"] [data-prueba="plantilla-defecto"]')).toBeVisible()
    await expect(tabla.locator('[data-plantilla="1"] [data-prueba="plantilla-defecto"]')).toHaveCount(0)

    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.locator('[data-prueba="asignar-sin-plantilla"]').click()
        const dialogo = page.getByRole('dialog', { name: 'Asignar Genera 1 · vence 15 a servicios sin plantilla' })
        await expect(dialogo.locator('[data-prueba="sin-plantilla-total"]')).toHaveText('5 servicios sin plantilla')
        await expect(dialogo.locator('[data-prueba="sin-plantilla-desde"]')).toContainText(/Se cobra desde el \d{2}\/\d{2}\/\d{4}; no se cobra nada atrasado/)
        await expect(dialogo.locator('[data-prueba="sin-plantilla-muestra"] [data-servicio]')).toHaveCount(5)
        await sinDesborde(page)
        if (tema === 'light') {
            await dialogo.getByRole('button', { name: 'Cancelar' }).click()
            await expect(dialogo).toBeHidden()
        }
        else {
            await dialogo.locator('[data-prueba="asignar-sin-plantilla-confirmar"]').click()
            await expect(dialogo).toBeHidden()
            await expect(page.getByText('5 servicios asignados', { exact: true })).toBeVisible()
        }
    }

    // Ya no queda ninguno: el diálogo lo dice y no ofrece confirmar.
    await page.locator('[data-prueba="asignar-sin-plantilla"]').click()
    const vacio = page.getByRole('dialog', { name: /a servicios sin plantilla/ })
    await expect(vacio.locator('[data-prueba="sin-plantilla-vacio"]')).toContainText('No hay servicios sin plantilla')
    await expect(vacio.locator('[data-prueba="asignar-sin-plantilla-confirmar"]')).toHaveCount(0)
    await page.emulateMedia({ colorScheme: 'light' })
})
