import { expect, test } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * URL de corte por empresa (`core.empresas.url_corte`): se edita en el formulario de la empresa,
 * la inválida queda marcada en el campo y la guardada se ve en la lista. Escritorio y teléfono.
 */
test('el admin guarda la URL de corte de una empresa y la ve en la lista', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/empresas')
    await page.getByRole('button', { name: 'Editar Fibra del Sur' }).click()

    const panel = page.getByRole('dialog')
    await expect(panel.getByText('Al cortar un servicio, el cliente verá esta página en vez de la página de corte de Argos.')).toBeVisible()
    const campo = panel.getByLabel('URL de corte (opcional)')
    await campo.fill('fibradelsur.gt/corte')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(panel.getByText('Una dirección completa con http:// o https://')).toBeVisible()

    await campo.fill('https://fibradelsur.gt/corte')
    await panel.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('listitem').getByText('Empresa actualizada')).toBeVisible()
    await expect(page.getByText('https://fibradelsur.gt/corte').filter({ visible: true }).first()).toBeVisible()
})
