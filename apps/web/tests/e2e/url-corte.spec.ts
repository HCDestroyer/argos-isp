import { expect, test } from '@playwright/test'
import { entrar } from './ayudas'

/**
 * URL de corte por empresa (`core.empresas.url_corte`): se edita en el formulario de la empresa,
 * la inválida queda marcada en el campo y la guardada queda en el campo. Escritorio y teléfono.
 */
test('el admin guarda la URL de corte de una empresa y la ve guardada', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/empresas')
    // Tablero OperConfigEmpresa: la empresa se elige con su pastilla y se edita en la misma tarjeta.
    await page.locator('[data-prueba="pastillas-empresa"]').getByRole('button', { name: 'Fibra del Sur' }).click()
    await page.locator('[data-prueba="empresa-mas-datos"]').click()

    await expect(page.getByText('Al cortar un servicio, el cliente verá esta página en vez de la página de corte de Argos.')).toBeVisible()
    const campo = page.getByLabel('Página de corte propia')
    await campo.fill('fibradelsur.gt/corte')
    await page.locator('[data-prueba="empresa-guardar"]').click()
    await expect(page.getByText('Una dirección completa con http:// o https://')).toBeVisible()

    await campo.fill('https://fibradelsur.gt/corte')
    await page.locator('[data-prueba="empresa-guardar"]').click()
    await expect(page.getByRole('listitem').getByText('Empresa actualizada')).toBeVisible()
    await expect(campo).toHaveValue('https://fibradelsur.gt/corte')
})
