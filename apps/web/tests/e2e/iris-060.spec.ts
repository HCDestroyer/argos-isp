import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Contrato Iris 0.6.0 en el panel (§6, §7, §9.2), en modo fixtures, a 1280 y 390 px: la cola de caja
 * con la boleta que llegó por Iris (lectura, conversación, reconexión temporal, rechazo con causa),
 * la reconexión temporal en la plantilla, las promesas con tipo y canal, el WhatsApp del cliente y
 * de la configuración, y la bitácora por conversación. Las capturas (claro y oscuro) quedan en
 * `test-results/capturas-iris-060/` (no se suben).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(200)
        await page.screenshot({ path: `test-results/capturas-iris-060/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

/** Sin desborde horizontal de la página (390 px). */
async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

/** Con la sesión ya abierta, entra por URL (como `plantillas.spec.ts`): no depende de la compilación del menú. */
async function abrir(page: Page, ruta: string): Promise<void> {
    await page.goto(ruta)
}

test('caja: la boleta que llegó por Iris, su reconexión temporal y el rechazo con causa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrir(page, '/comprobantes?canal=iris')

    const fila = page.locator('[data-prueba="fila-iris"]')
    await expect(fila).toHaveCount(1)
    await expect(fila).toContainText('Llegó por Iris')
    await expect(fila).toContainText('Leído por IA · 92 % · WhatsApp')
    await sinDesborde(page)
    await capturar(page, 'cola')

    await page.getByRole('link', { name: 'Comprobante #5' }).click()
    await expect(page).toHaveURL(/\/comprobantes\/5$/)
    const lectura = page.locator('[data-prueba="lectura-iris"]')
    await expect(lectura).toContainText('Asistente de IA de Iris')
    await expect(lectura).toContainText('wa:conv-7731')
    await expect(page.locator('[data-prueba="ver-conversacion-iris"]')).toBeDisabled()
    await expect(page.locator('[data-prueba="aviso-reconexion"]')).toContainText('Rechazarlo vuelve a cortar el servicio a la hora de corte')
    await sinDesborde(page)
    await capturar(page, 'detalle')

    await page.getByRole('button', { name: 'Rechazar', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Rechazar comprobante' })
    await expect(modal.locator('[data-prueba="aviso-reconexion-rechazo"]')).toBeVisible()
    await modal.locator('[data-prueba="causa-rechazo"]').click()
    await page.getByRole('option', { name: 'Falta un dato' }).click()
    await modal.locator('[data-prueba="motivo-rechazo"]').fill('Falta el número de boleta en la foto')
    await capturar(page, 'rechazar')
    await modal.locator('[data-prueba="confirmar-rechazo"]').click()
    await expect(modal).toBeHidden()

    await expect(page.locator('[data-prueba="estado-comprobante"]')).toHaveText('Rechazado')
    await expect(page.locator('[data-prueba="comprobante-rechazado"]')).toContainText('Falta un dato')
    await expect(page.locator('[data-prueba="aviso-reconexion"]')).toHaveCount(0)
})

test('plantilla: la reconexión temporal está apagada por defecto y se activa con sus límites', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrir(page, '/plantillas')
    const fila = page.locator('[data-prueba="tabla-plantillas"] tr').filter({ has: page.locator('[data-plantilla="1"]') })
    const resumen = fila.locator('[data-prueba="resumen-reconexion"]').filter({ visible: true })
    await expect(resumen).toHaveText('Reconexión temporal apagada')

    await page.locator('[data-prueba="editar-plantilla-1"]').click()
    const panel = page.getByRole('dialog', { name: 'Editar Mensual día 1' })
    const seccion = panel.locator('[data-prueba="plantilla-reconexion-temporal"]')
    await seccion.scrollIntoViewIfNeeded()
    await expect(seccion.getByRole('switch', { name: /Permitir reconexión temporal/ })).not.toBeChecked()
    await seccion.getByRole('switch', { name: /Permitir reconexión temporal/ }).click()
    await expect(campo(seccion, 'plantilla-reconexion-max')).toHaveValue('1')
    await campo(seccion, 'plantilla-reconexion-horas').fill('12')
    await capturar(page, 'plantilla')
    await panel.locator('[data-prueba="plantilla-guardar"]').click()
    await expect(panel).toBeHidden()
    await expect(resumen).toHaveText('Reconexión temporal: hasta 1 por periodo · 12 h')
})

test('promesas: tipo, canal, comprobante y la cancelada con su motivo', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrir(page, '/promesas?tipo=reconexion_temporal')
    await expect(page.locator('[data-prueba="tipo-promesa"]').first()).toBeVisible()
    await expect(page.locator('[data-prueba="tipo-promesa"]')).toHaveCount(2)
    await expect(page.locator('[data-prueba="promesa-comprobante"]').filter({ hasText: 'Comprobante #5' })).toBeVisible()
    await expect(page.getByText('la reconexión temporal venció con el comprobante sin revisar').filter({ visible: true }).first()).toBeVisible()
    await sinDesborde(page)
    await capturar(page, 'promesas')
})

test('WhatsApp: la baja de Iris en la ficha, la casilla al editar y el interruptor', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrir(page, '/clientes/8')
    const tarjeta = page.locator('[data-prueba="cliente-whatsapp"]')
    await expect(tarjeta.locator('[data-prueba="whatsapp-baja-iris"]')).toBeVisible()
    await expect(tarjeta.locator('[data-prueba="whatsapp-contacto"]')).toHaveText('Baja dada en Iris')
    await sinDesborde(page)
    await capturar(page, 'ficha-whatsapp')

    // Marcar la casilla al editar otro cliente.
    await abrir(page, '/clientes/1')
    await expect(tarjeta.locator('[data-prueba="whatsapp-contacto"]')).toHaveText('Sin permiso registrado')
    await page.getByRole('button', { name: 'Editar', exact: true }).first().click()
    const casilla = page.getByRole('checkbox', { name: 'Acepta avisos por WhatsApp' })
    await expect(casilla).toBeEnabled()
    await expect(casilla).not.toBeChecked()
    await casilla.check()
    await capturar(page, 'editar-whatsapp')
    // Los NIT de los fixtures son de ejemplo y no pasan el dígito verificador: se guarda como CF.
    await page.getByRole('dialog').getByRole('button', { name: 'Consumidor final', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Guardar/ }).click()
    await expect(page.getByText('Cambios guardados', { exact: true })).toBeVisible()
    await expect(tarjeta.locator('[data-prueba="whatsapp-contacto"]')).toHaveText('Acepta avisos por WhatsApp')
    await expect(tarjeta.locator('[data-prueba="whatsapp-entrega"]')).toHaveText('En cola hacia Iris')

    await abrir(page, '/configuracion/notificaciones')
    const interruptor = page.locator('[data-prueba="seccion-whatsapp"]').getByRole('switch', { name: /Avisos a clientes por WhatsApp/ })
    await expect(interruptor).not.toBeChecked()
    await interruptor.click()
    await sinDesborde(page)
    await capturar(page, 'config-whatsapp')
    await page.locator('[data-prueba="guardar-notificaciones"]').click()
    await expect(page.getByText('Configuración guardada', { exact: true })).toBeVisible()
    await expect(interruptor).toBeChecked()
})

test('bitácora: las acciones de una conversación de Iris', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await abrir(page, '/bitacora')
    await page.locator('[data-prueba="filtro-conversacion-iris"] input, input[data-prueba="filtro-conversacion-iris"]').first().fill('wa:conv-7731')
    await expect(page).toHaveURL(/conversacion=wa%3Aconv-7731|conversacion=wa:conv-7731/)
    await expect(page.getByText('Reconexión temporal mientras se revisa el comprobante')).toBeVisible()
    await expect(page.getByText('Identidad del cliente verificada por Iris')).toBeVisible()
    await sinDesborde(page)
    await capturar(page, 'bitacora')
})
