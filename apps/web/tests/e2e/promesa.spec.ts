import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Prueba obligatoria 4 del brief de A4: "Crear promesa y ver el resultado de evaluación".
 * Con fixtures (hoy `POST /promesas` responde 501 en la API real): el servicio suspendido
 * `juan.carlos2` recibe una promesa a 3 días, la plantilla la aprueba por plazo y el servicio
 * vuelve a activo con promesa; una segunda en el mismo periodo se rechaza por el máximo.
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
    await expect(evaluacion.locator('[data-prueba="regla"]')).toContainText('Plazo máximo')
    await expect(evaluacion).toContainText('Plazo de 3 días dentro del máximo de 5')
    await modal.getByRole('button', { name: 'Listo' }).click()

    await expect(encabezado).toContainText('Activo')
    await expect(encabezado).toContainText('Promesa activa')
    await expect(page.getByLabel('Promesas del servicio')).toContainText('Plazo máximo')

    // Segunda promesa en el mismo periodo: 201 con estado rechazada y la regla que la frenó.
    await page.getByRole('button', { name: 'Promesa de pago' }).click()
    await modal.getByLabel('Monto prometido').fill('150.00')
    await modal.getByRole('button', { name: 'Crear promesa' }).click()
    await expect(evaluacion.locator('[data-prueba="decision"]')).toHaveText('Rechazada')
    await expect(evaluacion.locator('[data-prueba="regla"]')).toContainText('Máximo por periodo')
})
