import { expect, test } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Sistema → Tareas programadas (tablero `SistemaCrons.dc.html`), escritorio y teléfono: el admin la
 * encuentra en el menú, ve las tareas con su estado y la que necesita atención, abre una, ve su
 * historial y la ejecuta ahora con una confirmación corta. Si la API falla se ve «Reintentar».
 */
test('el admin revisa una tarea atrasada y la ejecuta ahora', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    const lateral = await menu(page)
    await lateral.getByRole('link', { name: 'Tareas programadas' }).click()
    await expect(page).toHaveURL(/\/sistema\/tareas/, { timeout: 30_000 })

    await expect(page.locator('[data-prueba="resumen-tareas"]')).toContainText('2 necesitan atención')
    await expect(page.locator('[data-prueba="aviso-atrasada"]')).toContainText('Vencimiento y mora')
    const fila = page.locator('[data-prueba="tarea-billing.vencer"]')
    await expect(fila).toContainText('Atrasada')
    await fila.click()

    const detalle = page.locator('[data-prueba="detalle-tarea"]')
    await expect(detalle.getByRole('heading', { name: 'Vencimiento y mora' })).toBeVisible()
    await expect(detalle.locator('[data-prueba="historial-corridas"]')).toContainText('18 facturas vencidas, 6 moras aplicadas')
    await expect(detalle.locator('[data-prueba="lock-tarea"]')).toContainText('Libre')

    await page.locator('[data-prueba="ejecutar-tarea"]').click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('¿Ejecutar «Vencimiento y mora» ahora?')
    await dialogo.getByRole('button', { name: 'Ejecutar ahora' }).click()
    await expect(page.getByRole('listitem').getByText('Tarea en cola')).toBeVisible()
    await expect(detalle.locator('[data-prueba="historial-corridas"]')).toContainText('Corrida a pedido')
    await expect(fila).toContainText('Correcta')
})

test('si la API falla se ve el error con «Reintentar», sin tareas inventadas', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(() => localStorage.setItem('argos_fixtures_fallas', JSON.stringify({ 'GET /api/v1/sistema/crons': 500 })))
    await page.goto('/sistema/tareas')
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(page.locator('[data-prueba="lista-tareas"]')).toHaveCount(0)
    await page.evaluate(() => localStorage.removeItem('argos_fixtures_fallas'))
})
