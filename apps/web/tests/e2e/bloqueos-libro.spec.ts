import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Bloqueos del libro (A3, fase 6 PR A). En los fixtures, ArgosNet tiene global y impuestos hasta el
 * 31/08, ventas hasta el 30/09, el duro hasta el 30/06 y compras sin bloqueo; tres servicios con su
 * factura de septiembre quedan pendientes por el bloqueo de ventas.
 */
test('bloquear compras, el duro con su confirmación y sus requisitos, una excepción y los procesos detenidos', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Bloqueos del libro', /\/libro\/bloqueos/)
    const empresa = page.locator('[data-prueba="bloqueos-empresa"]').first()
    await expect(empresa.locator('[data-tipo="compras"] [data-prueba="bloqueo-vigente"]')).toHaveText('Sin bloqueo')

    // Bloquear compras: hacia atrás del duro no se deja; hasta el 31/08 sí.
    await empresa.locator('[data-prueba="abrir-bloquear"]').click()
    const bloquear = page.getByRole('dialog', { name: 'Bloquear el libro' })
    await bloquear.locator('[data-prueba="bloqueo-tipo"]').click()
    await page.getByRole('option', { name: /Compras/ }).click()
    await bloquear.locator('[data-prueba="bloqueo-hasta"]').fill('2026-08-31')
    await bloquear.locator('[data-prueba="bloqueo-motivo"]').fill('Compras de agosto conciliadas')
    await bloquear.getByRole('button', { name: 'Bloquear' }).click()
    await expect(bloquear).toHaveCount(0)
    await expect(empresa.locator('[data-tipo="compras"] [data-prueba="bloqueo-vigente"]')).toHaveText('Hasta 31/08/2026')

    // Bloqueo duro: el botón espera la frase exacta; la API pide los meses cerrados.
    await empresa.locator('[data-prueba="abrir-duro"]').click()
    const duro = page.getByRole('dialog', { name: 'Bloqueo duro' })
    await duro.locator('[data-prueba="duro-hasta"]').fill('2026-08-31')
    await duro.locator('[data-prueba="duro-motivo"]').fill('Auditoría del tercer trimestre')
    await duro.locator('[data-prueba="duro-confirmacion"]').fill('bloqueo duro hasta 2026-08-31')
    await expect(duro.locator('[data-prueba="confirmar-duro"]')).toBeDisabled()
    await duro.locator('[data-prueba="duro-confirmacion"]').fill('BLOQUEO DURO hasta 2026-08-31')
    await duro.locator('[data-prueba="confirmar-duro"]').click()
    await expect(duro.locator('[data-prueba="duro-problema"]')).toContainText('Faltan requisitos para el bloqueo duro')
    await expect(duro.locator('[data-prueba="duro-problema"]')).toContainText('Meses sin cerrar')
    await duro.getByRole('button', { name: 'Cancelar' }).click()

    // Procesos: la facturación de septiembre sigue detenida por el bloqueo de ventas.
    await page.locator('[data-prueba="correr-facturar"]').click()
    await page.getByRole('dialog', { name: 'Facturación pendiente' }).getByRole('button', { name: 'Correr ahora' }).click()
    await expect(page.locator('[data-proceso="facturar"] [data-prueba="proceso-bloqueados"]')).toHaveText('3 documentos siguen pendientes por un bloqueo')

    // Excepción para todos sobre ventas: la siguiente corrida factura lo pendiente.
    await empresa.locator('[data-prueba="abrir-excepcion"]').click()
    const excepcion = page.getByRole('dialog', { name: 'Excepción a un bloqueo' })
    await excepcion.locator('[data-prueba="excepcion-tipo"]').click()
    await page.getByRole('option', { name: /Ventas/ }).click()
    await excepcion.locator('[data-prueba="excepcion-hasta"]').fill('2027-01-15T18:00')
    await excepcion.locator('[data-prueba="excepcion-motivo"]').fill('Facturar septiembre')
    await excepcion.getByRole('button', { name: 'Crear excepción' }).click()
    await expect(excepcion).toHaveCount(0)
    await expect(page.locator('[data-prueba="tabla-excepciones"] [data-prueba="excepcion-estado"]')).toHaveCount(2)
    await page.locator('[data-prueba="correr-facturar"]').click()
    await page.getByRole('dialog', { name: 'Facturación pendiente' }).getByRole('button', { name: 'Correr ahora' }).click()
    await expect(page.locator('[data-proceso="facturar"] [data-prueba="proceso-bloqueados"]')).toHaveText('Nada quedó detenido por un bloqueo')

    // Revocar la excepción con motivo.
    await page.locator('[data-prueba="revocar-excepcion"]').first().click()
    const revocar = page.getByRole('dialog', { name: 'Revocar excepción' })
    await revocar.getByRole('textbox').fill('Ya se facturó septiembre')
    await revocar.getByRole('button', { name: 'Revocar' }).click()
    await expect(page.locator('[data-prueba="tabla-excepciones"] [data-prueba="excepcion-estado"]')).toHaveCount(1)
})
