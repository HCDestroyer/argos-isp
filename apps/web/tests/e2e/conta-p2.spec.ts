import { expect, test } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Plan de contabilidad, lote P2: lo que estaba apagado y ya tiene API. Asiento manual y «Por
 * aprobar» en el libro, registrar gestión de cobro, los indicadores del panel financiero, y favoritos
 * y envío programado de los reportes. Escritorio y teléfono.
 */
test.beforeEach(async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
})

test('libro: el asiento de ajuste se registra y «Por aprobar» lo aprueba otra persona', async ({ page }) => {
    await ir(page, 'Libro contable', /\/libro/)
    await page.locator('[data-prueba="asiento-ajuste"]').click()
    const panel = page.getByRole('dialog', { name: /Asiento de ajuste/ })
    await expect(panel).toBeVisible()
    await panel.locator('[data-prueba="asiento-descripcion"]').fill('Ajuste de redondeo de prueba')
    await panel.locator('[data-prueba="asiento-cuenta-0"]').click()
    await page.getByRole('option', { name: /5\.3\.05/ }).click()
    await panel.locator('[data-prueba="asiento-debe-0"] input, input[data-prueba="asiento-debe-0"]').first().fill('10.00')
    await panel.locator('[data-prueba="asiento-cuenta-1"]').click()
    await page.getByRole('option', { name: /1\.1\.01\.01/ }).click()
    await panel.locator('[data-prueba="asiento-haber-1"] input, input[data-prueba="asiento-haber-1"]').first().fill('10.00')
    await expect(panel.locator('[data-prueba="asiento-totales"]')).toContainText('Cuadra')
    await panel.locator('[data-prueba="asiento-registrar"]').click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByText('Asiento registrado').first()).toBeVisible()

    // Por aprobar: el borrador de otra persona se aprueba desde su detalle.
    await page.getByRole('tab', { name: /Por aprobar/ }).click()
    await expect(page.locator('[data-prueba="tabla-borradores"]')).toBeVisible()
    await page.locator('[data-borrador="1"]').click()
    const detalle = page.locator('[data-borrador-detalle="1"]')
    await expect(detalle).toContainText('Cuadra')
    await detalle.locator('[data-prueba="borrador-aprobar"]').click()
    await expect(page.getByText('Asiento aprobado y registrado').first()).toBeVisible()
})

test('cartera: registrar gestión de cobro a un cliente elegido', async ({ page }) => {
    await ir(page, 'Cartera', /\/cartera/)
    const tabla = page.locator('[data-prueba="tabla-por-cobrar"]')
    await expect(tabla).toBeVisible()
    await tabla.getByRole('checkbox').nth(1).check()
    await page.locator('[data-prueba="registrar-gestion"]').click()
    const modal = page.getByRole('dialog', { name: 'Registrar gestión de cobro' })
    await modal.locator('[data-prueba="gestion-nota"]').fill('Paga el viernes en caja')
    await modal.locator('[data-prueba="gestion-registrar"]').click()
    await expect(modal).toHaveCount(0)
    await expect(page.getByText('Gestión registrada').first()).toBeVisible()
})

test('panel financiero: ingreso recurrente, bajas y por servicio con cifras', async ({ page }) => {
    await ir(page, 'Panel financiero', /\/finanzas/)
    const ingreso = page.locator('[data-kpi="ingreso-recurrente"]')
    await expect(ingreso).toContainText(/Q\s?[\d,]+\.\d{2}/)
    await expect(ingreso).not.toContainText('Sin datos todavía')
    // En el teléfono solo se muestran los indicadores del resumen; los demás van en escritorio.
    if (test.info().project.name === 'escritorio') {
        await expect(page.locator('[data-kpi="bajas"]')).not.toContainText('llega con la API')
        await expect(page.locator('[data-kpi="por-servicio"]')).toContainText(/Q\s?[\d,]+\.\d{2}/)
    }
})

test('reportes: marcar favorito y programar el envío desde el visor', async ({ page }) => {
    await ir(page, 'Reportes', /\/reportes/)
    await page.locator('[data-favorito="cartera-vencida"]').click()
    await expect(page.locator('[data-favorito="cartera-vencida"]')).toHaveAttribute('aria-pressed', 'true')
    // En el teléfono las categorías van en una hoja que abre el botón del filtro.
    if (test.info().project.name === 'telefono') {
        await page.getByRole('button', { name: 'Elegir categoría' }).click()
    }
    await page.locator('[data-categoria="favoritos"]').click()
    await expect(page.locator('[data-prueba^="reporte-"]')).toHaveCount(1)
    await page.locator('[data-prueba="reporte-cartera-vencida"]').click()
    await expect(page).toHaveURL(/\/reportes\/cartera-vencida/)
    await expect(page.locator('[data-prueba="favorito-reporte"]')).toHaveAttribute('aria-pressed', 'true')

    // En el teléfono el visor solo consulta y descarga: programar envío es de escritorio (decisión 9).
    if (test.info().project.name === 'escritorio') {
        await page.locator('[data-prueba="programar-envio"]').click()
        const modal = page.getByRole('dialog', { name: 'Programar envío' })
        await expect(modal.locator('[data-prueba="envio-nombre"] input, input[data-prueba="envio-nombre"]').first()).not.toHaveValue('')
        await modal.locator('[data-prueba="envio-programar"]').click()
        await expect(modal).toHaveCount(0)
        await expect(page.getByText('Envío programado').first()).toBeVisible()
    }
})
