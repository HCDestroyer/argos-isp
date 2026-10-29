import { expect, test } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Control de velocidad por capas y «Sincronizar plan» (`contratos/control-velocidad.md`), en
 * escritorio y teléfono: el editor deshabilita lo que no combina con el porqué, la vista previa sale
 * antes de aplicar, «Reconectar ahora» pide confirmación y el plan se sincroniza con su resumen.
 */
test('router: editar por capas, revisar la vista previa y aplicar con «Reconectar ahora» confirmado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="velocidad-router-1"]').click({ timeout: 30_000 })
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
    await page.goto('/routers')
    await page.locator('[data-prueba="velocidad-router-2"]').click({ timeout: 30_000 })
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

test('plan: «Sincronizar plan» con el resumen por router; el router sin API dice «Solo RADIUS»', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/planes/1')
    await page.locator('[data-prueba="sincronizar-plan"]').click()
    const modal = page.getByRole('dialog', { name: /Sincronizar/ })
    await modal.locator('[data-prueba="sincronizar-confirmar"]').click()
    const resumen = modal.locator('[data-prueba="sincronizar-resumen"]')
    await expect(resumen).toContainText('Plan sincronizado')
    await expect(modal.locator('tr', { has: page.locator('[data-router="1"]') })).toContainText('Al día')
    await expect(modal.locator('[data-prueba="sin-api-3"]')).toContainText('Solo RADIUS')
})

test('conexión: probar el corte, ver el paso a seguir y «Reconciliar ahora» con vista previa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="conexion-router-1"]').click({ timeout: 30_000 })
    const panel = page.getByRole('dialog', { name: /Conexión · RB-Centro/ })
    await panel.locator('[data-prueba="probar-corte"]').click()
    await expect(panel.locator('[data-prueba="corte-faltan_reglas"]')).toContainText('Faltan las reglas de corte')
    await expect(panel.locator('[data-prueba="corte-faltan_reglas"]')).toContainText('Paso a seguir')
    await panel.locator('[data-prueba="corte-reconciliar"]').click()

    const modal = page.getByRole('dialog', { name: /Reconciliar ahora · RB-Centro/ })
    await expect(modal.locator('[data-prueba="reconciliar-grupo-corte"]')).toContainText('argosisp:top corte')
    await modal.locator('[data-prueba="reconciliar-confirmar"]').click()
    await expect(modal.locator('[data-prueba="reconciliar-resultado"]')).toContainText('objetos corregidos')
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await expect(panel.locator('[data-prueba="corte-ok"]')).toContainText('El corte está listo')
})

test('conexión: el router que no llega al portal muestra qué revisar', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/routers')
    await page.locator('[data-prueba="conexion-router-2"]').click({ timeout: 30_000 })
    const panel = page.getByRole('dialog', { name: /Conexión · CCR-Mixco/ })
    await panel.locator('[data-prueba="probar-corte"]').click()
    await expect(panel.locator('[data-prueba="corte-portal_inalcanzable"]')).toContainText('El router no llega al portal')
    await expect(panel.locator('[data-prueba="corte-portal_inalcanzable"]')).toContainText('«Reconciliar ahora» no lo arregla')
    await expect(panel.locator('[data-prueba="corte-reconciliar"]')).toHaveCount(0)
})
