import { expect, test, type Page } from '@playwright/test'
import { servicios } from '../../fixtures/servicios/datos'
import { entrar } from './ayudas'

/**
 * Pedido del PM (5 nov): «Editar servicio» cambia la IPv4 fija (con el selector del alta) o la
 * quita en PPPoE (`ipv4: null`), y el usuario y la contraseña PPPoE (`PUT /servicios/:id`).
 * Servicio 1 de los fixtures: PPPoE en RB-Centro con 100.64.10.11. Corre en escritorio (1280 px) y
 * en teléfono (390 px).
 */

async function abrirEdicion(page: Page) {
    await entrar(page, 'admin@argos.test')
    await page.goto('/servicios/1')
    // Con el servidor de desarrollo, la primera visita a la ficha la compila (varios segundos).
    const editar = page.locator('[data-prueba="editar-servicio"]')
    await expect(editar).toBeVisible({ timeout: 20_000 })
    await editar.click()
    const panel = page.getByRole('dialog', { name: /^Editar / })
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-prueba="editar-ipv4-actual"]')).toHaveText('100.64.10.11')
    return panel
}

test('cambiar la IPv4 fija del servicio', async ({ page }) => {
    const panel = await abrirEdicion(page)
    await panel.getByRole('button', { name: 'Cambiar IP' }).click()
    const ip = panel.getByRole('textbox', { name: /^IP fija/ })
    // La red de la IP actual queda elegida: una IP de otra red se marca en el campo.
    await ip.fill('100.64.11.9')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel.getByText('Escribe una IP dentro de 100.64.10.0/24 o elige otra red')).toBeVisible()

    // Una IP de otro servicio: 409 `ip_ocupada`, en el campo.
    await ip.fill('100.64.10.12')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel.getByText(/La IP 100\.64\.10\.12 ya está asignada al servicio/)).toBeVisible()

    await ip.fill('100.64.10.77')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('100.64.10.77').first()).toBeVisible()
})

test('cambiar el usuario y la contraseña PPPoE', async ({ page }) => {
    const otro = servicios.find(x => x.id === 2)!.user_ppp!
    const panel = await abrirEdicion(page)
    const credenciales = panel.locator('[data-prueba="editar-credenciales"]')
    await credenciales.scrollIntoViewIfNeeded()
    const usuario = credenciales.getByRole('textbox', { name: 'Usuario PPPoE' })
    await expect(usuario).toBeEnabled()

    // Un usuario de otro servicio: 409 `user_ppp_duplicado`, en el campo.
    await usuario.fill(otro)
    await expect(credenciales.locator('[data-prueba="aviso-clave"]')).toContainText('Al guardar, el cliente se desconecta y vuelve a conectarse con el usuario y la contraseña nuevos.')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(credenciales.getByText(`El user_ppp ${otro} ya existe`)).toBeVisible()

    await usuario.fill('maria.nueva')
    const clave = credenciales.getByLabel('Contraseña nueva')
    await clave.fill('abc')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(credenciales.getByText('De 6 a 64 caracteres')).toBeVisible()

    await credenciales.getByRole('button', { name: 'Generar contraseña' }).click()
    await expect(clave).toHaveAttribute('type', 'text')
    const generada = await clave.inputValue()
    expect(generada).toMatch(/^[A-Za-z0-9]{10}$/)

    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel).toBeHidden()

    // La ficha muestra el usuario nuevo y la contraseña nueva al pedirla (queda en la bitácora).
    await expect(page.getByText('maria.nueva').first()).toBeVisible()
    await page.getByRole('button', { name: 'Mostrar' }).click()
    await expect(page.getByText(generada)).toBeVisible()
})

test('quitar la IP fija de un PPPoE (usar el pool)', async ({ page }) => {
    const panel = await abrirEdicion(page)
    await panel.getByRole('button', { name: 'Quitar IP fija (usar el pool)' }).click()
    await expect(panel.locator('[data-prueba="aviso-quitar-ipv4"]')).toContainText('Al guardar se libera 100.64.10.11')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel).toBeHidden()
    await page.locator('[data-prueba="editar-servicio"]').click()
    await expect(page.getByRole('dialog', { name: /^Editar / }).locator('[data-prueba="editar-ipv4-actual"]')).toHaveText('Sin IP fija: la entrega el pool del router')
})
