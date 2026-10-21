import { expect, test } from '@playwright/test'
import { bytesBase64, IMAGENES_SEMILLA } from '../../fixtures/sorteos/imagenes'
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
    await expect(ejecutar.locator('[data-prueba="ejecutar-fuente"]')).toContainText('Lotería Santa Lucía')
    await ejecutar.getByLabel('Valor público del acto').fill('Lotería Santa Lucía 2026-10-20: 48213')
    await ejecutar.getByLabel('Cómo se obtuvo el valor').fill('Leído por la notaria en el sitio de la Lotería, en pantalla')
    await ejecutar.getByRole('button', { name: 'Ejecutar sorteo' }).click()
    await expect(ejecutar.locator('[data-prueba="ejecutar-problema"]')).toContainText('Falta el requisito «Timbre fiscal»')
    await ejecutar.getByRole('button', { name: 'Cancelar' }).click()
    await expect(ejecutar).toHaveCount(0)

    await page.locator('[data-requisito="timbre_fiscal"] [data-prueba="marcar-requisito"]').click()
    const requisito = page.getByRole('dialog', { name: 'Timbre fiscal' })
    await requisito.getByLabel('Evidencia', { exact: true }).fill('Recibo de la Gobernación 63')
    await requisito.getByRole('button', { name: 'Guardar marca' }).click()
    await expect(page.locator('[data-requisito="timbre_fiscal"] [data-prueba="requisito-estado"]')).toHaveText('Cumplido')
    await expect(page.locator('[data-prueba="sorteo-faltantes"]')).toHaveCount(0)

    await page.locator('[data-prueba="ejecutar-sorteo"]').click()
    await ejecutar.getByLabel('Valor público del acto').fill('Lotería Santa Lucía 2026-10-20: 48213')
    await ejecutar.getByLabel('Cómo se obtuvo el valor').fill('Leído por la notaria en el sitio de la Lotería, en pantalla')
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

    // H22: la entrega se anula toda junta, con motivo; el premio se puede volver a entregar.
    await resultado.locator('[data-ganador="1"] [data-prueba="anular-entrega"]').click()
    const anular = page.getByRole('dialog', { name: 'Anular la entrega' })
    await expect(anular.locator('[data-prueba="anular-entrega-deshace"]')).toContainText('anula el egreso')
    await anular.getByLabel('Motivo').fill('Se registró en la caja equivocada')
    await anular.getByRole('button', { name: 'Anular entrega' }).click()
    await expect(resultado.locator('[data-ganador="1"] [data-prueba="ganador-estado"]')).toHaveText('Por notificar')
    await expect(resultado.locator('[data-ganador="1"] [data-prueba="entregar-premio"]')).toBeVisible()

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
    await formulario.getByLabel('Fuente del valor público').fill('Primer premio de la Lotería Santa Lucía del día del sorteo')
    await formulario.getByLabel('Participan desde').fill('2026-11-01')
    await formulario.getByLabel('Corte').fill('2026-12-28T23:59')
    await formulario.getByLabel('Sorteo', { exact: true }).fill('2026-12-30T16:00')
    await formulario.getByLabel('Lugar').fill('Oficina central')
    const premio = formulario.locator('[data-premio-formulario="1"]')
    await premio.getByLabel('Nombre').fill('Bicicleta de montaña')
    await premio.getByLabel('Valor (libre competencia)').fill('2500')
    await premio.getByRole('combobox', { name: 'Tipo' }).click()
    await page.getByRole('option', { name: 'Bien' }).click()
    await formulario.getByRole('button', { name: 'Crear borrador' }).click()

    await expect(page).toHaveURL(/\/lealtad\/sorteos\/\d+$/)
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Borrador')
    const tarjeta = page.locator('[data-premio="1"]')
    await expect(tarjeta.locator('[data-prueba="premio-tipo"]')).toHaveText('Bien')
    await expect(tarjeta.locator('[data-prueba="premio-sin-imagen"]')).toBeVisible()

    // La imagen se sube (el portal no carga URLs externas) y la ficha la pide con la sesión.
    await tarjeta.locator('[data-prueba="subir-imagen-premio"]').click()
    const imagen = page.getByRole('dialog', { name: 'Imagen del premio' })
    await imagen.locator('input[type="file"]').setInputFiles({ name: 'bicicleta.webp', mimeType: 'image/webp', buffer: Buffer.from(bytesBase64(IMAGENES_SEMILLA.bicicleta)) })
    await expect(imagen.locator('[data-prueba="imagen-premio-vista"]')).toBeVisible()
    await imagen.getByRole('button', { name: 'Subir imagen' }).click()
    await expect(imagen).toHaveCount(0)
    await expect(tarjeta.locator('[data-prueba="premio-imagen"]')).toHaveAttribute('src', /^blob:/)

    // Anunciar en el portal (falso por defecto).
    const aviso = page.locator('[data-prueba="interruptor-aviso-portal"]')
    await expect(aviso).toHaveAttribute('aria-checked', 'false')
    await aviso.click()
    await expect(aviso).toHaveAttribute('aria-checked', 'true')

    await page.locator('[data-prueba="publicar-bases"]').click()
    await page.getByRole('dialog', { name: 'Publicar bases' }).getByRole('button', { name: 'Publicar bases' }).click()
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Bases publicadas')
    await expect(page.locator('[data-prueba="sorteo-compromiso"]')).toContainText(/[0-9a-f]{64}/)
    await expect(page.locator('[data-prueba="sorteo-faltantes"]')).toContainText('Bases publicadas (DIACO)')
    await expect(page.locator('[data-prueba="sorteo-fuente-valor"]')).toContainText('Lotería Santa Lucía')
})

