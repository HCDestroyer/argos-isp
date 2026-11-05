import { expect, test, type Page } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * Pedido del PM (5 nov): «Editar servicio» cambia la IPv4 fija (con el selector del alta) y la
 * contraseña PPPoE (`PUT /servicios/:id`). Servicio 1 de los fixtures: PPPoE en RB-Centro con
 * 100.64.10.11. Corre en escritorio (1280 px) y en teléfono (390 px).
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

test('cambiar la contraseña PPPoE (el usuario no se edita)', async ({ page }) => {
    const panel = await abrirEdicion(page)
    const credenciales = panel.locator('[data-prueba="editar-credenciales"]')
    await credenciales.scrollIntoViewIfNeeded()
    await expect(credenciales.getByLabel('Usuario PPPoE')).toBeDisabled()

    const clave = credenciales.getByLabel('Contraseña nueva')
    await clave.fill('abc')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(credenciales.getByText('De 6 a 64 caracteres')).toBeVisible()

    await credenciales.getByRole('button', { name: 'Generar contraseña' }).click()
    await expect(clave).toHaveAttribute('type', 'text')
    const generada = await clave.inputValue()
    expect(generada).toMatch(/^[A-Za-z0-9]{10}$/)
    await expect(credenciales.locator('[data-prueba="aviso-clave"]')).toContainText('La sesión abierta no se corta')

    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel).toBeHidden()

    // La ficha muestra la contraseña nueva al pedirla (queda en la bitácora).
    await page.getByRole('button', { name: 'Mostrar' }).click()
    await expect(page.getByText(generada)).toBeVisible()
})
