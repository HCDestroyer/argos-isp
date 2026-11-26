import { expect, test, type Page } from '@playwright/test'
import { elegirEmpresa, entrar } from './ayudas'

/**
 * Configuración › Integraciones › SmartOLT (varias instancias) y ACS por separado (tableros
 * PendSmartoltLista, PendSmartoltDetalle, PendSmartoltForm, PendAcs y sus versiones de teléfono),
 * contra los fixtures fieles a la API. Escritorio (1280) y teléfono (390), claro y oscuro.
 */

function aviso(page: Page, texto: string) {
    return page.getByRole('listitem').getByText(texto).first()
}

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-smartolt/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
        const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(ancho, `${nombre} en ${tema} no se desborda`).toBeLessThanOrEqual(0)
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

test('SmartOLT: alta de una instancia, probar, ver y ligar sus OLT y apagarla', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await elegirEmpresa(page, 'ArgosNet')
    await page.goto('/configuracion/integraciones?ver=smartolt')
    await expect(page.locator('[data-prueba="smartolt-vacia"]')).toBeVisible()
    await capturar(page, 'lista-vacia')
    await page.locator('[data-prueba="smartolt-vacia"]').getByRole('link', { name: 'Agregar instancia' }).click()
    await expect(page).toHaveURL(/\/smartolt\/nueva$/)

    await page.locator('[data-prueba="instancia-nombre"]').fill('Zona norte')
    await page.locator('[data-prueba="instancia-subdominio"]').fill('zonanorte')
    await page.locator('[data-prueba="instancia-token"]').fill('token-secreto-123')
    await page.locator('[data-prueba="instancia-nota"]').fill('La renueva Luis en enero')
    await capturar(page, 'formulario')
    await page.locator('[data-prueba="instancia-guardar"]').click()
    await expect(aviso(page, 'Instancia guardada')).toBeVisible()
    await expect(page).toHaveURL(/\/smartolt\/\d+$/)
    await expect(page.locator('[data-prueba="instancia-aviso-sin-probar"]')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('token-secreto-123')

    await page.locator('[data-prueba="instancia-probar"]').click()
    await expect(page.locator('[data-prueba="resultado-sincronizar"]')).toContainText('OLT Centro')
    await page.getByRole('dialog').getByRole('button', { name: 'Entendido' }).click()
    await expect(page.locator('[data-prueba="instancia-estado"]')).toContainText('Probada')
    const olts = page.locator('[data-prueba="instancia-olts"]')
    await expect(olts.locator('[data-olt="1"]')).toContainText('OLT Centro')
    await expect(olts.locator('[data-olt="1"]')).toContainText('Ligada sola por el nombre')
    await capturar(page, 'detalle')

    // la OLT Centro de Argos pasa a la segunda OLT de SmartOLT
    await olts.locator('[data-olt="1"]').getByRole('button', { name: /Más de/ }).click()
    await page.getByRole('menuitem', { name: 'Quitar vínculo' }).click()
    await expect(aviso(page, 'Vínculo quitado')).toBeVisible()
    await olts.locator('[data-prueba="ligar-2"]').click()
    await page.getByRole('option', { name: /OLT Centro/ }).click()
    await expect(aviso(page, 'OLT-NORTE-02 ligada a OLT Centro')).toBeVisible()

    await page.locator('[data-prueba="instancia-apagar"]').click()
    await page.locator('[data-prueba="confirmar-apagar"]').click()
    await expect(aviso(page, 'Instancia apagada')).toBeVisible()
    await expect(page.locator('[data-prueba="instancia-encender"]')).toBeVisible()

    // sin recargar (los fixtures viven en memoria): «Atrás» vuelve a la lista
    await page.locator('[data-prueba="volver-configuracion"], [aria-label="Atrás"]').locator('visible=true').first().click()
    await expect(page).toHaveURL(/ver=smartolt/)
    await expect(page.locator('[data-instancia]')).toHaveCount(1)
    await expect(page.locator('[data-instancia]').first()).toContainText('Apagada')
    await capturar(page, 'lista')
})

test('ACS: se guarda y se prueba sin tocar SmartOLT', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await elegirEmpresa(page, 'ArgosNet')
    await page.goto('/configuracion/integraciones?ver=acs')
    await expect(page.locator('[data-prueba="acs-sin-configurar"]')).toContainText('Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU')
    await capturar(page, 'acs-sin-configurar')
    await page.locator('[data-prueba="acs-configurar"]').click()
    await expect(page).toHaveURL(/accion=editar/)
    await page.locator('[data-prueba="acs-url"]').fill('https://acs.miisp.gt:7557')
    await page.locator('[data-prueba="acs-usuario"]').fill('argos')
    await page.getByRole('button', { name: /Escribir clave/i }).click()
    await page.locator('[data-prueba="secreto-clave"]').fill('clave-acs-123')
    await capturar(page, 'acs-formulario')
    await page.locator('[data-prueba="acs-guardar"]').click()
    await expect(aviso(page, 'ACS guardado')).toBeVisible()
    await expect(page).not.toHaveURL(/accion=editar/)
    await page.locator('[data-prueba="acs-probar"]').click()
    await expect(aviso(page, 'El ACS respondió')).toBeVisible()
    await expect(page.locator('[data-prueba="estado-acs"]')).toContainText('Probado')
    await expect(page.locator('body')).not.toContainText('clave-acs-123')
    await capturar(page, 'acs')
    // SmartOLT no se tocó
    await page.locator('[data-integracion="smartolt"]').click()
    await expect(page.locator('[data-prueba="smartolt-vacia"]')).toBeVisible()
})
