import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Usuarios, roles y tokens de API (tarea 9): alta de un usuario con un rol acotado a una caja,
 * desactivarlo, un rol propio con sus permisos y un token que se ve una sola vez y se revoca.
 */

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

async function elegir(page: Page, contenedor: Locator, prueba: string, opcion: string | RegExp): Promise<void> {
    await contenedor.locator(`[data-prueba="${prueba}"]`).click()
    await page.getByRole('option', { name: opcion }).first().click()
}

test('alta de usuario con rol por caja, rol propio y token de una sola vez', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // El menú lleva a la sección; se entra por URL para no depender de la primera compilación de `nuxt dev`.
    await expect((await menu(page)).getByRole('link', { name: 'Usuarios', exact: true })).toBeVisible()
    await page.goto('/usuarios')

    // Usuario nuevo con el rol cajero acotado a una caja.
    await page.locator('[data-prueba="nuevo-usuario"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo usuario' })
    await campo(alta, 'usuario-nombre').fill('Carla Cobros')
    await campo(alta, 'usuario-email').fill('carla@argos.test')
    await campo(alta, 'usuario-password').fill('clave-segura-1')
    await alta.locator('[data-prueba="agregar-rol"]').click()
    await elegir(page, alta, 'usuario-rol-0-rol', /^cajero/)
    await elegir(page, alta, 'usuario-rol-0-alcance', 'Una caja')
    // Sin elegir la caja, el esquema lo marca.
    await alta.locator('[data-prueba="usuario-guardar"]').click()
    await expect(alta.getByText('Elige a qué aplica el alcance')).toBeVisible()
    await elegir(page, alta, 'usuario-rol-0-alcance-id', /Caja/)
    await alta.locator('[data-prueba="usuario-guardar"]').click()
    await expect(alta).toBeHidden()
    const fila = page.locator('[data-prueba="tabla-usuarios"] tr').filter({ hasText: 'carla@argos.test' })
    await expect(fila).toContainText('cajero')

    // Desactivarlo con confirmación.
    const id = await fila.locator('[data-usuario]').getAttribute('data-usuario')
    await page.locator(`[data-prueba="activo-usuario-${id}"]`).click()
    const confirmar = page.getByRole('dialog', { name: 'Desactivar a Carla Cobros' })
    await confirmar.locator('[data-prueba="confirmar-accion"]').click()
    await expect(confirmar).toBeHidden()
    await expect(fila).toContainText('Inactivo')

    // Rol propio con dos permisos elegidos del catálogo.
    await page.locator('[data-prueba="usuarios-navegacion"]').getByRole('link', { name: 'Roles y permisos' }).click()
    await expect(page).toHaveURL(/\/usuarios\/roles$/)
    await page.locator('[data-prueba="nuevo-rol"]').click()
    const rol = page.getByRole('dialog', { name: 'Nuevo rol' })
    await campo(rol, 'rol-nombre').fill('auditor_externo')
    await campo(rol, 'rol-permisos-buscar').fill('bitacora')
    await rol.getByRole('checkbox', { name: /bitacora\.ver/ }).click()
    await campo(rol, 'rol-permisos-buscar').fill('libro.ver')
    await rol.getByRole('checkbox', { name: /^libro\.ver/ }).click()
    await expect(rol.locator('[data-prueba="rol-permisos-cuenta"]')).toContainText('2 de')
    await rol.locator('[data-prueba="rol-guardar"]').click()
    await expect(rol).toBeHidden()
    await expect(page.locator('[data-rol="auditor_externo"]')).toBeVisible()

    // Token de API: se ve una vez y se revoca.
    await page.locator('[data-prueba="usuarios-navegacion"]').getByRole('link', { name: 'Tokens de API' }).click()
    await expect(page).toHaveURL(/\/usuarios\/tokens$/)
    await page.locator('[data-prueba="nuevo-token"]').click()
    const token = page.getByRole('dialog', { name: 'Nuevo token de API' })
    await elegir(page, token, 'token-usuario', /Sofía Soporte/)
    await campo(token, 'token-nombre').fill('Agente de soporte')
    await token.locator('[data-prueba="token-crear"]').click()
    const valor = page.locator('[data-prueba="valor-Token"]')
    await expect(valor).toContainText('atk_')
    await page.locator('[data-prueba="cerrar-valor-una-vez"]').click()
    await expect(valor).toBeHidden()
    const filaToken = page.locator('[data-prueba="tabla-tokens"] tr').filter({ hasText: 'Agente de soporte' })
    await expect(filaToken).toContainText('Activo')
    await filaToken.getByRole('button', { name: /Revocar el token/ }).click()
    await page.getByRole('dialog', { name: 'Revocar token de API' }).locator('[data-prueba="confirmar-accion"]').click()
    await expect(filaToken).toContainText('Revocado')
})
