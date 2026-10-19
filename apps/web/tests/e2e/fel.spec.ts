import { expect, test, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * FEL (fase 3 de A3) en el panel, en modo fixtures: ArgosNet (empresa 1) tiene la FEL obligatoria
 * con el certificador falso; Fibra del Sur (2), desactivada. El worker se simula: un DTE en cola
 * se certifica en ~1.5 s y una anulación pendiente se confirma igual.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

/**
 * Abre la factura de un DTE rechazado desde la cola. La lista sin filtro ya trae un NCRE rechazado
 * y su primera factura está certificada: la fila se elige por su propio estado, no la primera de
 * la tabla (antes de que llegara la lista filtrada, `toContainText('Rechazado')` pasaba y el clic
 * abría la factura certificada).
 */
async function abrirFacturaRechazada(page: Page): Promise<void> {
    const atajo = page.locator('[data-prueba="atajo-rechazado"]')
    await atajo.click()
    await expect(atajo).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/estado=rechazado/)
    const factura = page.getByRole('link', { name: /^Factura #\d+$/ })
    const fila = page.locator('[data-prueba="tabla-dte"] tbody tr').filter({ hasText: 'Rechazado' }).filter({ has: factura }).first()
    await fila.getByRole('link', { name: /^Factura #\d+$/ }).click()
    await expect(page).toHaveURL(/\/facturas\/\d+$/)
}

test('Configuración → FEL: credenciales sin secretos, desactivar con avisos vivos muestra la cuenta y el aviso global', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'FEL', /\/configuracion\/fel/)
    await expect(page.locator('[data-prueba="elegir-empresa"]')).toBeVisible()
    await elegirEmpresa(page, /ArgosNet/)

    await expect(page.locator('[data-prueba="fel-modo"]')).toHaveText('Obligatoria')
    const pruebas = page.locator('[data-credenciales="pruebas"]')
    await expect(pruebas.locator('[data-prueba="credenciales-estado"]')).toHaveText('Configuradas')
    await pruebas.getByRole('button', { name: 'Probar' }).click()
    await expect(page.getByText('Credenciales válidas').first()).toBeVisible()

    await page.locator('[data-prueba="fel-modos"]').getByText('Desactivada').click()
    await page.locator('[data-prueba="fel-guardar"]').click()
    await expect(page.locator('[data-prueba="fel-avisos-por-certificar"]')).toContainText(/\d+ avisos de cobro sin certificar/)

    // La FEL de Fibra del Sur está desactivada: su alerta se ve en todo el panel.
    await elegirEmpresa(page, /Fibra del Sur/)
    await expect(page.locator('[data-prueba="fel-desactivada"]')).toBeVisible()
    await ir(page, 'Facturas', /\/facturas$/)
    await expect(page.locator('[data-prueba="aviso-fel-desactivada"]')).toBeVisible()
})

test('cola de DTE: un rechazado se reintenta y se certifica; la factura muestra autorización, serie y número', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cola de DTE', /\/dte/)
    await abrirFacturaRechazada(page)

    const fel = page.locator('[data-prueba="factura-fel"]')
    await expect(fel.locator('[data-prueba="dte-estado"]')).toHaveText('Rechazado')
    await expect(fel.locator('[data-prueba="dte-error"]')).toContainText('SAT')
    await fel.locator('[data-prueba="dte-reintentar"]').click()
    await expect(fel.locator('[data-prueba="dte-estado"]')).toHaveText('Certificado', { timeout: 15_000 })
    await expect(fel.locator('[data-prueba="dte-autorizacion"]')).toContainText(/[0-9A-F]{8}-/)
    await expect(fel.locator('[data-prueba="dte-serie-numero"]')).toContainText(' · ')

    await fel.locator('[data-prueba="dte-xml"]').click()
    await expect(page.locator('[data-prueba="dte-xml-contenido"]')).toContainText('GTDocumento')
})

test('anular una factura certificada en dos pasos: anulación pendiente y luego anulada', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Cola de DTE', /\/dte/)
    await abrirFacturaRechazada(page)
    const fel = page.locator('[data-prueba="factura-fel"]')
    await expect(fel.locator('[data-prueba="dte-estado"]')).toHaveText('Rechazado')
    await fel.locator('[data-prueba="dte-reintentar"]').click()
    await expect(fel.locator('[data-prueba="dte-estado"]')).toHaveText('Certificado', { timeout: 15_000 })

    await page.locator('[data-prueba="abrir-anular"]').click()
    const modal = page.getByRole('dialog')
    await modal.locator('[data-prueba="anular-motivo"]').fill('El servicio se dio de baja antes del periodo')
    await modal.locator('[data-prueba="anular-continuar"]').click()
    await expect(modal.locator('[data-prueba="anular-confirmacion"]')).toContainText('anulación pendiente')
    await modal.locator('[data-prueba="anular-confirmar"]').click()
    await expect(page.locator('[data-prueba="factura-anulacion-pendiente"]')).toBeVisible()
    await expect(page.locator('[data-prueba="factura-estado"]')).toHaveText('Anulada', { timeout: 15_000 })
    await expect(fel.locator('[data-prueba="dte-estado"]')).toHaveText('Anulado')
})

test('integridad del libro: con la cadena rota, el cierre del mes lo explica y lleva a la integridad', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(() => localStorage.setItem('argos_fixtures_cadena_rota', JSON.stringify({ 1: 'hash_distinto' })))
    await ir(page, 'Libro', /\/libro/)
    await elegirEmpresa(page, /ArgosNet/)
    await page.getByRole('tab', { name: 'Cierres' }).click()
    await page.locator('[data-prueba="abrir-cerrar-periodo"]').click()
    const modal = page.getByRole('dialog')
    await modal.locator('[data-prueba="confirmar-cierre"]').click()
    await expect(modal.locator('[data-prueba="cierre-error"]')).toContainText('La cadena del libro no verifica')
    await modal.locator('[data-prueba="cierre-a-integridad"]').click()
    await expect(page.locator('[data-prueba="integridad-ruptura"]')).toContainText('Ruptura en el sello 5')
    await page.evaluate(() => localStorage.removeItem('argos_fixtures_cadena_rota'))
})
