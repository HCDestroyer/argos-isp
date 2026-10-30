import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Prioridad por clases (QoS, `contratos/qos.md`), en escritorio y teléfono: crear una clase en el
 * perfil predeterminado, prender `qos` en un router con árbol de colas (vista previa y aplicar) y ver
 * que en un router de colas simples el interruptor está deshabilitado con el porqué de la matriz.
 */
test('perfil: crear una clase con sus reglas y verla en la tabla', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Prioridad (QoS)', /\/red\/qos$/)
    await expect(page.locator('[data-prueba="qos-ayuda"]')).toContainText('La prioridad actúa cuando el plan o el router se llenan')
    await page.locator('[data-prueba="perfil-qos-1"]').click()
    await expect(page).toHaveURL(/\/red\/qos\/1$/)
    await expect(page.locator('[data-advertencia="tope_por_cliente"]')).toBeVisible()

    await page.locator('[data-prueba="nueva-clase"]').click()
    const modal = page.getByRole('dialog', { name: 'Nueva clase' })
    await modal.locator('[data-prueba="clase-nombre"]').fill('Juegos')
    await modal.locator('[data-prueba="regla-protocolo-0"]').click()
    await page.getByRole('option', { name: 'UDP' }).click()
    // Un puerto fuera de rango se marca junto a su campo antes de enviar.
    await modal.locator('[data-prueba="regla-puertos-destino-0"]').fill('70000')
    await modal.locator('[data-prueba="guardar-clase"]').click()
    await expect(modal).toContainText('«70000» fuera de 1–65535 o rango invertido')
    await modal.locator('[data-prueba="regla-puertos-destino-0"]').fill('3074,27000-27050')
    await modal.locator('[data-prueba="guardar-clase"]').click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('Clase Juegos creada', { exact: true })).toBeVisible()
    const fila = page.locator('[data-prueba="tabla-clases"] tr', { has: page.locator('[data-clase="Juegos"]') })
    await expect(fila).toContainText('Activa')
    await expect(fila).toContainText('UDP destino 3074,27000-27050')
})

test('router con árbol: prender QoS en el control de velocidad, revisar y aplicar', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="acciones-router-4"]').click({ timeout: 30_000 })
    await page.getByRole('menuitem', { name: /Control de velocidad/ }).click()
    const panel = page.getByRole('dialog', { name: /Velocidad · RB-Centro PCQ/ })
    await panel.locator('[data-prueba="abrir-cambio-control"]').click()

    const modal = page.getByRole('dialog', { name: /Control de velocidad · RB-Centro PCQ/ })
    const qos = modal.locator('[data-extra="qos"]').getByRole('switch')
    await expect(qos).toBeEnabled()
    await qos.click()
    // En el árbol los tipos de un plan comparten la rama: QoS va igual en todos (regla 6 de la matriz).
    await modal.locator('[data-prueba="igual-para-todos"]').click()
    await modal.locator('[data-prueba="revisar-estrategia"]').click()
    await expect(modal.locator('[data-prueba="vista-previa-estrategia"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="previa-crear"]')).toContainText('argosisp:qos:entrada')
    await modal.locator('[data-prueba="aplicar-estrategia"]').click()
    await expect(modal).toBeHidden()
    await expect(page.getByText('RB-Centro PCQ: control de velocidad cambiado', { exact: true })).toBeVisible()
    await expect(panel.locator('[data-prueba="control-actual"] [data-tipo="pppoe"]')).toContainText('QoS por clases')
})

test('router simple: QoS deshabilitado con el porqué de la matriz; la ficha dice qué perfil usa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="acciones-router-1"]').click({ timeout: 30_000 })
    await page.getByRole('menuitem', { name: /Control de velocidad/ }).click()
    await page.getByRole('dialog', { name: /Velocidad · RB-Centro$/ }).locator('[data-prueba="abrir-cambio-control"]').click()
    const modal = page.getByRole('dialog', { name: /Control de velocidad · RB-Centro$/ })
    const extra = modal.locator('[data-extra="qos"]')
    await expect(extra.getByRole('switch')).toBeDisabled()
    await expect(extra).toContainText('No disponible: RADIUS por sesión no tiene hojas por clase: qos (prioridad por clases) solo con arbol_pcq.')

    await page.goto('/routers/1')
    const seccion = page.locator('[data-prueba="router-qos"]')
    await expect(seccion.locator('[data-prueba="qos-perfil-router"]')).toHaveText('Predeterminado')
    await expect(seccion.locator('[data-prueba="qos-estado-router"]')).toContainText('Apagado')
})
