import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Control de velocidad por capas y «Sincronizar plan» (`contratos/control-velocidad.md`), en
 * escritorio y teléfono: el editor deshabilita lo que no combina con el porqué, la vista previa sale
 * antes de aplicar, «Reconectar ahora» pide confirmación y el plan se sincroniza con su resumen.
 */
test('router: editar por capas, revisar la vista previa y aplicar con «Reconectar ahora» confirmado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="velocidad-router-1"]').click()
    const panel = page.getByRole('dialog', { name: /Velocidad · RB-Centro/ })
    await expect(panel.locator('[data-prueba="control-actual"] [data-tipo="pppoe"]')).toContainText('RADIUS por sesión · Por plan · Por defecto')
    await panel.locator('[data-prueba="abrir-cambio-control"]').click()

    const modal = page.getByRole('dialog', { name: /Control de velocidad · RB-Centro/ })
    const tipoCola = modal.locator('[data-prueba="capa-tipo-cola"]')
    // PCQ no sirve en la cola de un solo cliente: se ve deshabilitado con el porqué.
    await expect(tipoCola.getByRole('radio', { name: 'PCQ' })).toBeDisabled()
    await expect(tipoCola).toContainText('No disponible: PCQ reparte entre varios clientes')
    await expect(modal.locator('[data-prueba="revisar-estrategia"]')).toBeDisabled()
    await tipoCola.getByRole('radio', { name: 'CAKE' }).click()
    await modal.locator('[data-prueba="revisar-estrategia"]').click()

    await expect(modal.locator('[data-prueba="vista-previa-estrategia"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="previa-crear"]')).toContainText('argosisp-cake')
    await modal.locator('[data-prueba="abrir-avanzadas"]').click()
    await modal.getByRole('checkbox', { name: 'Reconectar ahora' }).click()
    await expect(modal.locator('[data-prueba="aviso-reconectar"]')).toContainText('Se desconectarán')
    await expect(modal.locator('[data-prueba="aplicar-estrategia"]')).toBeDisabled()
    await modal.getByRole('checkbox', { name: /Entiendo que esos clientes/ }).click()
    await modal.locator('[data-prueba="aplicar-estrategia"]').click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('RB-Centro: control de velocidad cambiado', { exact: true })).toBeVisible()
    await expect(panel.locator('[data-prueba="control-actual"] [data-tipo="pppoe"]')).toContainText('CAKE')
})

test('router con RouterOS 6: CAKE y fq_codel deshabilitados con el porqué', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="velocidad-router-2"]').click()
    await page.getByRole('dialog', { name: /Velocidad · CCR-Mixco/ }).locator('[data-prueba="abrir-cambio-control"]').click()
    const modal = page.getByRole('dialog', { name: /Control de velocidad · CCR-Mixco/ })
    // CCR-Mixco usa árbol con PCQ (solo PCQ); con RADIUS por sesión queda la regla de la versión.
    await modal.locator('[data-prueba="capa-aplicacion"]').getByRole('radio', { name: 'RADIUS por sesión' }).click()
    const tipoCola = modal.locator('[data-prueba="capa-tipo-cola"]')
    await expect(tipoCola.getByRole('radio', { name: 'SFQ' })).toBeEnabled()
    await expect(tipoCola.getByRole('radio', { name: 'CAKE' })).toBeDisabled()
    await expect(tipoCola.getByRole('radio', { name: 'fq_codel' })).toBeDisabled()
    await expect(tipoCola).toContainText('Requiere RouterOS 7; este router tiene 6.49.10 (long-term).')
})

test('plan: «Sincronizar plan» con el resumen por router y el router caído con su error', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/planes/1')
    await page.locator('[data-prueba="sincronizar-plan"]').click()
    const modal = page.getByRole('dialog', { name: /Sincronizar/ })
    await modal.locator('[data-prueba="sincronizar-confirmar"]').click()
    const resumen = modal.locator('[data-prueba="sincronizar-resumen"]')
    await expect(resumen).toContainText('un router con error')
    await expect(modal.locator('tr', { has: page.locator('[data-router="1"]') })).toContainText('Al día')
    await expect(modal.locator('tr', { has: page.locator('[data-router="3"]') })).toContainText('no respondió')
    await expect(modal.locator('[data-prueba="reintentar-router-3"]')).toBeVisible()
})
