import { expect, test, type Page } from '@playwright/test'
import { elegirEmpresa, entrar } from './ayudas'

/**
 * «Pendientes del backend» en el panel (tableros OperLogin, OperConfigRed, OperConfigCobro,
 * PendEnviosReportes, OperConfigIntegraciones, PendIntentosRecuperacion y PendVinculosTecnicos),
 * contra los fixtures fieles a la API. Escritorio y teléfono.
 */

function aviso(page: Page, texto: string) {
    return page.getByRole('listitem').getByText(texto).first()
}

test('login: «¿La olvidaste?» manda el enlace y la nueva contraseña cierra las sesiones', async ({ page }) => {
    await page.goto('/login')
    await page.locator('[data-prueba="olvidaste"]').click()
    await expect(page.getByRole('heading', { name: '¿Olvidaste tu contraseña?' })).toBeVisible()
    await page.getByLabel('Correo').fill('admin@argos.test')
    await page.getByRole('button', { name: 'Mandar enlace' }).click()
    await expect(page.locator('[data-prueba="recuperar-enviado"]')).toContainText('admin@argos.test')

    await page.getByRole('button', { name: 'Pedir otro' }).click()
    await page.getByLabel('Correo').fill('limite@argos.test')
    await page.getByRole('button', { name: 'Mandar enlace' }).click()
    await expect(page.locator('[data-prueba="recuperar-limite"]')).toContainText('Demasiadas solicitudes')

    await page.goto('/restablecer-contrasena#token=enlace-de-prueba-0123456789abcdef')
    await expect(page).toHaveURL(/\/restablecer-contrasena$/)
    await page.getByLabel('Contraseña nueva').fill('una-clave-nueva')
    await page.getByLabel('Escríbela otra vez').fill('una-clave-nueva')
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await expect(page.locator('[data-prueba="contrasena-cambiada"]')).toContainText('Cerramos tus 2 sesiones abiertas')

    await page.goto('/restablecer-contrasena#token=enlace-usado-o-vencido-000000')
    await page.getByLabel('Contraseña nueva').fill('una-clave-nueva')
    await page.getByLabel('Escríbela otra vez').fill('una-clave-nueva')
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await expect(page.locator('[data-prueba="enlace-invalido"]')).toContainText('El enlace ya no sirve')
    await page.getByRole('link', { name: 'Pedir otro enlace' }).click()
    await expect(page.getByRole('heading', { name: '¿Olvidaste tu contraseña?' })).toBeVisible()
})

test('red y portal: la vigencia del código y las caídas se guardan para todas o para una empresa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/portal-corte')
    const vigencia = page.locator('[data-ajuste="codigo_corte.vigencia_min"] input')
    await expect(vigencia).toHaveValue('15')
    await vigencia.fill('20')
    await vigencia.blur()
    await page.locator('[data-prueba="portal-corte-guardar"]').click()
    await expect(aviso(page, 'Ajustes guardados')).toBeVisible()

    await page.getByRole('tab', { name: 'Caídas y fallas generales' }).click()
    await expect(page).toHaveURL(/pestana=caidas/)
    await page.locator('[data-ambito="1"]').click()
    const umbral = page.locator('[data-ajuste="caidas.umbral"] input')
    await expect(page.locator('[data-ajuste="caidas.umbral"]')).toContainText('Igual que «Todas»')
    await umbral.fill('60')
    await umbral.blur()
    await page.locator('[data-prueba="portal-corte-guardar"]').click()
    await expect(page.locator('[data-ajuste="caidas.umbral"]')).toContainText('De 2 a 50')
    await umbral.fill('4')
    await umbral.blur()
    await page.locator('[data-prueba="portal-corte-guardar"]').click()
    await expect(page.locator('[data-ajuste="caidas.umbral"]')).toContainText('Propio de esta empresa')
    // La falla general es solo global: en una empresa se ve bloqueada.
    await expect(page.locator('[data-ajuste="falla_general.umbral"] input')).toBeDisabled()

    await page.getByRole('tab', { name: 'Retiro, historial de IP y acceso' }).click()
    await page.locator('[data-ambito="todas"]').click()
    await expect(page.locator('[data-ajuste="ip_historial.retencion_dias"] input')).toHaveValue('730')
})

