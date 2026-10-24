import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Pantallas pendientes de la prioridad 2 (modo fixtures, escritorio y teléfono): plantillas de
 * avisos, plan temporal en la ficha del servicio, router nuevo con su direccionamiento IPv4/IPv6 y
 * la implementación de un plan en un router.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"], [data-prueba="${prueba}"] textarea, textarea[data-prueba="${prueba}"]`).first()
}

async function elegir(page: Page, contenedor: Locator, prueba: string, opcion: string | RegExp): Promise<void> {
    await contenedor.locator(`[data-prueba="${prueba}"]`).click()
    await page.getByRole('option', { name: opcion }).first().click()
}

test('plantilla de aviso: insertar una variable y guardar', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/notificaciones')
    const fila = page.locator('[data-aviso="factura.emitida/correo"]')
    await expect(fila).toBeVisible({ timeout: 15_000 })
    await page.locator('tr').filter({ has: fila }).getByRole('button', { name: /Editar Factura emitida por Correo/ }).click()
    const editor = page.getByRole('dialog', { name: 'Factura emitida' })
    const cuerpo = campo(editor, 'aviso-cuerpo')
    await cuerpo.fill('Hola ')
    await editor.getByRole('button', { name: 'Insertar cliente.nombre' }).click()
    await expect(cuerpo).toHaveValue('Hola {{cliente.nombre}}')
    await editor.locator('[data-prueba="aviso-guardar"]').click()
    await expect(editor).toBeHidden()
    await expect(page.getByText('Plantilla guardada', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Recordatorios' }).click()
    await expect(page.locator('[data-recordatorio="1"]')).toContainText('3 días antes del vencimiento')
    await page.getByRole('tab', { name: 'Envíos' }).click()
    await expect(page.locator('[data-envio="3"]')).toBeVisible()
    await page.locator('[data-prueba="ver-envio-3"]').click()
    await expect(page.locator('[data-prueba="detalle-envio"]')).toContainText('bot was blocked by the user')
})

test('plan temporal: programar una mejora y cancelarla', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    const seccion = page.locator('[data-prueba="planes-temporales"]')
    await expect(seccion).toBeVisible({ timeout: 15_000 })
    await seccion.locator('[data-prueba="programar-plan-temporal"]').click()
    const modal = page.getByRole('dialog', { name: 'Programar mejora de plan' })
    await elegir(page, modal, 'plan-temporal-plan', /.+/)
    await campo(modal, 'plan-temporal-dias').fill('7')
    await modal.locator('[data-prueba="plan-temporal-guardar"]').click()
    await expect(modal).toBeHidden()
    await expect(seccion.locator('[data-plan-temporal]')).toHaveCount(1)
    await expect(seccion).toContainText('Activo')
    await seccion.getByRole('button', { name: /Cancelar el plan temporal/ }).click()
    const cancelar = page.getByRole('dialog', { name: 'Cancelar plan temporal' })
    await cancelar.getByRole('textbox').fill('El cliente pidió quitarla')
    await cancelar.getByRole('button', { name: 'Cancelar plan temporal' }).click()
    await expect(seccion).toContainText('Cancelado')
})

test('router nuevo con red IPv4, bloque y pool IPv6; plan implementado en él', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="nuevo-router"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo router' })
    await campo(alta, 'router-nombre').fill('RB-Norte')
    await campo(alta, 'router-host').fill('10.40.0.1')
    await campo(alta, 'router-nas').fill('10.40.0.1')
    await alta.locator('[data-prueba="router-guardar"]').click()
    await expect(page).toHaveURL(/\/routers\/\d+$/)
    const routerId = page.url().split('/').pop()

    const direccionamiento = page.locator('[data-prueba="router-direccionamiento"]')
    await direccionamiento.locator('[data-prueba="agregar-red"]').click()
    let modal = page.getByRole('dialog', { name: 'Agregar red IPv4' })
    await campo(modal, 'red-cidr').fill('100.64.40.0/24')
    await modal.locator('[data-prueba="direccionamiento-guardar"]').click()
    await expect(direccionamiento.locator('[data-prueba="redes-router"]')).toContainText('100.64.40.0/24')

    await direccionamiento.locator('[data-prueba="agregar-bloque"]').click()
    modal = page.getByRole('dialog', { name: 'Agregar bloque IPv6' })
    await campo(modal, 'bloque-prefijo').fill('2803:d100:4000::/40')
    await modal.locator('[data-prueba="direccionamiento-guardar"]').click()
    const bloque = direccionamiento.locator('[data-bloque]').filter({ hasText: '2803:d100:4000::/40' })
    await expect(bloque).toBeVisible()
    await bloque.getByRole('button', { name: /Agregar pool/ }).click()
    modal = page.getByRole('dialog', { name: /Pool en 2803:d100:4000::\/40/ })
    await campo(modal, 'pool-prefijo').fill('2803:d100:4080::/41')
    await modal.locator('[data-prueba="direccionamiento-guardar"]').click()
    await expect(bloque).toContainText('Delegación · /56')

    // Sin `page.goto`: recargar reinicia los fixtures y el router nuevo desaparecería.
    await ir(page, 'Planes', /\/planes$/)
    await page.locator('a[href="/planes/1"]').first().click()
    const implementacion = page.locator('[data-prueba="plan-routers"]')
    await expect(implementacion.locator('[data-implementacion="1"]')).toBeVisible({ timeout: 15_000 })
    await implementacion.locator('[data-prueba="implementar-plan"]').click()
    const formulario = page.getByRole('dialog', { name: /Implementar/ })
    await elegir(page, formulario, 'plan-router-router', 'RB-Norte')
    await campo(formulario, 'plan-router-profile').fill('argos-norte')
    await formulario.locator('[data-prueba="plan-router-guardar"]').click()
    await expect(implementacion.locator(`[data-implementacion="${routerId}"]`)).toContainText('profile argos-norte')
})
