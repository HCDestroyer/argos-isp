import { expect, test, type Page } from '@playwright/test'
import { entrar, ir, menu, verDatosCliente } from './ayudas'

/**
 * Contrato Iris 0.14.1 (A1): «Revisión de titulares» y «Verificar NIT» en modo fixtures, en
 * escritorio y teléfono. Las decisiones se encadenan sin recargar la página: los fixtures viven en
 * el navegador y se reinician al recargar.
 */

/** El botón visible (en el teléfono, «Aprobar» y «Rechazar» van en la barra de abajo). */
function boton(page: Page, nombre: string) {
    return page.getByRole('button', { name: nombre, exact: true }).filter({ visible: true }).first()
}

test('el menú la muestra dentro de Clientes solo con clientes.ver_identidad', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const lateral = await menu(page)
    await expect(lateral.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible()
    await expect(lateral.getByRole('link', { name: 'Revisión de titulares', exact: true })).toHaveCount(0)
    await page.goto('/clientes/titulares')
    await expect(page).toHaveURL(/\/sin-permiso/)
})

test('revisar: fotos al abrir, aprobar eligiendo la empresa y el 409 de la otra revisión', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Revisión de titulares', /\/clientes\/titulares$/)

    const lista = page.locator('[data-prueba="lista-revisiones"]')
    await expect(lista.locator('tbody tr')).toHaveCount(2)
    await expect(lista).toContainText('INVERSIONES POSADA DEL VALLE, S.A.')
    // La lista nunca trae al representante.
    await expect(lista).not.toContainText('Marta Elena')

    // Revisión 2: dos empresas con el mismo NIT verificado.
    await lista.locator('tbody tr', { hasText: 'Pasaporte' }).getByRole('link').click()
    await expect(page).toHaveURL(/\/clientes\/titulares\/2$/)
    await expect(page.getByText('Marta Elena Juárez')).toBeVisible()
    await expect(page.locator('[data-prueba="foto-frente"] img')).toBeVisible()
    await expect(page.locator('[data-prueba="foto-reverso"]')).toHaveCount(0)
    const candidatos = page.locator('[data-prueba="candidatos"]')
    await expect(candidatos.locator('li')).toHaveCount(2)
    await expect(candidatos).toContainText('Hotel Posada del Valle, sucursal Antigua')

    await boton(page, 'Aprobar').click()
    const dialogo = page.getByRole('dialog', { name: 'Aprobar cambio de titular' })
    await dialogo.locator('[data-prueba="motivo-aprobar"]').fill('Confirmado con la gerencia de la sucursal')
    await dialogo.locator('[data-prueba="confirmar-aprobar"]').click()
    // Sin elegir la empresa, el formulario lo pide.
    await expect(dialogo).toContainText('Elige la empresa a la que pasa el servicio')
    await dialogo.getByRole('radio', { name: /sucursal Antigua/ }).check()
    await dialogo.locator('[data-prueba="confirmar-aprobar"]').click()
    await expect(dialogo).toBeHidden()
    await expect(page.getByText('Cambio de titular aprobado', { exact: true })).toBeVisible()
    await expect(page.locator('[data-prueba="estado-revision"]')).toHaveText('Aprobada')
    await expect(page.locator('[data-prueba="decision-revision"]')).toContainText('sucursal Antigua')
    await expect(page.getByText('Datos borrados al decidir')).toBeVisible()
    await expect(page.locator('[data-prueba="foto-frente"]')).toHaveCount(0)

    // La revisión 1 es del mismo servicio: su titular ya cambió (409) y se ofrece volver a cargar.
    await page.goBack()
    await expect(lista.locator('tbody tr')).toHaveCount(1)
    await lista.getByRole('link', { name: 'INVERSIONES POSADA DEL VALLE, S.A.' }).click()
    await expect(page).toHaveURL(/\/clientes\/titulares\/1$/)
    await expect(page.getByText('Rodrigo Andrés Alvarado Pinto')).toBeVisible()
    await boton(page, 'Aprobar').click()
    const otro = page.getByRole('dialog', { name: 'Aprobar cambio de titular' })
    await otro.locator('[data-prueba="motivo-aprobar"]').fill('Confirmado con la gerencia del hotel')
    await otro.locator('[data-prueba="confirmar-aprobar"]').click()
    const error = otro.locator('[data-prueba="error-revision"]')
    await expect(error).toContainText('Alguien decidió antes')
    await expect(error).toContainText('El titular del servicio ya cambió')
    await error.getByRole('button', { name: 'Volver a cargar' }).click()
    await expect(otro).toBeHidden()
})

test('rechazar pide un motivo de al menos 10 caracteres', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/titulares/1')
    await expect(page.getByText('Rodrigo Andrés Alvarado Pinto')).toBeVisible()
    await boton(page, 'Rechazar').click()
    const dialogo = page.getByRole('dialog', { name: 'Rechazar cambio de titular' })
    await dialogo.locator('[data-prueba="motivo-rechazar"]').fill('No')
    await dialogo.locator('[data-prueba="confirmar-rechazar"]').click()
    await expect(dialogo).toContainText('al menos 10 caracteres')
    await dialogo.locator('[data-prueba="motivo-rechazar"]').fill('La patente no menciona a esta persona')
    await dialogo.locator('[data-prueba="confirmar-rechazar"]').click()
    await expect(dialogo).toBeHidden()
    await expect(page.getByText('Cambio de titular rechazado', { exact: true })).toBeVisible()
    await expect(page.locator('[data-prueba="estado-revision"]')).toHaveText('Rechazada')
    await expect(boton(page, 'Aprobar')).toHaveCount(0)
})

test('ficha de una empresa: verificar el NIT con el método elegido', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/3')
    await verDatosCliente(page)
    const nit = page.locator('[data-prueba="nit-verificacion"]')
    await expect(nit.locator('[data-prueba="nit-estado"]')).toHaveText('Sin verificar')
    await nit.locator('[data-prueba="verificar-nit"]').click()
    const dialogo = page.getByRole('dialog', { name: 'Verificar NIT' })
    await dialogo.getByRole('radio', { name: /Consulta en la SAT/ }).check()
    await dialogo.locator('[data-prueba="confirmar-verificar-nit"]').click()
    await expect(dialogo).toBeHidden()
    await expect(nit.locator('[data-prueba="nit-estado"]')).toHaveText(/^Verificado el .+ por Ana Administradora$/)
    await expect(nit.locator('[data-prueba="verificar-nit"]')).toHaveCount(0)
})
