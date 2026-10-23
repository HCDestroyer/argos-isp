import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Comparador de regímenes (A3, fase 8 PR B) en modo fixtures, en escritorio y teléfono. Hoy es el
 * 15/10/2026 (meses leídos: octubre 2025 a septiembre 2026). ArgosNet: el régimen opcional pagaría
 * Q3,099.46 menos (m = 29.80 %, m* = 20.00 %). Fibra del Sur: sobre utilidades pagaría menos.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('aviso, tabla con m y m*, sin aplicar; el crecimiento recalcula la proyección y se valida', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Comparador de regímenes', /\/fiscal\/comparador/)
    await elegirEmpresa(page, /ArgosNet/)

    await expect(page.locator('[data-prueba="comparador-aviso"]')).toContainText('no cambia el régimen')
    const argos = page.locator('[data-empresa="1"]')
    await expect(argos.locator('[data-regimen="opcional_simplificado"]')).toContainText('Paga menos')
    await expect(argos.locator('[data-prueba="margen-m"]')).toHaveText('29.80 %')
    await expect(argos.locator('[data-prueba="margen-equilibrio"]')).toHaveText('20.00 %')
    await expect(argos.locator('[data-prueba="comparador-menor"]')).toContainText('3,099.46')
    await expect(page.getByRole('button', { name: /aplicar/i })).toHaveCount(0)
    await expect(argos.locator('[data-matiz="art46_plano"]')).toContainText('Confirmar con contador')
    await expect(argos.locator('[data-prueba="proyeccion-crecimiento"]')).toContainText('la tendencia de los meses leídos')

    // Crecimiento propio: recalcula la proyección y queda en la URL.
    const campo = page.locator('[data-prueba="campo-crecimiento"]').locator('visible=true').first()
    await campo.fill('2.5')
    await page.getByRole('button', { name: 'Recalcular proyección' }).click()
    await expect(argos.locator('[data-prueba="proyeccion-crecimiento"]')).toContainText('2.50 % mensual (el que escribiste)')
    await expect(page).toHaveURL(/crecimiento=2\.5/)

    // −100 no pasa: error en el campo y la simulación anterior sigue.
    await campo.fill('-100')
    await page.getByRole('button', { name: 'Recalcular proyección' }).click()
    await expect(page.locator('[data-prueba="form-crecimiento"]')).toContainText('Debe ser mayor que −100 %')
    await expect(argos.locator('[data-prueba="proyeccion-crecimiento"]')).toContainText('2.50 % mensual')

    await page.getByRole('button', { name: 'Usar tendencia' }).click()
    await expect(argos.locator('[data-prueba="proyeccion-crecimiento"]')).toContainText('la tendencia de los meses leídos')

    // El cambio de régimen está en Configuración → Fiscal.
    await argos.locator('[data-prueba="comparador-sin-aplicar"]').getByRole('link', { name: 'Ir a la configuración fiscal' }).click()
    await expect(page).toHaveURL(/\/configuracion\/fiscal/)
})

test('«Todas»: una sección por empresa; Fibra del Sur pagaría menos sobre utilidades', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Comparador de regímenes', /\/fiscal\/comparador/)
    await elegirEmpresa(page, /Todas/)
    await expect(page.locator('[data-empresa]')).toHaveCount(2)
    const fibra = page.locator('[data-empresa="2"]')
    await expect(fibra.locator('[data-regimen="utilidades"]')).toContainText('Paga menos')
    await expect(fibra.locator('[data-prueba="comparador-regimen"]')).toContainText('Pequeño contribuyente')
    await expect(page.getByText('una sección por empresa, sin totales consolidados')).toBeVisible()
})

test('el cajero no ve el comparador', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Comparador de regímenes', exact: true })).toHaveCount(0)
})