test('facturación y cobro: reglas por empresa, impresión por caja y bancos de origen', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/reglas-cobro')
    await expect(page.locator('[data-prueba="reglas-cobro-elige-empresa"]')).toBeVisible()
    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="1"]').click()
    const tope = page.getByLabel('Tope de días de la pausa sin cobro')
    await expect(tope).toHaveValue('90')
    await tope.fill('45')
    await tope.blur()
    await page.locator('[data-prueba="reglas-cobro-guardar"]').click()
    await expect(aviso(page, 'Reglas de cobro guardadas')).toBeVisible()
    await expect(page.locator('[data-prueba="reglas-cobro-pie"]')).toContainText('último cambio')

    await page.getByRole('tab', { name: 'Bancos de origen' }).click()
    await expect(page).toHaveURL(/\/configuracion\/bancos-origen/)
    await page.locator('[data-prueba="agregar-banco"]').click()
    await page.getByRole('dialog').getByLabel('Nombre').fill('Banco Nexa Plus')
    await page.getByRole('dialog').getByRole('button', { name: 'Agregar banco' }).click()
    await expect(aviso(page, 'Banco Nexa Plus agregado al catálogo')).toBeVisible()
    await page.locator('[data-banco="Banrural"] button').click()
    await page.getByRole('menuitem', { name: 'Ocultar en esta empresa' }).click()
    await expect(page.locator('[data-banco="Banrural"]')).toHaveAttribute('data-oculto', 'true')
})

test('reportes: los días de baja de la empresa y los correos externos aprobados', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/reportes')
    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="1"]').click()
    const dias = page.getByLabel('Días suspendido para contar una baja')
    await expect(dias).toHaveValue('60')
    await dias.fill('90')
    await dias.blur()
    await page.locator('[data-prueba="dias-baja-guardar"]').click()
    await expect(aviso(page, 'Días para contar una baja guardados')).toBeVisible()

    await page.locator('[data-prueba="aprobar-correo"]').click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Correo').fill('auditoria@externa.gt')
    await dialogo.getByLabel('De quién es').fill('Auditoría externa')
    await dialogo.getByRole('button', { name: 'Aprobar' }).click()
    await expect(page.locator('[data-correo="auditoria@externa.gt"]')).toBeVisible()
    await page.locator('[data-retirar="auditoria@externa.gt"]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Retirar' }).click()
    await expect(aviso(page, 'auditoria@externa.gt retirado')).toBeVisible()
})

test('integraciones: SmartOLT se guarda sin mostrar el token y se prueba de verdad', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await elegirEmpresa(page, 'ArgosNet')
    await page.goto('/configuracion/integraciones?ver=smartolt')
    const tarjeta = page.locator('[data-prueba="equipos-smartolt"]')
    await expect(tarjeta.locator('[data-prueba="estado-smartolt"]')).toContainText('Sin conectar')
    await tarjeta.getByLabel('Integración encendida en esta empresa').click()
    await tarjeta.locator('[data-prueba="smartolt-url"]').fill('https://miisp.smartolt.com')
    await tarjeta.getByRole('button', { name: /Escribir token de la api/i }).click()
    await tarjeta.locator('[data-prueba="secreto-smartolt_token"]').fill('token-secreto-123')
    await tarjeta.locator('[data-prueba="guardar-smartolt"]').click()
    await expect(aviso(page, 'SmartOLT guardado')).toBeVisible()
    await expect(tarjeta).toContainText('Guardado')
    await expect(tarjeta.locator('input[value="token-secreto-123"]')).toHaveCount(0)
    await tarjeta.locator('[data-prueba="probar-smartolt"]').click()
    await expect(aviso(page, 'Conexión correcta')).toBeVisible()
    await expect(tarjeta.locator('[data-prueba="estado-smartolt"]')).toContainText('Conectado')
})

test('inventario: decidir el intento anterior habilita «Declarar no recuperado»; técnicos de Iris', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/inventario/por-recuperar/5')
    await expect(page.locator('[data-prueba="tecnicos-cuentan"]')).toHaveText('1 de 2')
    await expect(page.locator('[data-prueba="declarar"]')).toBeDisabled()
    await page.locator('[data-prueba="decidir"]').click()
    await page.getByRole('dialog').locator('[data-prueba="decision-motivo"]').fill('La foto muestra la casa del cliente')
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar decisión' }).click()
    await expect(aviso(page, 'Intento aceptado: cuenta')).toBeVisible()
    await expect(page.locator('[data-prueba="tecnicos-cuentan"]')).toHaveText('2 de 2')
    await expect(page.locator('[data-prueba="ya-se-puede"]')).toBeVisible()
    await expect(page.locator('[data-prueba="declarar"]')).toBeEnabled()

    await page.goto('/inventario/tecnicos-iris')
    await expect(page.locator('[data-vinculo="iris-u-118"]')).toBeVisible()
    await expect(page.getByText('Ese id ya lo usa otro técnico')).toBeVisible()
    await page.locator('[data-conciliar="iris-u-118"]').click()
    await expect(page.locator('[data-prueba="resultado-conciliar"]')).toContainText('Iris no está conectado')
})
