import { expect, test, type Locator, type Page } from '@playwright/test'
import { abrirAjustes, elegirEmpresa, entrar, irAjuste, verDatosCliente } from './ayudas'

/**
 * Contraseña del portal (pedido del PM; contrato A5), en modo fixtures, a 1280 y 390 px:
 * 1. Configuración → Contraseña del portal: con «Todas las empresas» pide elegir una; Fibra del Sur
 *    no tiene: se configura (nunca se vuelve a mostrar) y queda «Configurada el …».
 * 2. Ficha del cliente: María José usa contraseña propia; «Restaurar contraseña por defecto» confirma
 *    y avisa de las 2 sesiones cerradas. El cajero ve el estado pero ni el botón ni la configuración.
 * Cada paso se revisa en claro y oscuro; las capturas quedan en `test-results/capturas-portal-contrasena/`.
 */
async function enAmbosTemas(page: Page, nombre: string, zona?: Locator): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        const path = `test-results/capturas-portal-contrasena/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`
        await (zona ? zona.screenshot({ path }) : page.screenshot({ path }))
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

/** El viewport no tiene scroll horizontal (390 px incluido). */
async function sinScrollHorizontal(page: Page): Promise<void> {
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(desborde).toBeLessThanOrEqual(1)
}

test('el admin configura la contraseña del portal por defecto de una empresa', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await irAjuste(page, 'Contraseña del portal', /\/configuracion\/portal-contrasena/)

    // Con «Todas las empresas» la API pide una empresa activa.
    await expect(page.getByText('Elige una empresa', { exact: true })).toBeVisible()
    await elegirEmpresa(page, /Fibra del Sur/)

    const estado = page.locator('[data-prueba="estado-contrasena-defecto"]')
    await expect(estado).toHaveAttribute('data-estado', 'sin-configurar')
    await expect(estado).toContainText('Sin configurar: los clientes sin contraseña propia solo pueden entrar con código')
    await expect(page.getByText('El cliente debe cambiarla la primera vez que entre')).toBeVisible()
    await enAmbosTemas(page, 'configuracion-sin-configurar')
    await sinScrollHorizontal(page)

    await page.getByLabel('Contraseña nueva').fill('corta')
    await page.getByLabel('Confirmar contraseña').fill('otra')
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await expect(page.getByText('Al menos 8 caracteres')).toBeVisible()
    await expect(page.getByText('No coincide con la contraseña')).toBeVisible()

    await page.getByLabel('Contraseña nueva').fill('FibraSur2026')
    await page.getByLabel('Confirmar contraseña').fill('FibraSur2026')
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click()
    await expect(page.getByLabel('Contraseña nueva')).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()

    await expect(page.getByRole('listitem').getByText('Contraseña del portal configurada')).toBeVisible()
    await expect(estado).toHaveAttribute('data-estado', 'configurada')
    await expect(estado).toContainText('Configurada el')
    // Nunca se vuelve a mostrar: el campo queda vacío y oculto.
    await expect(page.getByLabel('Contraseña nueva')).toHaveValue('')
    await expect(page.getByLabel('Contraseña nueva')).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: 'Cambiar contraseña' })).toBeVisible()
    await enAmbosTemas(page, 'configuracion-configurada')
})

test('el admin restaura la contraseña del portal de un cliente desde su ficha', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/clientes/1')
    await verDatosCliente(page)
    const tarjeta = page.locator('[data-prueba="cliente-portal"]')
    await expect(tarjeta.locator('[data-prueba="portal-contrasena-tipo"]')).toHaveText('Contraseña propia', { timeout: 20_000 })
    await expect(tarjeta.locator('[data-prueba="portal-contrasena-detalle"]')).toContainText('Último cambio:')
    await enAmbosTemas(page, 'ficha-propia', tarjeta)
    await sinScrollHorizontal(page)

    await tarjeta.getByRole('button', { name: 'Restaurar contraseña por defecto' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toContainText('El cliente volverá a entrar con la contraseña de la empresa y deberá elegir una nueva. Se cerrarán sus sesiones del portal.')
    await enAmbosTemas(page, 'ficha-confirmar', dialogo)
    await dialogo.getByRole('button', { name: 'Restaurar' }).click()

    await expect(page.getByRole('listitem').getByText('Se cerraron 2 sesiones del portal.')).toBeVisible()
    await expect(dialogo).toHaveCount(0)
    await expect(tarjeta.locator('[data-prueba="portal-contrasena-tipo"]')).toHaveText('Contraseña por defecto')
    await expect(tarjeta).toContainText('Entra con la de su empresa')
    await enAmbosTemas(page, 'ficha-por-defecto', tarjeta)
})

test('el cajero ve cómo entra el cliente, sin restaurar ni configurar', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    await abrirAjustes(page)
    await expect(page.locator('[data-prueba="indice-ajustes"]').getByRole('link', { name: 'Contraseña del portal' })).toHaveCount(0)
    await page.goto('/configuracion/portal-contrasena')
    await expect(page).toHaveURL(/\/sin-permiso/)

    await page.goto('/clientes/1')
    await verDatosCliente(page)
    const tarjeta = page.locator('[data-prueba="cliente-portal"]')
    await expect(tarjeta.locator('[data-prueba="portal-contrasena-tipo"]')).toHaveText('Contraseña propia', { timeout: 20_000 })
    await expect(tarjeta.getByRole('button', { name: 'Restaurar contraseña por defecto' })).toHaveCount(0)
})
