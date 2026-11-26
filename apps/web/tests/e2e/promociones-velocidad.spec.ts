import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Red › Planes (falla del PM, 25 nov 2026, y decisiones 18 y 34), en escritorio y teléfono:
 * - el formulario de un plan se desplaza hasta su último campo y el botón Guardar (la tarjeta se
 *   encogía al alto de la pantalla y recortaba el resto);
 * - promociones de velocidad: crear una gratis con un servicio y otra con precio, asignar
 *   servicios (el 422 «se encima» marca cuál y no asigna ninguno), verla en la ficha del servicio
 *   y cancelarla con motivo.
 */

/** `YYYY-MM-DDTHH:MM` de hoy + `dias` en hora de Guatemala (para un `datetime-local`). */
function localGuatemala(dias: number, hora = '00:00'): string {
    const local = new Date(Date.now() - 6 * 3_600_000 + dias * 86_400_000)
    return `${local.toISOString().slice(0, 10)}T${hora}`
}

/** Baja con la rueda sobre el formulario hasta el final y comprueba que se ve el último campo y Guardar. */
async function bajarHastaElFinal(page: Page, formulario: Locator, ultimoCampo: Locator, guardar: Locator): Promise<void> {
    await expect(ultimoCampo).toBeAttached()
    // La tarjeta no se recorta: todo su contenido cabe en ella (antes se encogía al alto de la pantalla).
    const recortada = await formulario.evaluate(el => el.scrollHeight - el.clientHeight)
    expect(recortada).toBeLessThanOrEqual(1)
    const caja = await formulario.boundingBox()
    await page.mouse.move((caja?.x ?? 0) + 40, (caja?.y ?? 0) + 120)
    // Con la rueda (no con `scrollIntoView`, que mueve aunque el contenedor tenga `overflow: hidden`),
    // de a poco hasta que el último campo quede a la vista. En el teléfono «Así queda» va debajo.
    const alto = page.viewportSize()?.height ?? 0
    for (let i = 0; i < 30; i++) {
        const posicion = await ultimoCampo.boundingBox()
        if (posicion && posicion.y > 0 && posicion.y + posicion.height < alto - 160) {
            break
        }
        await page.mouse.wheel(0, 250)
        await page.waitForTimeout(50)
    }
    await expect(ultimoCampo).toBeInViewport()
    await expect(guardar).toBeInViewport()
    // Guardar no tapa el último campo.
    const campo = await ultimoCampo.boundingBox()
    const boton = await guardar.boundingBox()
    expect((campo?.y ?? 0) + (campo?.height ?? 0)).toBeLessThanOrEqual((boton?.y ?? 0) + 1)
}

test('plan: el formulario nuevo y el de editar se desplazan hasta el último campo y Guardar', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/planes/nuevo')
    const formulario = page.locator('[data-prueba="plan-formulario"]')
    await expect(formulario).toBeVisible({ timeout: 30_000 })
    await bajarHastaElFinal(page, formulario, formulario.getByText('Prefijo delegado IPv6'), page.locator('[data-prueba="guardar-plan"]'))

    await page.goto('/planes/1/editar')
    await expect(formulario).toBeVisible({ timeout: 30_000 })
    await bajarHastaElFinal(page, formulario, formulario.getByText('Prefijo delegado IPv6'), page.locator('[data-prueba="guardar-plan"]'))
})

/** Escribe en el buscador de servicios y marca el resultado de `cliente`. */
async function elegirServicio(contenedor: Locator, buscar: string, codigo: string): Promise<void> {
    await contenedor.locator('[data-prueba="buscar-servicio-promocion"]').fill(buscar)
    await contenedor.getByRole('checkbox', { name: `Elegir ${codigo}` }).click()
}

