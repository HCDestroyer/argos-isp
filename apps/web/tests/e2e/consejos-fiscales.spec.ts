import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Consejos fiscales en el tablero (A3, fase 8 PR C) en modo fixtures, en escritorio y teléfono. Hoy es el
 * 15/10/2026. ArgosNet: aplican «El otro régimen pagaría menos según la simulación» y «Emita los libros
 * atrasados». Ocultar solo para mí lo quita de la vista y «Ver ocultos» lo devuelve con su marca.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('consejos que aplican con fuente y aviso; ocultar solo para mí, verlos y mostrar', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Tablero fiscal', /\/fiscal\/tablero/)
    await elegirEmpresa(page, /ArgosNet/)

    const consejos = page.locator('[data-consejos="1"]')
    await expect(consejos.locator('[data-consejo]')).toHaveCount(2)
    const simulado = consejos.locator('[data-consejo="regimen_simulado"]')
    await expect(simulado).toContainText('pagaría Q3099.46 menos')
    await expect(simulado).toContainText('Confirmar con contador')
    await expect(simulado).toContainText('Referencia; valídelo con su contador')

    await consejos.locator('[data-consejo="libros_atrasados"] [data-prueba="ocultar-usuario"]').click()
    const dialogo = page.getByRole('dialog', { name: 'Ocultar solo para mí' })
    await dialogo.locator('[data-prueba="motivo-ocultar"]').fill('Ya lo sé')
    await dialogo.getByRole('button', { name: 'Ocultar', exact: true }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByLabel('Notifications (F8)').getByText('Consejo oculto solo para ti')).toBeVisible()
    await expect(consejos.locator('[data-consejo="libros_atrasados"]')).toHaveCount(0)

    await consejos.locator('[data-prueba="ver-ocultos"]').getByRole('switch').click()
    const oculto = consejos.locator('[data-consejo="libros_atrasados"]')
    await expect(oculto.locator('[data-prueba="consejo-oculto"]')).toHaveText('Oculto para ti')
    await oculto.locator('[data-prueba="mostrar-consejo"]').click()
    await expect(oculto.locator('[data-prueba="consejo-oculto"]')).toHaveCount(0)
})

test('bitácora con el texto de ocultar un consejo', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Tablero fiscal', /\/fiscal\/tablero/)
    await elegirEmpresa(page, /ArgosNet/)
    await page.locator('[data-consejos="1"] [data-consejo="regimen_simulado"] [data-prueba="ocultar-empresa"]').click()
    await page.getByRole('dialog', { name: 'Ocultar para la empresa' }).getByRole('button', { name: 'Ocultar', exact: true }).click()
    await expect(page.locator('[data-consejos="1"] [data-consejo="regimen_simulado"]')).toHaveCount(0)
    await ir(page, 'Bitácora', /\/bitacora/)
    await expect(page.getByText('Consejo fiscal ocultado o mostrado').first()).toBeVisible()
})
