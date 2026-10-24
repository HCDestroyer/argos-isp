import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Pendientes de la prioridad 2, segunda tanda (modo fixtures, escritorio y teléfono): premio y
 * canje de lealtad con su reverso, Telegram del cliente, nodo del portal, conciliación de la
 * pasarela y certificación en lote.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

async function elegir(page: Page, contenedor: Locator, prueba: string, opcion: string | RegExp): Promise<void> {
    await contenedor.locator(`[data-prueba="${prueba}"]`).click()
    await page.getByRole('option', { name: opcion }).first().click()
}

test('lealtad: crear un premio, canjearlo y revertir el canje', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/lealtad/premios')
    await expect(page.locator('[data-prueba="tabla-premios"]')).toContainText('Un mes gratis de internet', { timeout: 15_000 })
    await page.locator('[data-prueba="nuevo-premio"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo premio' })
    await campo(alta, 'premio-nombre').fill('Q10 de descuento')
    await campo(alta, 'premio-costo').fill('10')
    await campo(alta, 'premio-descuento').fill('10')
    await alta.locator('[data-prueba="premio-guardar"]').click()
    await expect(alta).toBeHidden()
    await expect(page.locator('[data-prueba="tabla-premios"]')).toContainText('Q10 de descuento')

    // Sin recargar (los fixtures viven en memoria): a Canjes por el menú.
    await ir(page, 'Canjes', /\/lealtad\/canjes$/)
    await page.locator('[data-prueba="nuevo-canje"]').click()
    const canje = page.getByRole('dialog', { name: 'Canjear puntos' })
    await canje.getByPlaceholder('Nombre, NIT, teléfono, usuario PPP o IP').fill('Juan Carlos')
    await page.getByRole('option', { name: /Juan Carlos Ramírez/ }).first().click()
    await expect(canje.locator('[data-prueba="canje-saldo"]')).toBeVisible()
    await elegir(page, canje, 'canje-servicio', /.+/)
    await elegir(page, canje, 'canje-premio', /Q10 de descuento/)
    await canje.locator('[data-prueba="canje-confirmar"]').click()
    await expect(canje).toBeHidden()
    const fila = page.locator('[data-prueba="tabla-canjes"] tr').filter({ hasText: 'Q10 de descuento' })
    await expect(fila).toContainText('Reservado')
    await fila.getByRole('button', { name: /Revertir el canje/ }).click()
    const revertir = page.getByRole('dialog', { name: 'Revertir canje' })
    await revertir.getByRole('textbox').fill('El cliente prefiere otro premio')
    await revertir.getByRole('button', { name: 'Revertir' }).click()
    await expect(fila).toContainText('Revertido')
})

test('Telegram del cliente y nodo del portal', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/1')
    const telegram = page.locator('[data-prueba="cliente-telegram"]')
    await expect(telegram).toBeVisible({ timeout: 15_000 })
    await telegram.locator('[data-prueba="vincular-telegram"]').click()
    const modal = page.getByRole('dialog', { name: 'Vincular Telegram' })
    await campo(modal, 'telegram-chat-id').fill('123456789')
    await modal.locator('[data-prueba="telegram-vincular"]').click()
    await expect(telegram).toContainText('Vinculado')

    await page.goto('/configuracion/nodos-portal')
    await page.locator('[data-prueba="nuevo-nodo"]').click()
    const nodo = page.getByRole('dialog', { name: 'Nuevo nodo del portal' })
    await campo(nodo, 'nodo-nombre').fill('portal-norte')
    await nodo.locator('[data-prueba="nodo-crear"]').click()
    await expect(page.locator('[data-prueba="valor-Token"]')).toContainText('argn_')
    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(page.locator('[data-nodo="portal-norte"]')).toBeVisible()
})

test('conciliar la pasarela y certificar en lote', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/cobros/pasarela')
    await expect(page.locator('[data-conciliacion="2"]')).toContainText('El monto no coincide', { timeout: 15_000 })
    await page.locator('[data-prueba="conciliar-pasarela"]').click()
    const conciliar = page.getByRole('dialog', { name: 'Conciliar un día' })
    await campo(conciliar, 'conciliar-fecha').fill('2026-10-20')
    await conciliar.locator('[data-prueba="conciliar-confirmar"]').click()
    await expect(conciliar).toBeHidden()
    await expect(page.locator('[data-conciliacion="3"]')).toContainText('Concilia')

    await page.goto('/dte')
    await page.locator('[data-prueba="certificar-lote"]').click()
    const lote = page.getByRole('dialog', { name: 'Certificar en lote' })
    // Con «Todas las empresas» el lote pide elegir una.
    if (await lote.locator('[data-prueba="lote-empresa"]').isVisible()) {
        await elegir(page, lote, 'lote-empresa', 'ArgosNet')
    }
    await campo(lote, 'lote-desde').fill('2026-01-01')
    await campo(lote, 'lote-hasta').fill('2026-12-31')
    await lote.locator('[data-prueba="lote-certificar"]').click()
    await expect(lote.locator('[data-prueba="resultado-lote"]')).toContainText('enviada')
})