/**
 * Decisión del PM: un bien comprado (al contado o a crédito) se entrega con la línea de su compra;
 * la contrapartida «Proveedores» ya no existe. «Día del cliente» está ejecutado y su 2.º premio es una
 * bicicleta comprada a Ciclo Sport (compra #1 de los fixtures).
 */
test('entregar un bien con la línea de su compra', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Sorteos', /\/lealtad\/sorteos/)
    await page.getByRole('link', { name: 'Día del cliente' }).click()
    const resultado = page.locator('[data-prueba="sorteo-resultado"]')
    await resultado.locator('[data-ganador="2"] [data-prueba="entregar-premio"]').click()
    const entrega = page.getByRole('dialog', { name: 'Entregar premio' })
    await expect(entrega.getByRole('radio', { name: /Proveedores/ })).toHaveCount(0)
    await entrega.getByRole('radio', { name: /Compra registrada/ }).check()
    await entrega.locator('[data-prueba="entrega-compra-linea"]').click()
    await expect(page.getByRole('option', { name: /Instalación del soporte/ })).toHaveCount(0)
    await page.getByRole('option', { name: /Bicicleta de montaña aro 29 \(quedan 2 de 2\)/ }).click()
    await expect(entrega.getByLabel('Unidades que se entregan')).toHaveValue('1')
    await entrega.getByRole('button', { name: 'Registrar entrega' }).click()
    await expect(resultado.locator('[data-ganador="2"] [data-prueba="ganador-estado"]')).toHaveText('Entregado')
    await expect(resultado.locator('[data-ganador="2"] [data-prueba="ganador-entrega"]')).toContainText('Compra #1 · 1 unidad, base Q 2,232.15')
})

/**
 * Segunda PR (A3): en «Día del cliente» (ejecutado) el 3.er puesto ya se notificó y su plazo venció.
 * Se marca la publicación de resultados con un PDF de evidencia, se notifica a los demás, el premio no
 * reclamado pasa al primer suplente y se cierra el acta, que se descarga con su SHA-256.
 */
test('evidencia en archivo, notificar, no reclamado con suplente y acta cerrada', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Sorteos', /\/lealtad\/sorteos/)
    await page.getByRole('link', { name: 'Día del cliente' }).click()
    const resultado = page.locator('[data-prueba="sorteo-resultado"]')
    await expect(resultado.locator('[data-ganador]')).toHaveCount(3)

    await page.locator('[data-requisito="publicacion_resultados"] [data-prueba="marcar-requisito"]').click()
    const requisito = page.getByRole('dialog', { name: 'Resultados publicados' })
    await requisito.locator('input[type="file"]').setInputFiles({ name: 'publicacion.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% Prensa Libre 6/9/2026\n%%EOF\n') })
    await requisito.getByRole('button', { name: 'Guardar marca' }).click()
    await expect(page.locator('[data-requisito="publicacion_resultados"] [data-prueba="archivo-sorteo"]')).toHaveText('publicacion.pdf')

    await page.locator('[data-prueba="notificar-ganadores"]').click()
    await page.getByRole('dialog', { name: 'Notificar ganadores' }).getByRole('button', { name: 'Notificar' }).click()
    await expect(resultado.locator('[data-ganador="1"] [data-prueba="ganador-estado"]')).toHaveText('Notificado')
    await expect(page.locator('[data-prueba="notificar-ganadores"]')).toHaveCount(0)

    await resultado.locator('[data-ganador="3"] [data-prueba="no-reclamado"]').click()
    const noReclamado = page.getByRole('dialog', { name: 'Premio no reclamado' })
    await expect(noReclamado).toContainText('pasa al suplente 4.º')
    await noReclamado.getByRole('textbox').fill('No se presentó en el plazo de 30 días')
    await noReclamado.getByRole('button', { name: 'Dar por no reclamado' }).click()
    await expect(resultado.locator('[data-ganador="3"] [data-prueba="ganador-estado"]')).toHaveText('Sustituido')
    await expect(page.getByText('Pasó al suplente 4.º, que ya se notificó.').first()).toBeVisible()
    await expect(resultado.locator('[data-suplente="4"] [data-prueba="ganador-sustituye"]')).toContainText('3.º puesto')
    await expect(resultado.locator('[data-suplente="4"] [data-prueba="entregar-premio"]')).toBeVisible()

    await page.locator('[data-prueba="cerrar-acta"]').click()
    const acta = page.getByRole('dialog', { name: 'Cerrar acta' })
    await acta.getByRole('textbox').fill('Lic. Marta Sosa, colegiado 9921, 6/9/2026')
    await acta.getByRole('button', { name: 'Cerrar acta' }).click()
    await expect(page.locator('[data-prueba="sorteo-estado"]')).toHaveText('Acta cerrada')
    await expect(page.locator('[data-prueba="acta-hash"]')).toContainText(/[0-9a-f]{64}/)
    const descarga = page.waitForEvent('download')
    await page.locator('[data-prueba="descargar-acta"]').click()
    expect((await descarga).suggestedFilename()).toBe('acta-sorteo-5.pdf')

    const csv = page.waitForEvent('download')
    await page.locator('[data-prueba="exportar-participantes-csv"]').click()
    expect((await csv).suggestedFilename()).toBe('participantes-sorteo-5.csv')
})
