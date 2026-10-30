import { expect, test } from '@playwright/test'
import { entrar, ir } from './ayudas'

/**
 * Conexión del router por WireGuard (`contratos/conexion-routers.md`), en escritorio y teléfono:
 * la ficha muestra el túnel, «Probar conexión» lista los chequeos, «Reconciliar ahora» avisa que se
 * encoló, el script se genera con sus pasos y avisa que lleva claves, y editar guarda la zona.
 */
test('probar conexión, reconciliar, script de conexión y zona del router', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro', exact: true }).click()
    await expect(page).toHaveURL(/\/routers\/1$/)

    const conexion = page.locator('[data-prueba="conexion-router"]')
    await expect(conexion.locator('[data-prueba="estado-tunel"]')).toHaveText('Conectado')
    await expect(conexion).toContainText('10.255.0.2')

    // Probar conexión: cada chequeo con su estado y los datos del equipo.
    await page.locator('[data-prueba="acciones-router-1"]').click()
    await page.getByRole('menuitem', { name: /Probar conexión/ }).click()
    let modal = page.getByRole('dialog', { name: /Probar conexión/ })
    // RB-Centro todavía no tiene las reglas de corte (A2): ese es el único chequeo que falla.
    await expect(modal.locator('[data-prueba="prueba-resumen"]')).toContainText('Un chequeo falló')
    await expect(modal.locator('[data-chequeo="corte"] [data-prueba="corte-limites"]')).toContainText('HTTPS (443) no se redirige')
    await expect(modal.locator('[data-prueba="prueba-equipo"]')).toContainText('RB5009UG+S+')
    await expect(modal.locator('[data-chequeo="radius"]')).toContainText('secreto no verificado')
    await modal.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect(modal).toBeHidden()

    // Reconciliar ahora: vista previa, confirmar y 202 (se avisa que quedó encolado).
    await page.locator('[data-prueba="acciones-router-1"]').click()
    await page.getByRole('menuitem', { name: /Reconciliar ahora/ }).click()
    modal = page.getByRole('dialog', { name: /Reconciliar ahora · RB-Centro/ })
    await expect(modal.locator('[data-prueba="reconciliar-grupo-corte"]')).toBeVisible()
    await modal.locator('[data-prueba="reconciliar-confirmar"]').click()
    await expect(modal.locator('[data-prueba="reconciliar-encolado"]')).toContainText('Reconciliando RB-Centro')
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
    await expect(modal).toBeHidden()

    // Script de conexión: avisa que lleva claves, se genera y trae los pasos.
    await conexion.locator('[data-prueba="abrir-script"]').click()
    modal = page.getByRole('dialog', { name: /Script de conexión/ })
    await expect(modal).toContainText('El script lleva claves')
    await modal.locator('[data-prueba="script-admin"] input, input[data-prueba="script-admin"]').first().fill('190.56.10.20')
    await modal.locator('[data-prueba="script-generar"]').click()
    await expect(modal.locator('[data-prueba="script-listo"]')).toBeVisible()
    await expect(modal.locator('[data-prueba="script-pasos"]')).toContainText('New Terminal')
    const descarga = page.waitForEvent('download')
    await modal.locator('[data-prueba="script-descargar"]').click()
    expect((await descarga).suggestedFilename()).toBe('argosisp-conexion.rsc')
    await modal.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect(modal).toBeHidden()

    // Editar: la zona del router, con el aviso del túnel.
    await page.locator('[data-prueba="editar-router"]').click()
    modal = page.getByRole('dialog', { name: /Editar RB-Centro/ })
    await expect(modal.locator('[data-prueba="aviso-tunel"]')).toContainText('10.255.0.2')
    await modal.locator('[data-prueba="router-zona"]').click()
    await page.getByRole('option', { name: 'San Lucas' }).click()
    await modal.locator('[data-prueba="router-editar-guardar"]').click()
    await expect(modal).toBeHidden()
})

test('router sin secreto RADIUS: el script explica qué falta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    // RB-Bodega es el router de respaldo, inactivo: se lista en «Inactivos» (`contratos/eliminar.md`).
    await page.locator('[data-prueba="vista-routers"]').getByRole('tab', { name: 'Inactivos' }).click()
    await expect(page).toHaveURL(/vista=inactivos/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: /RB-Bodega/ }).click()
    const conexion = page.locator('[data-prueba="conexion-router"]')
    await expect(conexion.locator('[data-prueba="estado-tunel"]')).toHaveText('Sin configurar')
    await conexion.locator('[data-prueba="abrir-script"]').click()
    const modal = page.getByRole('dialog', { name: /Script de conexión/ })
    await modal.locator('[data-prueba="script-generar"]').click()
    await expect(modal.locator('[data-prueba="problema-pools"]')).toContainText('Falta el secreto RADIUS del router')
})

test('router sin certificado en www-ssl: explica la causa, comandos para copiar y detalle técnico plegado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Routers', /\/routers$/)
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: /CCR-Mixco/ }).click()
    await expect(page).toHaveURL(/\/routers\/2$/)
    await page.locator('[data-prueba="acciones-router-2"]').click()
    await page.getByRole('menuitem', { name: /Probar conexión/ }).click()
    const modal = page.getByRole('dialog', { name: /Probar conexión/ })
    const api = modal.locator('[data-chequeo="api"]')
    await expect(api).toContainText('El router no tiene certificado en www-ssl')
    await expect(api.locator('[data-prueba="comandos-routeros"]')).toContainText('/ip service set www-ssl certificate=argosisp-api disabled=no')
    await expect(api.locator('[data-prueba="copiar-comandos"]')).toBeVisible()
    await expect(api).not.toContainText('SSL alert number 40')
    await api.locator('[data-prueba="abrir-detalle-tecnico"]').click()
    await expect(api.locator('[data-prueba="detalle-tecnico"]')).toContainText('SSL alert number 40')
})

test('ficha del servicio: «Sincronizar con el router» muestra lo corregido y luego que ya estaba bien', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    await page.locator('[data-prueba="abrir-sincronizar-router"]').click()
    const modal = page.getByRole('dialog', { name: /Sincronizar con el router/ })
    await modal.locator('[data-prueba="sincronizar-router-confirmar"]').click()
    await expect(modal.locator('[data-prueba="sincronizar-cambios"]')).toContainText('/queue/simple')
    await modal.locator('[data-prueba="sincronizar-router-confirmar"]').click()
    await expect(modal.locator('[data-prueba="sincronizar-al-dia"]')).toContainText('Ya estaba sincronizado')
})