async function abrirDetalle(page: Page, nombre: string, esTelefono: boolean): Promise<Locator> {
    if (esTelefono) {
        await page.locator('[data-prueba="lista-promociones-movil"]').getByRole('link', { name: new RegExp(nombre) }).click()
        await expect(page).toHaveURL(/\/planes\/promociones\/\d+$/)
    }
    const detalle = page.locator('[data-prueba="detalle-promocion"]')
    await expect(detalle.getByRole('heading', { name: nombre })).toBeVisible()
    return detalle
}

async function accionDetalle(page: Page, detalle: Locator, nombre: string, esTelefono: boolean): Promise<void> {
    if (esTelefono) {
        await page.locator('[data-prueba="barra-telefono"]').getByRole('button', { name: nombre }).click()
        return
    }
    await detalle.getByRole('button', { name: nombre }).click()
}

test('promoción gratis: crear con un servicio, asignar otro (con el 422 que se encima), verla en el servicio y cancelarla', async ({ page }, info) => {
    const esTelefono = info.project.name === 'telefono'
    await entrar(page, 'admin@argos.test')
    await page.goto('/planes/promociones')
    await expect(page.locator('[data-prueba="secciones-planes"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-prueba="pestanas-promociones"]')).toContainText('Vigentes')

    // Nueva promoción en su página.
    if (esTelefono) {
        await page.locator('[data-prueba="barra-telefono"]').getByRole('link', { name: 'Nueva promoción' }).click()
    }
    else {
        await page.locator('[data-prueba="nueva-promocion"]').click()
    }
    const formulario = page.locator('[data-prueba="promocion-formulario"]')
    await expect(formulario.getByRole('heading', { name: 'Nueva promoción de velocidad' })).toBeVisible()
    await formulario.locator('[data-prueba="promocion-nombre"]').fill('Turbo de prueba')
    await formulario.locator('[data-prueba="promocion-inicio"]').fill(localGuatemala(0))
    await formulario.locator('[data-prueba="promocion-fin"]').fill(localGuatemala(10, '23:59'))
    // Apagado = gratis.
    await expect(formulario.locator('[data-prueba="asi-queda-precio"]')).toHaveText('Gratis')
    await elegirServicio(formulario, 'Juan Carlos', 'S-000002')
    await expect(formulario.locator('[data-prueba="servicios-elegidos"]')).toContainText('Juan Carlos Ramírez')
    await formulario.locator('[data-prueba="guardar-promocion"]').click()

    await expect(page.getByText('«Turbo de prueba» creada', { exact: true }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/planes\/promociones\?promocion=\d+/)
    const detalle = await abrirDetalle(page, 'Turbo de prueba', esTelefono)
    await expect(detalle.locator('[data-prueba="precio-promocion"]')).toHaveText('Gratis')
    await expect(detalle.locator('[data-prueba="estado-promocion"]')).toContainText('Aplicada ahora')
    await expect(detalle.locator('[data-prueba="servicios-promocion"]')).toContainText('S-000002')

    // Asignar: «Comercial El Progreso» ya tiene «Gamer nocturno» en esas fechas → 422, no se asigna ninguno.
    await accionDetalle(page, detalle, 'Asignar servicios', esTelefono)
    const ventana = page.getByRole('dialog', { name: /Asignar «Turbo de prueba»/ })
    await elegirServicio(ventana, 'Comercial', 'S-000003')
    await ventana.locator('[data-prueba="confirmar-asignar"]').click()
    await expect(ventana.locator('[data-prueba="falla-asignar"]')).toContainText('Se encima con otra promoción')
    await expect(ventana.locator('[data-prueba="servicio-con-falla"]')).toContainText('Se encima con otra promoción')
    await ventana.getByRole('button', { name: 'Quitar S-000003 de la lista' }).click()
    await elegirServicio(ventana, 'Pedro', 'S-000006')
    await ventana.locator('[data-prueba="confirmar-asignar"]').click()
    await expect(ventana).toBeHidden()
    await expect(page.getByText('Servicio asignado', { exact: true }).first()).toBeVisible()
    await expect(detalle.locator('[data-prueba="servicios-promocion"]')).toContainText('S-000006')

    // En la ficha del servicio, pestaña Promociones.
    await detalle.locator('[data-servicio="6"]').getByRole('link', { name: 'S-000006' }).click()
    await expect(page).toHaveURL(/\/servicios\/6\?pestana=promociones/)
    const pestana = page.locator('[data-prueba="promociones-servicio"]')
    await expect(pestana.locator('[data-prueba="promocion-actual"]')).toContainText('Turbo de prueba', { timeout: 30_000 })
    await expect(pestana.locator('[data-prueba="estado-promocion-servicio"]')).toContainText('Aplicada ahora')
    await page.goBack()

    // Cancelar con motivo: sus servicios vuelven a la velocidad del plan.
    const detalleOtraVez = await abrirDetalle(page, 'Turbo de prueba', false)
    await accionDetalle(page, detalleOtraVez, esTelefono ? 'Cancelar' : 'Cancelar promoción', esTelefono)
    const cancelar = page.getByRole('dialog', { name: /Cancelar «Turbo de prueba»/ })
    await expect(cancelar).toContainText('vuelven a la velocidad de su plan')
    await cancelar.getByRole('textbox').fill('prueba terminada')
    await cancelar.getByRole('button', { name: 'Cancelar promoción' }).click()
    await expect(cancelar).toBeHidden()
    await expect(page.getByText('«Turbo de prueba» cancelada', { exact: true }).first()).toBeVisible()
    if (esTelefono) {
        await expect(detalleOtraVez.locator('[data-prueba="estado-promocion"]')).toHaveText('Cancelada')
    }
    else {
        // La pestaña Vigentes ya no la tiene; está en Canceladas.
        await page.locator('[data-prueba="pestanas-promociones"]').getByRole('tab', { name: /Canceladas/ }).click()
        await expect(page.locator('[data-prueba="tabla-promociones"]')).toContainText('Turbo de prueba')
    }
})

test('promoción con precio y franja diaria: así queda y el detalle con el precio mensual', async ({ page }, info) => {
    const esTelefono = info.project.name === 'telefono'
    await entrar(page, 'admin@argos.test')
    await page.goto('/planes/promociones/nueva')
    const formulario = page.locator('[data-prueba="promocion-formulario"]')
    await expect(formulario.getByRole('heading', { name: 'Nueva promoción de velocidad' })).toBeVisible({ timeout: 30_000 })
    await formulario.locator('[data-prueba="promocion-nombre"]').fill('Noches pagadas')
    await formulario.locator('[data-prueba="promocion-fin"]').fill(localGuatemala(30, '23:59'))
    await formulario.locator('[data-prueba="promocion-modo"]').getByRole('tab', { name: 'Franja diaria' }).click()
    await formulario.getByRole('button', { name: 'sábado' }).click()
    await formulario.getByRole('button', { name: 'domingo' }).click()
    await formulario.getByRole('switch', { name: 'Cobrar la promoción' }).click()
    await formulario.locator('[data-prueba="promocion-precio"]').fill('150')
    await expect(formulario.locator('[data-prueba="asi-queda-precio"]')).toHaveText('Q 150.00 /mes')
    await expect(formulario.locator('[data-prueba="promocion-asi-queda"]')).toContainText('18:00–23:00 · sáb, dom')
    await formulario.locator('[data-prueba="guardar-promocion"]').click()

    await expect(page.getByText('«Noches pagadas» creada', { exact: true }).first()).toBeVisible()
    // Empieza mañana: queda en Programadas.
    await expect(page).toHaveURL(/vigencia=programada/)
    const detalle = await abrirDetalle(page, 'Noches pagadas', esTelefono)
    await expect(detalle.locator('[data-prueba="precio-promocion"]')).toHaveText('Q 150.00 /mes')
    await expect(detalle).toContainText('18:00 a 23:00 · sáb, dom')
})
