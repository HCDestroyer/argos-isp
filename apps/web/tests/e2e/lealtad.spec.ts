import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Lealtad, fase 1 en modo fixtures, en escritorio y teléfono:
 *
 * 1. Programa y reglas: se crea una regla de antigüedad con su vista previa (valor del punto y
 *    pasivo por punto del programa) y se desactiva el programa con motivo.
 * 2. Puntos del cliente: se ajustan con motivo desde su ficha y el saldo cambia.
 */
test('regla con vista previa y desactivar el programa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Lealtad', /\/lealtad$/)
    await expect(page.locator('[data-prueba="estado-programa"]')).toHaveText('Activo')

    await page.getByRole('button', { name: 'Nueva regla' }).click()
    const modal = page.getByRole('dialog', { name: 'Nueva regla' })
    await modal.getByLabel('Puntos').fill('20')
    await modal.getByLabel('Puntos').press('Tab')
    const vista = modal.locator('[data-prueba="regla-vista-previa"]')
    await expect(vista).toContainText('20 pts · valen Q 2.00 · pasivo Q 1.60')
    await modal.getByText('Bono por racha').click()
    await expect(vista).toContainText('Bono cada 6 facturas seguidas')
    await modal.getByRole('button', { name: 'Crear regla' }).click()
    await expect(page.locator('[data-prueba="tabla-reglas-lealtad"]')).toContainText('20 pts')

    await page.getByRole('button', { name: 'Desactivar' }).click()
    const motivo = page.getByRole('dialog', { name: 'Desactivar programa' })
    await motivo.getByLabel('Motivo').fill('Rediseño para el próximo año')
    await motivo.getByRole('button', { name: 'Desactivar' }).click()
    await expect(page.locator('[data-prueba="estado-programa"]')).toHaveText('Inactivo')
    await expect(page.getByRole('button', { name: 'Activar', exact: true })).toBeVisible()
})

test('ajustar puntos desde la ficha del cliente', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes/)
    await page.getByPlaceholder('Nombre, NIT, teléfono, usuario PPP o IP').fill('Juan Carlos')
    await page.getByRole('link', { name: 'Juan Carlos Ramírez', exact: true }).click()
    await page.getByRole('tab', { name: /Puntos/ }).click()
    await expect(page.locator('[data-prueba="saldo-puntos"]')).toContainText('230 pts')

    await page.getByRole('button', { name: 'Ajustar puntos' }).click()
    const modal = page.getByRole('dialog', { name: 'Ajustar puntos' })
    await modal.getByLabel('Puntos').fill('-300')
    await modal.getByLabel('Puntos').press('Tab')
    await modal.getByLabel('Motivo').fill('Corrección de prueba')
    await modal.getByRole('button', { name: 'Ajustar puntos' }).click()
    await expect(modal.locator('[data-prueba="ajuste-error"]')).toContainText('El cliente tiene 230 puntos y se piden 300')

    await modal.getByLabel('Puntos').fill('70')
    await modal.getByLabel('Puntos').press('Tab')
    await modal.getByRole('button', { name: 'Ajustar puntos' }).click()
    await expect(page.locator('[data-prueba="saldo-puntos"]')).toContainText('300 pts')
    await expect(page.locator('[data-prueba="tabla-movimientos-puntos"]')).toContainText('Corrección de prueba')
})
