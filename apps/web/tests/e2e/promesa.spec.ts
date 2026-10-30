import { expect, test } from '@playwright/test'
import { entrar, fijarHoyFixtures, ir } from './ayudas'

/**
 * Prueba obligatoria 4 del brief de A4: "Crear promesa y ver el resultado de evaluación".
 * La promesa cubre todo lo vencido (decisión del PM, 29 oct): nadie escribe el monto. El modal
 * muestra qué facturas cubre, el total, el abono inicial y la fecha límite.
 * El servicio suspendido `juan.carlos2` recibe una promesa a 3 días: la evaluación
 * (`Schema<'EvaluacionPromesa'>`) la aprueba, muestra cada regla revisada con lo medido y el
 * límite, y el servicio vuelve a activo con promesa. Una segunda con la primera abierta responde
 * 409 `promesa_abierta`, como `CrearPromesaPago`.
 */
test('crear promesa y ver la regla que aplicó', async ({ page }) => {
    // La promesa vence a 3 días: sin fecha fija, a fin de mes cae en la siguiente facturación.
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios/)
    await page.getByLabel('Buscar servicios').fill('juan.carlos2')
    await page.getByRole('link', { name: 'juan.carlos2', exact: true }).click()
    await expect(page).toHaveURL(/\/servicios\/2$/)
    const encabezado = page.getByRole('heading', { level: 2, name: 'juan.carlos2' }).locator('..')
    await expect(encabezado).toContainText('Suspendido')

    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    const modal = page.getByRole('dialog')
    const cobertura = modal.getByLabel('Lo que cubre la promesa')
    await expect(cobertura.locator('[data-prueba="cobertura-total"]')).toHaveText('Q 300.00')
    await expect(cobertura.getByLabel('Facturas que cubre').getByRole('listitem')).toHaveText([/Servicio de septiembre 2026.*Q 150\.00/, /Servicio de octubre 2026.*Q 150\.00/])
    await expect(cobertura.locator('[data-prueba="abono-requerido"]')).toContainText('No se exige')
    await expect(cobertura.locator('[data-prueba="fecha-maxima"]')).toContainText('20/10/2026')
    await expect(modal.getByLabel('Monto prometido')).toHaveCount(0)
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
    await expect(modal.locator('[data-prueba="regla-cumplimiento"]')).toHaveText('Cumplimiento: por facturas')
    await expect(modal.getByLabel('Facturas que cubre la promesa').getByRole('listitem')).toHaveCount(2)
    await modal.getByRole('button', { name: 'Listo' }).click()

    await expect(encabezado).toContainText('Activo')
    await expect(encabezado).toContainText('Promesa activa')

    const promesas = page.getByLabel('Promesas del servicio')
    await expect(promesas).toContainText('Cumple todas las reglas de promesa de la plantilla')
    await expect(promesas.locator('[data-prueba="regla-cumplimiento"]').first()).toHaveText('Cumplimiento: por facturas')

    // Segunda con la primera abierta: la simulación ya dice que crear daría 409 `promesa_abierta`.
    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    await expect(modal.locator('[data-prueba="motivo-no-creable"]')).toContainText(/Ya tiene la promesa \d+ activa/)
    await expect(modal.getByRole('button', { name: 'Crear promesa' })).toBeDisabled()
    await expect(evaluacion).toHaveCount(0)
})

test('sin nada vencido no hay promesa que crear', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.locator('[data-prueba="cobertura-sin-vencido"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="cobertura-total"]')).toHaveCount(0)
    await expect(modal.locator('[data-prueba="motivo-no-creable"]')).toHaveText('El servicio no tiene facturas vencidas: no hace falta promesa')
    await expect(modal.getByRole('button', { name: 'Crear promesa' })).toBeDisabled()
})
