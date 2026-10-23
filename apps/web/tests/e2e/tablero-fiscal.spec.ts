import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Tablero fiscal (A3, fase 8 PR A) en modo fixtures, en escritorio y teléfono. Hoy es el jueves
 * 15/10/2026. ArgosNet: ISO en error (`iso_base_periodo` sin confirmar), pequeño contribuyente que no
 * aplica, retenciones de ISR de agosto y septiembre vencidas y libros atrasados. Fibra del Sur: ISR e
 * ISO que no aplican y FEL obligatoria desactivada. Con «Todas», una sección por empresa.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('bloques con error, no aplica, alertas y vencidas; «Reintentar» recarga; enlaces al calendario y a libros', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Tablero fiscal', /\/fiscal\/tablero/)
    await elegirEmpresa(page, /ArgosNet/)

    const argos = page.locator('[data-empresa="1"]')
    await expect(argos.locator('[data-prueba="tablero-regimen"]')).toHaveText('Sobre utilidades')

    // ISO en error: el problema y «Reintentar», ninguna cifra.
    const iso = argos.locator('[data-bloque="iso"]')
    await expect(iso).toHaveAttribute('data-estado', 'error')
    await expect(iso).toContainText('Falta un valor que debe confirmar el contador')
    await expect(iso).not.toContainText(/Q\s?\d/)
    // Pequeño contribuyente: atenuado con su motivo.
    const pc = argos.locator('[data-bloque="pequeno_contribuyente"]')
    await expect(pc).toHaveAttribute('data-estado', 'no_aplica')
    await expect(pc.locator('[data-prueba="bloque-motivo"]')).toHaveText('No aplica al régimen Sobre utilidades')

    // Alertas destacadas y vencidas en rojo.
    await expect(argos.locator('[data-alerta="vencidas"]')).toContainText('2 obligaciones vencidas sin presentar')
    await expect(argos.locator('[data-alerta="libros"]')).toContainText('Q5,000 por libro')
    await expect(argos.locator('[data-obligacion="8"]')).toHaveAttribute('data-vencida', 'si')
    await expect(argos.locator('[data-obligacion="8"]')).toContainText('Venció hace 3 días')
    await expect(argos.locator('[data-bloque="isr"] [data-prueba="isr-con-la-anual"]')).toBeVisible()
    await expect(argos.locator('[data-bloque="isr"]')).toContainText('Confirmar con contador')
    await expect(argos.locator('[data-bloque="facturado"] [data-facturado="mes"]')).toContainText('3,360.00')

    // «Reintentar» del bloque recarga el tablero entero (los fixtures responden en el navegador; que
    // trae los datos nuevos lo comprueba `tests/nuxt/tableroFiscal.test.ts`): el ISO sigue sin confirmar.
    await iso.getByRole('button', { name: 'Reintentar' }).click()
    await expect(iso).toHaveAttribute('data-estado', 'error')
    await expect(iso.getByRole('button', { name: 'Reintentar' })).toBeEnabled()

    // De la vencida al calendario con su detalle.
    await argos.locator('[data-obligacion="8"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/fiscal\/calendario\?obligacion=8/)
    await expect(page.locator('[data-prueba="obligacion-detalle"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-prueba="obligacion-detalle"]')).toHaveCount(0)

    // Del bloque de libros a los libros legales.
    await ir(page, 'Tablero fiscal', /\/fiscal\/tablero/)
    await page.locator('[data-empresa="1"] [data-prueba="tablero-libros"]').click()
    await expect(page).toHaveURL(/\/libros$/)
})

test('Fibra del Sur con FEL obligatoria desactivada y «Todas» con una sección por empresa', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Tablero fiscal', /\/fiscal\/tablero/)
    await elegirEmpresa(page, /Fibra del Sur/)

    const fibra = page.locator('[data-empresa="2"]')
    await expect(fibra.locator('[data-alerta="fel"]')).toContainText('FEL es obligatoria para su régimen')
    await expect(fibra.locator('[data-bloque="isr"]')).toHaveAttribute('data-estado', 'no_aplica')
    await expect(fibra.locator('[data-bloque="isr"] [data-prueba="bloque-motivo"]')).toContainText('No aplica al régimen Pequeño contribuyente')
    await expect(fibra.locator('[data-prueba="pc-porcentaje"]')).toHaveText('9.07 % del límite')
    await expect(page.locator('[data-empresa="1"]')).toHaveCount(0)

    await elegirEmpresa(page, /Todas/)
    await expect(page.locator('[data-empresa]')).toHaveCount(2)
    await expect(page.getByText('una sección por empresa, sin totales consolidados')).toBeVisible()
    await expect(page.locator('[data-empresa="1"] h2')).toContainText('ArgosNet')
    await expect(page.locator('[data-empresa="2"] h2')).toContainText('Fibra del Sur')
})

test('el cajero no ve el tablero fiscal', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Tablero fiscal', exact: true })).toHaveCount(0)
})
