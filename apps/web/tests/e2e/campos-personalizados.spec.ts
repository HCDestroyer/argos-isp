import { expect, test, type Locator } from '@playwright/test'
import { entrar, ir, menu } from './ayudas'

/**
 * Catálogo de campos personalizados (solo admin) y contacto de los routers (modo fixtures,
 * escritorio y teléfono).
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('admin: crear un campo de lista, editarlo y desactivarlo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/campos-personalizados')
    const tabla = page.locator('[data-prueba="tabla-campos"]')
    await expect(tabla).toContainText('Referencia de la casa', { timeout: 15_000 })

    await page.locator('[data-prueba="nuevo-campo"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo campo personalizado' })
    await campo(alta, 'campo-etiqueta').fill('Tipo de vivienda')
    await expect(campo(alta, 'campo-clave')).toHaveValue('tipo_de_vivienda')
    await alta.locator('[data-prueba="campo-tipo"]').click()
    await page.getByRole('option', { name: /Lista de opciones/ }).click()
    const opciones = campo(alta, 'campo-opciones')
    await opciones.fill('Casa')
    await opciones.press('Enter')
    await opciones.fill('Apartamento')
    await opciones.press('Enter')
    await alta.locator('[data-prueba="campo-guardar"]').click()
    await expect(alta).toBeHidden()
    const fila = tabla.locator('tr').filter({ hasText: 'Tipo de vivienda' })
    await expect(fila).toContainText('tipo_de_vivienda')
    await expect(fila).toContainText('Casa')

    await fila.getByRole('button', { name: 'Editar el campo Tipo de vivienda' }).click()
    const edicion = page.getByRole('dialog', { name: 'Editar Tipo de vivienda' })
    await expect(campo(edicion, 'campo-clave')).toBeDisabled()
    await edicion.locator('[data-prueba="campo-requerido"]').click()
    await edicion.locator('[data-prueba="campo-guardar"]').click()
    await expect(edicion).toBeHidden()
    await expect(fila).toContainText('Obligatorio')

    await fila.getByRole('button', { name: 'Desactivar el campo Tipo de vivienda' }).click()
    const confirmar = page.getByRole('dialog', { name: 'Desactivar campo' })
    await confirmar.getByRole('button', { name: 'Desactivar' }).click()
    await expect(page.locator('[data-prueba="estado-campo-tipo_de_vivienda"]')).toHaveText('Inactivo')
    await expect(fila.getByRole('button', { name: 'Activar el campo Tipo de vivienda' })).toBeVisible()
})

test('cajero no ve el catálogo de campos personalizados', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const lateral = await menu(page)
    await expect(lateral.getByRole('link', { name: 'Campos personalizados' })).toHaveCount(0)
    await page.goto('/campos-personalizados')
    await expect(page).toHaveURL(/\/sin-permiso/)
})

test('routers: estado en línea desconocido y último contacto en la lista y la ficha', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await expect(page.locator('[data-prueba="en-linea-1"]:visible').first()).toHaveText('Desconocido', { timeout: 15_000 })
    await expect(page.locator('[data-prueba="ultimo-contacto-1"]:visible').first()).toHaveText('Nunca respondió')
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro' }).click()
    await expect(page).toHaveURL(/\/routers\/1$/)
    await expect(page.locator('[data-prueba="en-linea-1"]')).toHaveText('Desconocido')
    await expect(page.getByText('Nunca respondió')).toBeVisible()
})
