import { expect, test } from '@playwright/test'
import { entrar, fijarHoyFixtures } from './ayudas'

/**
 * Lista de verificación de cierre (A3, fase 6 PR B). En los fixtures, julio de ArgosNet tiene un turno
 * de caja abierto (anomalía), fondos en tránsito supervisados con nota y la depreciación sin verificar.
 * Cerrar julio responde 422 `checks_pendientes` con el check que falta; supervisado con nota, cierra.
 */
test('cerrar julio pide sus checks: se verifican, la anomalía se supervisa con nota y el mes cierra', async ({ page }) => {
    await fijarHoyFixtures(page)
    await entrar(page, 'admin@argos.test')
    await page.goto('/libro?tab=cierres&mes=2026-07')

    const lista = page.locator('[data-prueba="checklist-cierre"]')
    await expect(lista.locator('[data-prueba="checklist-resumen"]')).toHaveText('2 por resolver')
    await expect(lista.locator('[data-prueba="checklist-sin-verificar"]')).toContainText('Cuotas de activos y diferidos')
    await lista.locator('[data-prueba="checklist-verificar"]').click()
    await expect(lista.locator('[data-prueba="checklist-resumen"]')).toHaveText('1 por resolver')

    // Cerrar julio: la API verifica y responde con el check que falta.
    await page.locator('[data-prueba="abrir-cerrar-periodo"]').click()
    const cierre = page.getByRole('dialog', { name: 'Cerrar un mes del libro' })
    await cierre.locator('[data-prueba="mes-a-cerrar"]').click()
    await page.getByRole('option', { name: 'julio 2026' }).click()
    await cierre.locator('[data-prueba="confirmar-cierre"]').click()
    await expect(cierre).toContainText('Faltan checks del cierre')
    await expect(cierre.locator('[data-prueba="cierre-checks"]')).toContainText('Ningún turno de caja abierto del periodo: esperado 0, obtenido 1')
    await cierre.locator('[data-prueba="cierre-a-checklist"]').click()
    await expect(cierre).toHaveCount(0)

    // Supervisar la anomalía con nota.
    await lista.locator('[data-prueba="supervisar-turnos_cerrados"]:visible').click()
    const supervisar = page.getByRole('dialog', { name: 'Supervisar la anomalía' })
    await expect(supervisar).toContainText('esperado 0, obtenido 1')
    await supervisar.getByRole('textbox').fill('El turno de Carlos se cerró el 01/08 con arqueo')
    await supervisar.getByRole('button', { name: 'Supervisar' }).click()
    await expect(supervisar).toHaveCount(0)
    await expect(lista.locator('[data-prueba="checklist-resumen"]')).toHaveText('El mes pasa la lista')
    await expect(lista.locator('[data-prueba="retirar-turnos_cerrados"]:visible')).toBeVisible()

    // Ahora julio cierra.
    await page.locator('[data-prueba="abrir-cerrar-periodo"]').click()
    await cierre.locator('[data-prueba="mes-a-cerrar"]').click()
    await page.getByRole('option', { name: 'julio 2026' }).click()
    await cierre.locator('[data-prueba="confirmar-cierre"]').click()
    await expect(cierre).toHaveCount(0)
    await expect(page.locator('[data-prueba="tabla-cierres"]')).toContainText('julio 2026')
})
