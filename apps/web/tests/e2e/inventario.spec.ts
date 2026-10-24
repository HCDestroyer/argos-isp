import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Inventario interno (modo fixtures, escritorio y teléfono): consumo desde existencias, alta de
 * producto y de la bodega de un técnico, conteo con faltante y equipos en comodato del servicio.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"], [data-prueba="${prueba}"] textarea, textarea[data-prueba="${prueba}"]`).first()
}

async function elegir(page: Page, contenedor: Locator, prueba: string, opcion: string | RegExp): Promise<void> {
    await contenedor.locator(`[data-prueba="${prueba}"]`).click()
    await page.getByRole('option', { name: opcion }).first().click()
}

test('existencias: registrar un consumo de cable al costo promedio', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario')
    const fila = page.locator('[data-existencia="1/1"]')
    await expect(fila).toContainText('Cable UTP Cat6', { timeout: 15_000 })
    await page.locator('[data-prueba="inventario-registrar"]').click()
    await page.getByRole('menuitem', { name: 'Consumo' }).click()
    const modal = page.getByRole('dialog', { name: 'Consumo' })
    await elegir(page, modal, 'mov-producto', /Cable UTP Cat6/)
    await elegir(page, modal, 'mov-bodega', 'Bodega central')
    await expect(modal.locator('[data-prueba="mov-existencia"]')).toContainText('Hay 280 metro')
    await campo(modal, 'mov-cantidad').fill('10')
    await campo(modal, 'mov-motivo').fill('Instalación en Mixco')
    await modal.locator('[data-prueba="mov-confirmar"]').click()
    await expect(modal).toBeHidden()
    await expect(page.locator('[data-prueba="tabla-existencias"]')).toContainText('270 metro')
})

test('productos y bodegas: alta de un producto por serie y de la bodega de un técnico', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario/productos')
    await expect(page.locator('[data-prueba="tabla-productos"]')).toContainText('ONU Huawei HG8145', { timeout: 15_000 })
    await page.locator('[data-prueba="nuevo-producto"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo producto' })
    await campo(alta, 'producto-sku').fill('ANT-LBE5')
    await campo(alta, 'producto-nombre').fill('Antena LiteBeam 5AC')
    await elegir(page, alta, 'producto-tipo', 'Equipo')
    await elegir(page, alta, 'producto-seguimiento', 'Por serie')
    await alta.locator('[data-prueba="producto-guardar"]').click()
    await expect(alta).toBeHidden()
    await expect(page.locator('[data-producto="ANT-LBE5"]')).toContainText('Antena LiteBeam 5AC')

    await ir(page, 'Bodegas', /\/inventario\/bodegas$/)
    await page.locator('[data-prueba="nueva-bodega"]').click()
    const bodega = page.getByRole('dialog', { name: 'Nueva bodega' })
    await campo(bodega, 'bodega-nombre').fill('Pickup de Pedro')
    await elegir(page, bodega, 'bodega-tipo', 'Técnico')
    await elegir(page, bodega, 'bodega-tecnico', /Pedro Técnico/)
    await bodega.locator('[data-prueba="bodega-guardar"]').click()
    await expect(bodega).toBeHidden()
    await expect(page.locator('[data-bodega="Pickup de Pedro"]')).toContainText('Solo la mueve Pedro Técnico')
})

test('conteo físico: capturar con faltante y cerrar con la diferencia valorizada', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario/conteos')
    await expect(page.locator('[data-prueba="tabla-conteos"]')).toContainText('Conteo #1', { timeout: 15_000 })
    await page.locator('[data-prueba="abrir-conteo"]').click()
    const abrir = page.getByRole('dialog', { name: 'Abrir conteo' })
    await elegir(page, abrir, 'conteo-bodega', 'Bodega central')
    await abrir.locator('[data-prueba="conteo-abrir-confirmar"]').click()
    await expect(page).toHaveURL(/\/inventario\/conteos\/2$/)
    await elegir(page, page.locator('body'), 'captura-producto', /Conector RJ45/)
    await campo(page.locator('body'), 'captura-contado').fill('36')
    await page.locator('[data-prueba="captura-guardar"]').click()
    await expect(page.locator('[data-linea="CON-RJ45"]')).toBeVisible()
    await expect(page.locator('[data-prueba="conteo-faltante"]')).toContainText('Q 5.00')
    await page.locator('[data-prueba="conteo-cerrar"]').click()
    const cierre = page.getByRole('dialog', { name: 'Cerrar conteo' })
    await expect(cierre.locator('[data-prueba="cierre-resumen"]')).toContainText('Q 5.00')
    await cierre.locator('[data-prueba="cierre-confirmar"]').click()
    await expect(page.locator('[data-prueba="conteo-estado"]')).toHaveText('Cerrado')
})

test('servicio: asignar un equipo en comodato y devolverlo a reparación', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    const equipos = page.locator('[data-prueba="servicio-equipos"]')
    await expect(equipos).toContainText('HWTC1A2B3C01', { timeout: 15_000 })
    await equipos.locator('[data-prueba="asignar-equipo"]').click()
    const asignar = page.getByRole('dialog', { name: 'Asignar equipo en comodato' })
    await campo(asignar, 'asignar-buscar').fill('C02')
    await elegir(page, asignar, 'asignar-unidad', /HWTC1A2B3C02/)
    await asignar.locator('[data-prueba="asignar-confirmar"]').click()
    await expect(asignar).toBeHidden()
    const fila = equipos.locator('tr').filter({ hasText: 'HWTC1A2B3C02' })
    await expect(fila).toBeVisible()
    await fila.getByRole('button', { name: /Devolver HWTC1A2B3C02/ }).click()
    const devolver = page.getByRole('dialog', { name: /Devolver HWTC1A2B3C02/ })
    await elegir(page, devolver, 'devolver-bodega', 'Bodega central')
    await devolver.locator('[data-prueba="devolver-reparacion"]').click()
    await devolver.locator('[data-prueba="devolver-confirmar"]').click()
    await expect(devolver).toBeHidden()
    await expect(equipos.locator('tr').filter({ hasText: 'HWTC1A2B3C02' })).toHaveCount(0)
})

test('cajero: ve el inventario pero no registra movimientos', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await ir(page, 'Existencias', /\/inventario$/)
    await expect(page.locator('[data-existencia="1/1"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-prueba="inventario-registrar"]')).toHaveCount(0)
})
