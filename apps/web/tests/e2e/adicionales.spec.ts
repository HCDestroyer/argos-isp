import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Servicios adicionales y tipo de plan (A1) en modo fixtures, en escritorio y teléfono:
 *
 * 1. Ficha del servicio: se agrega un IPTV de cortesía con su motivo y se ve la credencial del
 *    streaming, que se oculta con "Ocultar".
 * 2. Ficha del plan Pyme: tipo empresarial y sus adicionales incluidos; la lista no admite el
 *    mismo adicional dos veces y se guarda con el aviso de que aplica a altas y cambios de plan.
 */
async function elegir(page: Page, disparador: Locator, opcion: string | RegExp): Promise<void> {
    await disparador.click()
    await page.getByRole('option', { name: opcion }).click()
}

test('adicional de cortesía con motivo y credencial a la vista', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    const seccion = page.locator('[data-prueba="servicio-adicionales"]')
    await expect(seccion.locator('[data-modalidad]')).toHaveCount(3, { timeout: 15_000 })

    await seccion.getByRole('button', { name: 'Agregar' }).click()
    const modal = page.getByRole('dialog', { name: 'Agregar adicional' })
    await elegir(page, modal.locator('[data-prueba="asignacion-adicional"]'), /^Usuario de IPTV/)
    await elegir(page, modal.locator('[data-prueba="asignacion-modalidad"]'), 'Cortesía')
    await modal.getByRole('button', { name: 'Agregar' }).click()
    await expect(modal.getByText('Elige el motivo de la cortesía')).toBeVisible()
    await elegir(page, modal.locator('[data-prueba="asignacion-motivo"]'), 'Promoción')
    await modal.getByLabel('Identificador').fill('iptv-0777')
    await modal.getByRole('button', { name: 'Agregar' }).click()
    await expect(modal).toBeHidden()
    await expect(seccion).toContainText('iptv-0777')
    await expect(seccion.locator('[data-modalidad="cortesia"]')).toHaveCount(2)

    await seccion.getByRole('button', { name: 'Ver credencial de Cuenta de streaming' }).click()
    const credencial = page.getByRole('dialog', { name: 'Credencial de Cuenta de streaming' })
    await expect(credencial.locator('[data-prueba="credencial-valor"]')).toHaveText('Str3am-0001')
    await expect(credencial).toContainText('Se oculta sola en')
    await credencial.getByRole('button', { name: 'Ocultar' }).click()
    await expect(credencial).toBeHidden()
})

test('plan con su tipo y adicionales incluidos', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Planes', /\/planes$/)
    await page.getByRole('link', { name: 'Pyme 50 Mbps', exact: true }).click()
    await expect(page).toHaveURL(/\/planes\/3$/)
    await expect(page.locator('[data-prueba="tipo-plan"]')).toHaveText('Empresarial')
    const seccion = page.locator('[data-prueba="plan-adicionales"]')
    await expect(seccion).toContainText('Usuario de IPTV')

    await seccion.getByRole('button', { name: 'Editar lista' }).click()
    const modal = page.getByRole('dialog', { name: 'Adicionales de Pyme 50 Mbps' })
    await modal.getByRole('button', { name: 'Agregar adicional' }).click()
    await elegir(page, modal.getByRole('combobox', { name: 'Adicional 3' }), /^Cuenta de streaming/)
    await modal.getByRole('button', { name: 'Guardar lista' }).click()
    await expect(modal.getByText('Ya está en la lista: sube la cantidad')).toBeVisible()
    await modal.getByRole('button', { name: 'Quitar el adicional 3' }).click()
    await modal.getByRole('button', { name: 'Quitar el adicional 2' }).click()
    await modal.getByRole('button', { name: 'Guardar lista' }).click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('Adicionales del plan guardados', { exact: true })).toBeVisible()
    await expect(seccion).not.toContainText('Usuario de IPTV')
    await expect(seccion).toContainText('Cuenta de streaming')
})
