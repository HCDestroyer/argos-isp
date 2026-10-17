import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 4 del brief de A4: "Crear promesa y ver el resultado de evaluación".
 * El servicio suspendido `juan.carlos2` recibe una promesa a 3 días: la evaluación
 * (`Schema<'EvaluacionPromesa'>`) la aprueba, muestra cada regla revisada con lo medido y el
 * límite, y el servicio vuelve a activo con promesa. Una segunda con la primera abierta responde
 * 409 `promesa_abierta`, como `CrearPromesaPago`.
 */
test('crear promesa y ver la regla que aplicó', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await page.getByLabel('Buscar servicios').fill('juan.carlos2')
    await page.getByRole('link', { name: 'juan.carlos2', exact: true }).click()
    await expect(page).toHaveURL(/\/servicios\/2$/)
    const encabezado = page.getByRole('heading', { level: 2, name: 'juan.carlos2' }).locator('..')
    await expect(encabezado).toContainText('Suspendido')

    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.getByLabel('Monto prometido')).toHaveValue('300.00')
    await modal.getByRole('button', { name: 'Crear promesa' }).click()

    const evaluacion = modal.getByLabel('Resultado de la evaluación')
    await expect(evaluacion.locator('[data-prueba="decision"]')).toHaveText('Aprobada')
    // Aprobada: ninguna regla decide (`regla: null`); se ven todas las revisadas.
    await expect(evaluacion.locator('[data-prueba="regla"]')).toHaveCount(0)
    await expect(evaluacion.locator('[data-prueba="motivo-evaluacion"]')).toHaveText('Cumple todas las reglas de promesa de la plantilla')
    const plazo = evaluacion.locator('[data-regla="plazo_max_dias"]')
    await expect(plazo).toContainText('Plazo máximo: Vence en 3 días (máximo 5)')
    await expect(plazo).toContainText('medido 3 · límite 5')
    await expect(evaluacion).toContainText('Deuda del servicio')
    await modal.getByRole('button', { name: 'Listo' }).click()

    await expect(encabezado).toContainText('Activo')
    await expect(encabezado).toContainText('Promesa activa')
    await expect(page.getByLabel('Promesas del servicio')).toContainText('Cumple todas las reglas de promesa de la plantilla')

    // Segunda con la primera abierta: 409 `promesa_abierta` en el modal, sin evaluación.
    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    await modal.getByLabel('Monto prometido').fill('150.00')
    await modal.getByRole('button', { name: 'Crear promesa' }).click()
    await expect(modal).toContainText('ya tiene la promesa')
    await expect(evaluacion).toHaveCount(0)
})
