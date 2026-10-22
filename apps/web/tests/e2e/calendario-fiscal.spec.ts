import { expect, test, type Page } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir, menu } from './ayudas'

/**
 * Calendario fiscal y feriados (A3, fase 7 PR A) en modo fixtures, en escritorio y teléfono. Hoy es el
 * jueves 15/10/2026. ArgosNet: retenciones de ISR de agosto y septiembre vencidas (la de septiembre
 * caía el sábado 10/10 y corrió al lunes 12/10) y retenciones de IVA de septiembre al 21/10. La tabla
 * de feriados arranca vacía: con el 20/10 como feriado, las de IVA corren al 22/10.
 */
async function elegirEmpresa(page: Page, nombre: RegExp) {
    const selector = page.locator('[data-prueba="selector-empresa"]:visible').first()
    await selector.click()
    await page.getByRole('option', { name: nombre }).click()
    await expect(selector).toContainText(nombre)
}

test('mes con vencidas en rojo y el día corrido; un feriado recalcula el vencimiento; lista con su motivo', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Calendario fiscal', /\/fiscal\/calendario/)
    await elegirEmpresa(page, /ArgosNet/)

    await expect(page.locator('[data-prueba="calendario-titulo-mes"]')).toHaveText('Octubre 2026')
    await expect(page.locator('[data-prueba="calendario-vencidas"]')).toContainText('2 obligaciones vencidas sin presentar')
    await expect(page.locator('[data-fecha="2026-10-12"] [data-obligacion="8"]')).toHaveAttribute('data-estado', 'vencida')
    const agenda = page.locator('[data-prueba="calendario-agenda"]')
    await expect(agenda.locator('[data-agenda="9"]')).toContainText('Faltan 6 días')

    // Detalle: por qué vence el 12/10 y que el formulario está por confirmar con el contador.
    await agenda.locator('[data-agenda="8"]').click()
    await expect(page).toHaveURL(/obligacion=8/)
    await expect(page.locator('[data-prueba="detalle-corrido"]')).toContainText('Caía el sábado 10/10/2026 (inhábil)')
    await expect(page.locator('[data-prueba="detalle-formulario-por-confirmar"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-prueba="obligacion-detalle"]')).toHaveCount(0)

    // Feriado del 20/10 en Configuración → Fiscal → Feriados (global, avisa el recálculo).
    await page.getByRole('link', { name: 'Feriados' }).click()
    await expect(page).toHaveURL(/\/configuracion\/fiscal\?pestana=feriados/)
    await expect(page.locator('[data-prueba="feriados-confirmar-contador"]')).toContainText('Confirmar con contador')
    await expect(page.locator('[data-prueba="tabla-feriados"]')).toContainText('Sin feriados en 2026')
    await page.locator('[data-prueba="abrir-feriado"]').click()
    const dialogo = page.getByRole('dialog', { name: 'Agregar feriado' })
    await expect(dialogo.locator('[data-prueba="feriado-aviso-recalculo"]')).toContainText('Recalcula el calendario de todas las empresas')
    await dialogo.locator('[data-prueba="feriado-fecha"]').fill('2026-10-20')
    await dialogo.locator('[data-prueba="feriado-nombre"]').fill('Día de la Revolución')
    await dialogo.locator('[data-prueba="feriado-motivo"]').fill('Decreto 19-2018, confirmado por el contador')
    await dialogo.getByRole('button', { name: 'Agregar y recalcular' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByLabel('Notifications (F8)').getByText('1 vencimiento movido')).toBeVisible()
    await expect(page.locator('[data-feriado="2026-10-20"]')).toBeVisible()

    // De vuelta en el calendario: las retenciones de IVA vencen el 22/10 y el 20/10 lleva su nombre.
    await ir(page, 'Calendario fiscal', /\/fiscal\/calendario/)
    await expect(page.locator('[data-fecha="2026-10-20"] [data-prueba="calendario-feriado"]')).toHaveText('Día de la Revolución')
    await expect(page.locator('[data-fecha="2026-10-22"] [data-obligacion="9"]')).toHaveCount(1)
    await expect(page.locator('[data-agenda="9"]')).toContainText('Faltan 7 días')

    // Lista: las que no aplican, atenuadas con su motivo.
    await page.locator('[data-prueba="calendario-vista"]').getByRole('tab', { name: 'Lista' }).click()
    await expect(page).toHaveURL(/vista=lista/)
    const tabla = page.locator('[data-prueba="tabla-obligaciones"]')
    await expect(tabla.locator('[data-estado="vencida"]')).toHaveCount(2)
    await expect(tabla.locator('[data-prueba="fila-motivo"]').first()).toHaveText('No hubo retenciones de ISR en el mes (según el libro)')
})

test('el cajero no ve el calendario fiscal', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const contenedor = await menu(page)
    await expect(contenedor.getByRole('link', { name: 'Calendario fiscal', exact: true })).toHaveCount(0)
})
