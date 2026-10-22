import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Libros legales con folio (A3, fase 6 PR D) en modo fixtures, en escritorio y teléfono. ArgosNet tiene
 * septiembre cerrado, el bloqueo global hasta el 31/08, el Diario habilitado del 1 al 50 (usados 1–8) y
 * Compras sin habilitación. Hoy es el 15/10/2026: la vista previa abre en septiembre.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

async function emitir(page: Page, libro: string) {
    await page.locator('[data-prueba="abrir-emitir"]').click()
    const dialogo = page.getByRole('dialog', { name: `Emitir ${libro}` })
    await expect(dialogo.locator('[data-prueba="emitir-folios"]')).toBeVisible()
    await expect(dialogo.getByRole('button', { name: 'Emitir con folio' })).toBeDisabled()
    await dialogo.getByRole('checkbox', { name: 'Entiendo que la emisión gasta folios' }).click()
    await dialogo.getByRole('button', { name: 'Emitir con folio' }).click()
    return dialogo
}

test('vista previa, emitir sin bloqueo dice qué hacer; bloquear, emitir, habilitar compras y ver el historial', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Libros legales', /\/libros/)
    await expect(page.locator('[data-prueba="libros-sin-empresa"]')).toBeVisible()
    await elegirEmpresa(page, /ArgosNet/)

    // Vista previa: borrador de septiembre, filas de total en negrita y el PDF embebido.
    await expect(page.locator('[data-libro="diario"] [data-prueba="folios-siguiente"]')).toHaveText('Siguiente folio: 9')
    await expect(page.locator('[data-libro="compras"] [data-prueba="folios-estado"]')).toHaveText('Sin habilitación')
    await expect(page.locator('[data-prueba="libros-borrador"]')).toHaveText('Borrador sin folio')
    await expect(page.locator('[data-prueba="libros-rango"]')).toHaveText('Del 01/09/2026 al 30/09/2026')
    await expect(page.locator('[data-prueba="tabla-libro"] tbody tr.font-semibold').first()).toContainText('Total de la partida 1')
    await page.locator('[data-prueba="libros-vista"]').getByRole('tab', { name: 'PDF' }).click()
    await expect(page.locator('[data-prueba="libros-pdf"]')).toBeVisible()
    await page.locator('[data-prueba="libros-vista"]').getByRole('tab', { name: 'Tabla' }).click()

    // Sin el bloqueo global hasta el 30/09 no se emite: el error dice qué hacer y lleva a los bloqueos.
    let dialogo = await emitir(page, 'Libro Diario')
    const problema = dialogo.locator('[data-prueba="emitir-problema"]')
    await expect(problema).toContainText('El periodo todavía no se puede emitir')
    await expect(problema.locator('[data-prueba="paso-libro"]')).toContainText('bloquee el libro (global o duro)')
    await problema.getByRole('link', { name: 'Ir a bloqueos' }).click()
    await expect(page).toHaveURL(/\/libro\/bloqueos/)
    const empresa = page.locator('[data-prueba="bloqueos-empresa"]').first()
    await empresa.locator('[data-prueba="abrir-bloquear"]').click()
    const bloquear = page.getByRole('dialog', { name: 'Bloquear el libro' })
    await bloquear.locator('[data-prueba="bloqueo-hasta"]').fill('2026-09-30')
    await bloquear.locator('[data-prueba="bloqueo-motivo"]').fill('Cierre de septiembre')
    await bloquear.getByRole('button', { name: 'Bloquear' }).click()
    await expect(empresa.locator('[data-tipo="global"] [data-prueba="bloqueo-vigente"]')).toHaveText('Hasta 30/09/2026')

    // Ahora sí: emisión con folio desde el 9.
    await ir(page, 'Libros legales', /\/libros/)
    dialogo = await emitir(page, 'Libro Diario')
    await expect(dialogo).toHaveCount(0)
    await expect(page.locator('[data-prueba="libros-emitido"]')).toContainText(/Emisión 4 · Folios? 9/)
    await expect(page.locator('[data-libro="diario"] [data-prueba="folios-siguiente"]')).not.toHaveText('Siguiente folio: 9')

    // Compras: sin habilitación, folios agotados; se registra la habilitación y se emite.
    await page.locator('[data-prueba="libros-libro"]').getByRole('tab', { name: 'Compras' }).click()
    dialogo = await emitir(page, 'Libro de Compras y Servicios Recibidos')
    await expect(dialogo.locator('[data-prueba="emitir-problema"]')).toContainText('No hay folios habilitados suficientes')
    await dialogo.getByRole('link', { name: 'Registrar habilitación' }).click()
    await expect(page).toHaveURL(/\/libros\/habilitaciones/)
    const habilitar = page.getByRole('dialog', { name: 'Registrar habilitación de folios' })
    await expect(habilitar.locator('[data-prueba="habilitacion-libro"]')).toContainText('Libro de Compras y Servicios Recibidos')
    await habilitar.locator('[data-prueba="habilitacion-autorizacion"]').fill('SAT-7121-2026-000300')
    await habilitar.getByRole('spinbutton').first().fill('1')
    await habilitar.getByRole('spinbutton').nth(1).fill('25')
    await habilitar.getByRole('button', { name: 'Registrar' }).click()
    await expect(habilitar).toHaveCount(0)
    await expect(page.locator('[data-prueba="tabla-habilitaciones"] [data-prueba="habilitacion-rango"]').first()).toHaveText('1–25')

    await page.locator('[data-prueba="libros-navegacion"]').getByRole('link', { name: 'Vista previa' }).click()
    await expect(page).toHaveURL(/\/libros(\?|$)/)
    await page.locator('[data-prueba="libros-libro"]').getByRole('tab', { name: 'Compras' }).click()
    dialogo = await emitir(page, 'Libro de Compras y Servicios Recibidos')
    await expect(dialogo).toHaveCount(0)
    await expect(page.locator('[data-prueba="libros-emitido"]')).toContainText('Emisión 5 · Folio 1')

    // Historial: la emisión nueva arriba y la reimpresión sembrada con su marca; el detalle con su huella.
    await page.locator('[data-prueba="libros-emitido"]').getByRole('link', { name: 'Ver en emisiones' }).click()
    await expect(page).toHaveURL(/\/libros\/emisiones\?emision=5/)
    await expect(page.locator('[data-prueba="emision-detalle"]')).toBeVisible()
    await expect(page.locator('[data-prueba="detalle-sha256"]')).toHaveText(/^[0-9a-f]{64}$/)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-prueba="tabla-emisiones"] [data-prueba="emision-reimpresion"]')).toHaveText(['Reimpresión de #2'])
})

test('el cajero no ve los libros legales', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Libros legales', exact: true })).toHaveCount(0)
})
