import { expect, test } from '@playwright/test'
import { entrar, verDatosCliente } from './ayudas'

/**
 * Rediseño, fase 2 (tableros NuevoClientes, NuevoClienteFicha y NuevoAltaCliente): contadores que
 * filtran, vista rápida flotante, ficha con franja y pestañas segmentadas, y alta en 3 pasos.
 */

test('lista: los contadores filtran y la vista rápida flota con saldo y Cobrar', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes')
    const contadores = page.locator('[data-prueba="contadores-clientes"]')
    await expect(contadores).toBeVisible()

    // «Suspendidos» filtra por estado y queda marcado; otro clic lo quita.
    const suspendidos = contadores.locator('[data-contador="cortados"]')
    await suspendidos.click()
    await expect(page).toHaveURL(/estado=suspendido/)
    await expect(suspendidos).toHaveAttribute('aria-pressed', 'true')
    await suspendidos.click()
    await expect(page).toHaveURL(/\/clientes$/)

    // «Al día» manda con_deuda_vencida=false (`al_dia=1` en la URL).
    await contadores.locator('[data-contador="al_dia"]').click()
    await expect(page).toHaveURL(/al_dia=1/)
    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    await expect(page).toHaveURL(/\/clientes$/)

    // Vista rápida: clic en la fila (fuera del nombre) y se cierra con Esc.
    await page.getByLabel(/Buscar clientes/).fill('Juan Carlos')
    // Espera a que la búsqueda se aplique (la lista entera tiene más filas).
    await expect(page.locator('tbody tr')).toHaveCount(1)
    const fila = page.locator('tbody tr', { hasText: 'Juan Carlos Ramírez' })
    await fila.locator('td').first().click({ position: { x: 12, y: 12 } })
    const vista = page.getByRole('dialog', { name: /Juan Carlos Ramírez/ })
    await expect(vista).toBeVisible()
    await expect(vista.locator('[data-prueba="vista-saldo"]')).toHaveText('Q 300.00')
    await expect(vista.locator('[data-prueba="vista-estado"]')).toContainText('Suspendido')
    await expect(vista.locator('[data-prueba="vista-cobrar"]')).toContainText('Cobrar Q 300.00')
    await page.keyboard.press('Escape')
    await expect(vista).toBeHidden()
})

test('ficha: franja con saldo, pestañas en la tarjeta, Contactos sin inventar y datos con el ícono', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/2')
    const franja = page.locator('[data-prueba="franja-cliente"]')
    await expect(franja.getByRole('heading', { level: 1, name: 'Juan Carlos Ramírez' })).toBeVisible()
    await expect(franja.locator('[data-prueba="franja-saldo"]')).toHaveText('Q 300.00')
    await expect(page.locator('[data-prueba="aviso-corte"]')).toContainText('suspendido')

    const pestanas = page.locator('[data-prueba="pestanas-cliente"]')
    // Contactos (A1, #281): el titular primero, sus contactos con permisos y agregar uno.
    await pestanas.getByRole('tab', { name: /Contactos/ }).click()
    await expect(page).toHaveURL(/tab=contactos/)
    const contactos = page.locator('[data-prueba="cliente-contactos"]')
    await expect(contactos.locator('li').first()).toContainText('Titular')
    await expect(contactos).toContainText('Luis Ramírez')
    await expect(contactos).toContainText('4444-1234 · WhatsApp')
    await contactos.locator('[data-prueba="agregar-contacto"]').click()
    const panel = page.getByRole('dialog', { name: 'Agregar contacto' })
    await panel.getByLabel('Nombre').fill('Rosa Inquilina Pruebas')
    await panel.getByLabel('Teléfono').fill('5599 1122')
    await panel.getByRole('button', { name: 'Agregar contacto' }).click()
    await expect(panel).toBeHidden()
    await expect(contactos).toContainText('Rosa Inquilina Pruebas')
    await expect(contactos).toContainText('5599-1122 · WhatsApp')

    // Soporte todavía sin API: lo dice, sin datos inventados.
    await pestanas.getByRole('tab', { name: /Soporte/ }).click()
    await expect(page.locator('[data-prueba="seccion-sin-api"]')).toContainText('en cuanto la API los entregue')

    await verDatosCliente(page)
    await expect(page).toHaveURL(/datos=1/)
    await expect(page.locator('[data-prueba="datos-cliente"]')).toContainText('Datos fiscales')

    // Teléfono: la barra fija de abajo con «Cobrar Q …».
    if (page.viewportSize()!.width < 640) {
        await expect(page.locator('[data-prueba="barra-cobro-cliente"]')).toContainText('Cobrar Q 300.00')
    }
})

test('alta en 3 pasos: el cliente se crea y sigue al servicio con el progreso arriba', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/nuevo')
    const alta = page.locator('[data-prueba="alta-cliente"]')
    await expect(alta.getByRole('heading', { level: 1, name: 'Nuevo cliente' })).toBeVisible()
    await expect(alta.locator('[data-prueba="aviso-prospecto"]').getByRole('button', { name: 'Registrar prospecto' })).toBeDisabled()

    await page.getByLabel('Nombre', { exact: true }).fill('Marta Tres Pasos')
    await page.getByLabel('Teléfono').fill('5512 7788')
    await page.locator('[data-prueba="alta-siguiente"]').click()

    // Paso 2: el alta de servicio con el cliente ya elegido; el resumen de abajo lo nombra.
    await expect(alta.getByRole('heading', { name: '¿Qué servicio va a tener?' })).toBeVisible()
    await expect(alta.locator('[data-prueba="linea-resumen-alta"]')).toContainText('Marta Tres Pasos')
    if (page.viewportSize()!.width >= 640) {
        await expect(alta.locator('[data-prueba="progreso-alta"] [aria-current="step"]')).toHaveText(/Servicio/)
    }
    else {
        await expect(alta).toContainText('Paso 2 de 3 · Servicio')
    }
})
