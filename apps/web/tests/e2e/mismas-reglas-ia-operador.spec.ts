import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * «Mismas reglas para IA y operador» en la plantilla (`reglas_promesa.mismas_reglas_ia_operador`,
 * A3), en modo fixtures, a 1280 y 390 px: la casilla apagada por defecto, al ponerla los campos de
 * IA se atenúan y se explica que no se aplican, y al guardar la lista la marca y la edición la trae
 * con los valores de IA conservados. Capturas (claro y oscuro) en
 * `test-results/capturas-mismas-reglas/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(200)
        await page.screenshot({ path: `test-results/capturas-mismas-reglas/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

/** Sin desborde horizontal de la página (390 px). */
async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('plantilla: «Mismas reglas para IA y operador» atenúa IA, se guarda y conserva sus valores', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/plantillas')
    const tabla = page.locator('[data-prueba="tabla-plantillas"]')
    const fila = tabla.locator('tr').filter({ has: page.locator('[data-plantilla="1"]') })
    await expect(fila).toContainText('Mensual día 1')
    await expect(fila.locator('[data-prueba="plantilla-mismas-reglas"]')).toHaveCount(0)

    await page.locator('[data-prueba="editar-plantilla-1"]').click()
    const panel = page.getByRole('dialog', { name: 'Editar Mensual día 1' })
    const casilla = panel.getByRole('checkbox', { name: 'Mismas reglas para IA y operador' })
    await expect(casilla).not.toBeChecked()
    await expect(panel.getByText('El asistente de IA usará los mismos límites que una persona (operador).')).toBeVisible()
    const ia = panel.locator('[data-prueba="plantilla-canal-ia"]')
    await expect(ia.locator('[data-prueba="plantilla-canal-ia-ignorado"]')).toHaveCount(0)
    await expect(campo(ia, 'plantilla-canal-ia-plazo')).toBeEnabled()
    await expect(campo(ia, 'plantilla-canal-ia-plazo')).toHaveValue('3')

    await casilla.click()
    await expect(casilla).toBeChecked()
    await expect(ia).toHaveAttribute('data-ignorado', 'si')
    await expect(ia.locator('[data-prueba="plantilla-canal-ia-ignorado"]')).toContainText('no se aplican')
    await expect(campo(ia, 'plantilla-canal-ia-plazo')).toBeDisabled()
    await expect(campo(ia, 'plantilla-canal-ia-plazo')).toHaveValue('3')
    await expect(campo(panel.locator('[data-prueba="plantilla-canal-operador"]'), 'plantilla-canal-operador-plazo')).toBeEnabled()
    await ia.scrollIntoViewIfNeeded()
    await sinDesborde(page)
    await capturar(page, 'formulario')

    await panel.locator('[data-prueba="plantilla-guardar"]').click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('Mensual día 1 actualizada', { exact: true })).toBeVisible()
    await expect(fila.locator('[data-prueba="plantilla-mismas-reglas"]').filter({ visible: true })).toHaveText('IA: mismas reglas que operador')
    await sinDesborde(page)
    await capturar(page, 'lista')

    // La edición trae la opción puesta y los valores de IA conservados; quitarla los vuelve a aplicar.
    await page.locator('[data-prueba="editar-plantilla-1"]').click()
    const edicion = page.getByRole('dialog', { name: 'Editar Mensual día 1' })
    const otra = edicion.getByRole('checkbox', { name: 'Mismas reglas para IA y operador' })
    await expect(otra).toBeChecked()
    const iaEdicion = edicion.locator('[data-prueba="plantilla-canal-ia"]')
    await expect(campo(iaEdicion, 'plantilla-canal-ia-plazo')).toHaveValue('3')
    await otra.click()
    await expect(iaEdicion.locator('[data-prueba="plantilla-canal-ia-ignorado"]')).toHaveCount(0)
    await expect(campo(iaEdicion, 'plantilla-canal-ia-plazo')).toBeEnabled()
})
