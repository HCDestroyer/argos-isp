import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Sorteos (A3, `contratos/lealtad.md` §7, §8 y §15.3). En los fixtures, «Sorteo de fiestas patrias»
 * tiene el corte cerrado y el checklist completo salvo el timbre fiscal.
 */
test('ejecutar un sorteo: el requisito pendiente se explica, se marca y el resultado se entrega y comprueba', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Sorteos', /\/lealtad\/sorteos/)
    await page.getByRole('link', { name: 'Sorteo de fiestas patrias' }).click()
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Corte cerrado')
    await expect(page.locator('[data-prueba="sorteo-faltantes"]')).toContainText('Timbre fiscal')

    // Sin el timbre: la API responde 422 `requisito_pendiente` y el modal dice cuál falta.
    await page.locator('[data-prueba="ejecutar-sorteo"]').click()
    const ejecutar = page.getByRole('dialog', { name: 'Ejecutar el sorteo' })
    await ejecutar.getByLabel('Valor público del acto').fill('Lotería Santa Lucía 2026-10-20: 48213')
    await ejecutar.getByRole('button', { name: 'Ejecutar sorteo' }).click()
    await expect(ejecutar.locator('[data-prueba="ejecutar-problema"]')).toContainText('Falta el requisito «Timbre fiscal»')
    await ejecutar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(ejecutar).toHaveCount(0)

    await page.locator('[data-requisito="timbre_fiscal"] [data-prueba="marcar-requisito"]').click()
    const requisito = page.getByRole('dialog', { name: 'Timbre fiscal' })
    await requisito.getByLabel('Evidencia').fill('Recibo de la Gobernación 63')
    await requisito.getByRole('button', { name: 'Guardar marca' }).click()
    await expect(page.locator('[data-requisito="timbre_fiscal"] [data-prueba="requisito-estado"]')).toHaveText('Cumplido')
    await expect(page.locator('[data-prueba="sorteo-faltantes"]')).toHaveCount(0)

    await page.locator('[data-prueba="ejecutar-sorteo"]').click()
    await ejecutar.getByLabel('Valor público del acto').fill('Lotería Santa Lucía 2026-10-20: 48213')
    await ejecutar.getByRole('button', { name: 'Ejecutar sorteo' }).click()
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Ejecutado')
    const resultado = page.locator('[data-prueba="sorteo-resultado"]')
    await expect(resultado.locator('[data-ganador]')).toHaveCount(2)
    await expect(resultado.locator('[data-suplente]')).toHaveCount(2)
    await expect(resultado.locator('[data-prueba="valor-publico-resultado"]')).toContainText('48213')
    // Los hashes de 64 caracteres no ensanchan la página (390 px).
    const ancho = page.viewportSize()?.width ?? 0
    const caja = await resultado.boundingBox()
    expect((caja?.x ?? 0) + (caja?.width ?? 0)).toBeLessThanOrEqual(ancho)

    // Premio en efectivo: sale de una caja por el valor menos el ISR retenido.
    await resultado.locator('[data-ganador="1"] [data-prueba="entregar-premio"]').click()
    const entrega = page.getByRole('dialog', { name: 'Entregar premio' })
    await expect(entrega.locator('[data-prueba="entrega-neto"]')).toContainText('Q 675.00')
    await entrega.getByRole('radio', { name: 'Caja', exact: true }).check()
    await entrega.getByRole('combobox', { name: 'Caja' }).click()
    await page.getByRole('option', { name: 'Caja Oficina' }).click()
    await entrega.getByRole('button', { name: 'Registrar entrega' }).click()
    await expect(resultado.locator('[data-ganador="1"] [data-prueba="ganador-estado"]')).toHaveText('Entregado')
    await expect(resultado.locator('[data-ganador="1"] [data-prueba="ganador-entrega"]')).toContainText('Egreso de caja · ISR Q 75.00')

    await resultado.locator('[data-prueba="comprobar-sorteo"]').click()
    await expect(resultado.locator('[data-prueba="resultado-comprobacion"]')).toContainText('El resultado se reproduce')
})

test('crear un sorteo en borrador con premios por tipo e imagen, y publicar sus bases', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Sorteos', /\/lealtad\/sorteos/)
    await page.locator('[data-prueba="nuevo-sorteo"]').click()
    const formulario = page.getByRole('dialog', { name: 'Nuevo sorteo' })
    await formulario.getByLabel('Nombre', { exact: true }).first().fill('Sorteo de fin de año')
    await formulario.getByLabel('Mecánica y forma del sorteo').fill('Electrónico con argos-sorteo-v1 ante notario.')
    await formulario.getByLabel('Regla de participación').fill('Un boleto por servicio activo y al día.')
    await formulario.getByLabel('Premios no reclamados').fill('Pasa al primer suplente.')
    await formulario.getByLabel('Publicación de resultados').fill('En el portal, el mismo día.')
    await formulario.getByLabel('Participan desde').fill('2026-11-01')
    await formulario.getByLabel('Corte').fill('2026-12-28T23:59')
    await formulario.getByLabel('Sorteo', { exact: true }).fill('2026-12-30T16:00')
    await formulario.getByLabel('Lugar').fill('Oficina central')
    const premio = formulario.locator('[data-premio-formulario="1"]')
    await premio.getByLabel('Nombre').fill('Bicicleta de montaña')
    await premio.getByLabel('Valor (libre competencia)').fill('2500')
    await premio.getByLabel('Imagen').fill('/sorteos/bicicleta.svg')
    await premio.getByRole('combobox', { name: 'Tipo' }).click()
    await page.getByRole('option', { name: 'Bien' }).click()
    await formulario.getByRole('button', { name: 'Crear borrador' }).click()

    await expect(page).toHaveURL(/\/lealtad\/sorteos\/\d+$/)
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Borrador')
    const tarjeta = page.locator('[data-premio="1"]')
    await expect(tarjeta.locator('[data-prueba="premio-tipo"]')).toHaveText('Bien')
    await expect(tarjeta.locator('[data-prueba="premio-imagen"]')).toHaveAttribute('src', '/sorteos/bicicleta.svg')

    await page.locator('[data-prueba="publicar-bases"]').click()
    await page.getByRole('dialog', { name: 'Publicar bases' }).getByRole('button', { name: 'Publicar bases' }).click()
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Bases publicadas')
    await expect(page.locator('[data-prueba="sorteo-compromiso"]')).toContainText(/[0-9a-f]{64}/)
    await expect(page.locator('[data-prueba="sorteo-faltantes"]')).toContainText('Bases publicadas (DIACO)')
})
