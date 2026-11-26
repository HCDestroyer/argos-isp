import { expect, test, type Page } from '@playwright/test'
import { elegirEmpresa, entrar, ir, irAjuste, llenarFecha } from './ayudas'

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
    const vigencia = page.locator('[data-ajuste="codigo_corte.vigencia_min"] input[role="spinbutton"]')
    await expect(vigencia).toHaveValue('15')
    await vigencia.fill('20')
    await vigencia.blur()
    await page.locator('[data-prueba="portal-corte-guardar"]').click()
    await expect(aviso(page, 'Ajustes guardados')).toBeVisible()

    await page.getByRole('tab', { name: 'Caídas y fallas generales' }).click()
    await expect(page).toHaveURL(/pestana=caidas/)
    await page.locator('[data-ambito="1"]').click()
    const umbral = page.locator('[data-ajuste="caidas.umbral"] input[role="spinbutton"]')
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
    await expect(page.locator('[data-ajuste="falla_general.umbral"] input[role="spinbutton"]')).toBeDisabled()

    await page.getByRole('tab', { name: 'Retiro, historial de IP y acceso' }).click()
    await page.locator('[data-ambito="todas"]').click()
    await expect(page.locator('[data-ajuste="ip_historial.retencion_dias"] input[role="spinbutton"]')).toHaveValue('730')
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

    // Sin pestañas entre ajustes: la lista de Ajustes (o «‹ Ajustes» en el teléfono) lleva a otro.
    await irAjuste(page, 'Bancos de origen', /\/configuracion\/bancos-origen/)
    await page.locator('[data-prueba="agregar-banco"]').click()
    await page.getByRole('dialog').getByLabel('Nombre').fill('Banco Nexa Plus')
    await page.getByRole('dialog').getByRole('button', { name: 'Agregar banco' }).click()
    await expect(aviso(page, 'Banco Nexa Plus agregado al catálogo')).toBeVisible()
    await page.locator('[data-banco="Banrural"] button').click()
    await page.getByRole('menuitem', { name: 'Ocultar en esta empresa' }).click()
    await expect(page.locator('[data-banco="Banrural"]')).toHaveAttribute('data-oculto', 'true')
})

test('reportes: los días de baja de la empresa; el aviso de pequeño contribuyente ya no está aquí', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/reportes')
    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="1"]').click()
    const dias = page.getByLabel('Días suspendido para contar una baja')
    await expect(dias).toHaveValue('60')
    await dias.fill('90')
    await dias.blur()
    await page.locator('[data-prueba="dias-baja-guardar"]').click()
    await expect(aviso(page, 'Días para contar una baja guardados')).toBeVisible()
    await expect(page.locator('[data-prueba="bloque-aviso-pc"]')).toHaveCount(0)
    await expect(page.locator('[data-prueba="correos-externos"]')).toHaveCount(0)
})

test('fiscal: el aviso de pequeño contribuyente, su interruptor y los umbrales de la empresa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/fiscal')
    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="1"]').click()
    const bloque = page.locator('[data-prueba="bloque-aviso-pc"]')
    // ArgosNet tributa sobre utilidades: el aviso no sale aunque esté encendido.
    await expect(bloque.locator('[data-prueba="aviso-pc-no-aplica"]')).toBeVisible()

    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="2"]').click()
    await expect(bloque.locator('[data-prueba="aviso-pc-no-aplica"]')).toHaveCount(0)
    await expect(bloque.locator('[data-prueba="aviso-pc-fila"]')).toContainText('El 100 % (límite superado) se avisa siempre')
    await bloque.locator('[data-prueba="aviso-pc-activo"]').click()
    await expect(aviso(page, 'Aviso de pequeño contribuyente apagado')).toBeVisible()
    await expect(bloque.locator('[data-prueba="aviso-pc-fila"]')).toContainText('Apagado: no se avisan el 80 % ni el 95 %. El 100 % (límite superado) se avisa siempre, porque obliga a cambiar de régimen.')
    const form = bloque.locator('[data-prueba="umbrales-form"]')
    await form.getByRole('button', { name: 'Agregar' }).click()
    await expect(form.getByLabel('Umbral 3 en %')).toHaveValue('95')
    await form.locator('[data-prueba="umbrales-motivo"]').fill('El contador pidió avisar antes')
    await form.locator('[data-prueba="umbrales-guardar"]').click()
    await expect(aviso(page, 'Umbrales del aviso guardados')).toBeVisible()
    await expect(form).toContainText('Los cambió la empresa')
    await form.getByRole('button', { name: 'Quitar el umbral 3' }).click()
    await form.locator('[data-prueba="umbrales-guardar"]').click()
    await expect(form.locator('[data-prueba="umbrales-error"]')).toContainText('Los umbrales ya se cambiaron hoy')
})

