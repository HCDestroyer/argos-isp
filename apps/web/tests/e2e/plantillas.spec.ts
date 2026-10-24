import { expect, test, type Locator } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Plantillas de facturación (tarea 8): crear una con reglas de promesas por canal, verla en la lista
 * y editarla; los errores de coherencia se ven junto al campo antes de enviar.
 */

/** El `<input>` de un campo de Nuxt UI, lleve el atributo el envoltorio o el propio input. */
function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('crear y editar una plantilla con reglas de promesas por canal', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // El menú lleva a la sección; se entra por URL para no depender de la primera compilación de `nuxt dev`.
    await expect((await menu(page)).getByRole('link', { name: 'Plantillas', exact: true })).toBeVisible()
    await page.goto('/plantillas')

    const tabla = page.locator('[data-prueba="tabla-plantillas"]')
    await expect(tabla.locator('[data-plantilla="1"]')).toContainText('Mensual día 1')
    await expect(tabla.locator('[data-plantilla="1"] [data-prueba="plantilla-defecto"]')).toBeVisible()

    await page.locator('[data-prueba="nueva-plantilla"]').click()
    const panel = page.getByRole('dialog', { name: 'Nueva plantilla de facturación' })
    await campo(panel, 'plantilla-nombre').fill('Mensual día 15')
    await campo(panel, 'plantilla-dia').fill('15')
    await campo(panel, 'plantilla-limitar').fill('3')
    await campo(panel, 'plantilla-cortar').fill('2')
    await campo(panel, 'plantilla-cortar').blur()

    // Limitar con más facturas que cortar: el esquema espejo lo marca antes de enviar.
    await panel.locator('[data-prueba="plantilla-guardar"]').click()
    await expect(panel.getByText('No puede ser mayor que las facturas para cortar')).toBeVisible()
    await campo(panel, 'plantilla-limitar').fill('1')

    await panel.locator('[data-prueba="plantilla-mora-tipo"]').click()
    await page.getByRole('option', { name: 'Monto fijo' }).click()
    await campo(panel, 'plantilla-mora-valor').fill('30')

    const portal = panel.locator('[data-prueba="plantilla-canal-portal"]')
    await portal.getByRole('switch', { name: /Requiere aprobación/ }).click()
    await campo(portal, 'plantilla-canal-portal-plazo').fill('2')

    await panel.locator('[data-prueba="plantilla-guardar"]').click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('Mensual día 15 creada', { exact: true })).toBeVisible()
    const nueva = tabla.locator('[data-plantilla]').filter({ hasText: 'Mensual día 15' })
    await expect(nueva).toContainText('Día 15 de cada mes')

    // Editar: el formulario trae lo guardado, incluido el canal.
    const id = await nueva.getAttribute('data-plantilla')
    await page.locator(`[data-prueba="editar-plantilla-${id}"]`).click()
    const edicion = page.getByRole('dialog', { name: 'Editar Mensual día 15' })
    await expect(campo(edicion, 'plantilla-canal-portal-plazo')).toHaveValue('2')
    await expect(campo(edicion, 'plantilla-mora-valor')).toHaveValue('30.00')
    await campo(edicion, 'plantilla-plazo').fill('7')
    await edicion.locator('[data-prueba="plantilla-guardar"]').click()
    await expect(edicion).toBeHidden()
    await expect(page.getByText('Mensual día 15 actualizada', { exact: true })).toBeVisible()
    await expect(tabla.locator('tr').filter({ hasText: 'Mensual día 15' })).toContainText('7 días')
})
