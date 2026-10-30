import { expect, test, type Locator } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Pools editables y migrables (`contratos/pools.md`), en escritorio y teléfono: la ficha del router
 * muestra la ocupación, se edita el rango de una red, un pool nuevo sugiere un prefijo libre con su
 * vista previa y mover la red a otro router se revisa (simulación) antes de confirmar.
 */
function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

test('editar, sugerir y mover pools del router', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro', exact: true }).click()
    const direccionamiento = page.locator('[data-prueba="router-direccionamiento"]')
    await expect(direccionamiento.locator('[data-prueba="ocupacion-red-1"]')).toContainText('Con espacio')
    await expect(direccionamiento.locator('[data-prueba="entrega-pool-2"]')).toContainText('256 redes /64')

    // Editar el rango de la red: lo de fuera queda reservado.
    await direccionamiento.locator('[data-prueba="editar-red-2"]').click()
    let modal = page.getByRole('dialog', { name: /Editar red 100\.64\.11\.0\/24/ })
    await modal.getByLabel('Nombre').fill('Clientes PPPoE')
    await modal.getByLabel('Rango: primera IP').fill('100.64.11.10')
    await modal.getByLabel('Rango: última IP').fill('100.64.11.100')
    await modal.locator('[data-prueba="red-guardar"]').click()
    await expect(modal).toBeHidden()
    await expect(direccionamiento.locator('[data-red="2"]')).toContainText('entrega 100.64.11.10 – 100.64.11.100')
    await expect(direccionamiento.locator('[data-prueba="ocupacion-red-2"]')).toContainText('reservadas')

    // Pool nuevo: «Sugerir» toma un prefijo libre y la vista previa dice qué entrega.
    await direccionamiento.locator('[data-prueba="agregar-pool-1"]').click()
    modal = page.getByRole('dialog', { name: /Agregar pool en 2803:d100:1000::\/40/ })
    await modal.locator('[data-prueba="pool-sugerir"]').click()
    await expect(campo(modal, 'pool-prefijo')).toHaveValue('2803:d100:1040::/42')
    await expect(modal.locator('[data-prueba="pool-vista-previa"]')).toContainText('Caben 16,384 clientes')
    await modal.locator('[data-prueba="pool-guardar"]').click()
    await expect(modal).toBeHidden()
    await expect(direccionamiento.locator('[data-bloque="1"]')).toContainText('2803:d100:1040::/42')

    // Mover la red a otro router: primero se revisa qué servicios pasan.
    await direccionamiento.locator('[data-prueba="migrar-red-2"]').click()
    modal = page.getByRole('dialog', { name: /Mover la red 100\.64\.11\.0\/24/ })
    await modal.locator('[data-prueba="migrar-destino"]').click()
    await page.getByRole('option', { name: /CCR-Mixco/ }).first().click()
    await modal.locator('[data-prueba="migrar-revisar"]').click()
    await expect(modal.locator('[data-prueba="migrar-simulacion"]')).toContainText('todavía no se guardó nada')
    await modal.locator('[data-prueba="migrar-confirmar"]').click()
    await expect(modal).toBeHidden()
    await expect(direccionamiento.locator('[data-red="2"]')).toHaveCount(0)
})