test('panel financiero: con el aviso apagado, el límite superado (100 %) se avisa igual', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/fiscal')
    await page.locator('[data-prueba="pastillas-empresa"] [data-empresa="2"]').click()
    // Un límite anual propio muy bajo: las ventas del año de la empresa ya lo superan.
    await page.locator('#fiscal-parametros').scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Nuevo valor de pc_limite_anual', exact: true }).click()
    const modal = page.getByRole('dialog')
    await modal.getByLabel('Valor', { exact: true }).fill('1.00')
    await llenarFecha(modal.getByLabel('Vigente desde'), `${new Date().getFullYear()}-01-01`)
    await modal.getByLabel('Motivo').fill('Prueba del aviso')
    await modal.getByRole('button', { name: 'Guardar valor' }).click()
    await expect(modal).toBeHidden()
    const bloque = page.locator('[data-prueba="bloque-aviso-pc"]')
    await bloque.locator('[data-prueba="aviso-pc-activo"]').click()
    await expect(aviso(page, 'Aviso de pequeño contribuyente apagado')).toBeVisible()

    // Sin recargar: los fixtures viven en el navegador.
    await ir(page, 'Panel financiero', /\/finanzas$/)
    await expect(page.locator('[data-aviso="pc-2"]')).toContainText('Pequeño contribuyente al')
})

test('envíos programados: el detalle con sus corridas, pausar y los correos externos con sus envíos', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await elegirEmpresa(page, 'ArgosNet')
    if (test.info().project.name === 'escritorio') {
        await page.goto('/reportes')
        await page.locator('[data-prueba="ver-envios"]').click()
        await expect(page).toHaveURL(/\/reportes\/envios$/)
    }
    else {
        await page.goto('/reportes/envios')
    }
    await expect(page.getByRole('heading', { name: 'Envíos programados', level: 1 })).toBeVisible()
    const detalle = page.locator('[data-envio-detalle="1"]')
    await expect(detalle).toContainText('Retirado de la lista')
    await expect(detalle.locator('[data-prueba="corridas-envio"]')).toContainText('Omitido: el correo se retiró de la lista')
    await detalle.locator('[data-prueba="envio-pausar"]').click()
    await expect(aviso(page, 'Cartera vencida por zona en pausa')).toBeVisible()
    await expect(detalle.locator('[data-prueba="envio-pausar"]')).toHaveText('Reanudar')
    await page.locator('[data-envio="Cobranza diaria"]').click()
    await expect(page.locator('[data-envio-detalle="2"]')).toContainText('Todavía no ha corrido')

    await page.getByRole('tab', { name: /Correos externos aprobados/ }).click()
    await expect(page).toHaveURL(/ver=correos/)
    await expect(page.locator('[data-correo="contador@despachomm.gt"]')).toBeVisible()
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

// SmartOLT y ACS: `integraciones-smartolt.spec.ts` (tableros PendSmartolt* y PendAcs).

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
    await expect(page.locator('[data-vinculo="iris-u-118"]').locator('xpath=ancestor::tr')).toContainText('Ese id ya lo usa otro técnico')
    await page.locator('[data-conciliar="iris-u-118"]').click()
    await expect(page.locator('[data-prueba="resultado-conciliar"]')).toContainText('Iris no está conectado')
})
