import { expect, test } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Configuración → Portal de corte: el admin la encuentra en el menú, ve que son los valores iniciales
 * del servidor, cambia la IP y el puerto (confirma que se actualizan los routers) y luego el modo de
 * suspensión (sin confirmación). El cajero no la ve; si la API falla se ve «Reintentar». Escritorio y teléfono.
 */
test('el admin guarda la dirección del portal de corte y el modo de suspensión', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    const lateral = await menu(page)
    await lateral.getByRole('link', { name: 'Portal de corte' }).click()
    await expect(page).toHaveURL(/\/configuracion\/portal-corte/)

    await expect(page.getByText('Valores iniciales del servidor, todavía no guardados')).toBeVisible()
    await expect(page.getByText('reescribe las reglas de corte en todos los routers')).toBeVisible()
    await expect(page.getByText('la IPv4 de portal.argosnet.gt')).toBeVisible()

    await expect(page.getByRole('button', { name: 'Guardar estos valores' })).toBeVisible()
    await page.getByLabel('IPv4 del portal').fill('190.56.10')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText('Escribe una IPv4, p. ej. 190.56.10.20, o déjala vacía')).toBeVisible()

    await page.getByLabel('IPv4 del portal').fill('190.56.10.20')
    await page.getByLabel('Puerto').fill('8088')
    await page.getByLabel('Puerto').blur()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByText('190.56.10.20:8088')).toBeVisible()
    await dialogo.getByRole('button', { name: 'Guardar y actualizar routers' }).click()
    await expect(page.getByRole('listitem').getByText('Portal de corte guardado')).toBeVisible()
    await expect(page.getByText('Guardado el')).toBeVisible()
    await expect(page.getByText('Valores iniciales del servidor, todavía no guardados')).toHaveCount(0)

    await page.getByText('Mantener la sesión y cambiar velocidad (CoA)').click()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('listitem').getByText('El cambio aplica desde la siguiente suspensión.')).toBeVisible()

    await page.getByRole('link', { name: 'Ver la URL de corte de cada empresa' }).click()
    await expect(page).toHaveURL(/\/configuracion\/empresas/)
})

test('si la API falla se ve el error con «Reintentar», sin valores inventados', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.evaluate(() => localStorage.setItem('argos_fixtures_fallas', JSON.stringify({ 'GET /api/v1/corte/configuracion': 500 })))
    await page.goto('/configuracion/portal-corte')
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(page.getByLabel('IPv4 del portal')).toHaveCount(0)
    await page.evaluate(() => localStorage.removeItem('argos_fixtures_fallas'))
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByLabel('IPv4 del portal')).toBeVisible()
})

test('el cajero no ve el portal de corte ni puede abrirlo', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    const lateral = await menu(page)
    await expect(lateral.getByRole('link', { name: 'Portal de corte' })).toHaveCount(0)
    await page.goto('/configuracion/portal-corte')
    await expect(page).toHaveURL(/\/sin-permiso/)
})
