import { expect, test, type Locator } from '@playwright/test'
import { entrar } from './ayudas'

function campo(contenedor: Locator, prueba: string): Locator {
    return contenedor.locator(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`).first()
}

/**
 * Routers duplicados (pedido del PM, `contratos/routers.md` de A1): el RB-Centro está registrado
 * dos veces («RB-Centro PCQ», misma API y mismo serial). Aviso con el porqué, «Unir» con vista
 * previa y confirmación, y el 409 al dar de alta el mismo MikroTik otra vez.
 */
test('aviso de duplicados en Routers, unir con vista previa y nadie se desconecta', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // Recién entrado los fixtures están intactos: `goto` no pierde nada y no depende de que el menú
    // navegue antes de que Vite compile la página (la primera visita pasa de 5 s en frío).
    await page.goto('/routers')
    await expect(page.locator('[data-prueba="tabla-routers"]')).toBeVisible({ timeout: 30_000 })

    const aviso = page.locator('[data-prueba="grupo-duplicados-0"]')
    await expect(aviso).toContainText('«RB-Centro» y «RB-Centro PCQ» parecen el mismo MikroTik')
    await expect(aviso).toContainText('Misma dirección de la API (10.10.0.1:443)')
    await expect(aviso).toContainText('Mismo número de serie')

    await aviso.getByRole('button', { name: /^Unir/ }).click()
    const modal = page.getByRole('dialog', { name: 'Unir routers duplicados' })
    await expect(modal.locator('[data-prueba="union-queda"]')).toHaveText('RB-Centro')
    await expect(modal.locator('[data-prueba="union-absorbido"]')).toHaveText('RB-Centro PCQ')
    await expect(modal.locator('[data-prueba="union-sin-desconexion"]')).toContainText('Nadie se desconecta')
    await expect(modal.locator('[data-prueba="union-avisos"]')).toContainText('control de velocidad arbol_pcq')
    const unir = modal.getByRole('button', { name: 'Unir routers' })
    await expect(unir).toBeDisabled()

    // Elegir el otro como el que queda cambia la vista previa: pasan los servicios y sesiones del RB-Centro.
    const queda = modal.locator('[data-prueba="unir-queda"]')
    await queda.getByText('RB-Centro PCQ', { exact: true }).click()
    await expect(modal.locator('[data-prueba="union-queda"]')).toHaveText('RB-Centro PCQ')
    await expect(modal.locator('[data-prueba="union-servicios"]')).not.toHaveText('0')
    await queda.getByText('RB-Centro', { exact: true }).click()
    await expect(modal.locator('[data-prueba="union-queda"]')).toHaveText('RB-Centro')

    await modal.getByRole('checkbox').click()
    await expect(unir).toBeEnabled()
    await unir.click()
    await expect(page.getByText('«RB-Centro PCQ» quedó unido a «RB-Centro»').first()).toBeVisible()
    await expect(aviso).toHaveCount(0)
    // El absorbido queda desactivado: pasa a «Inactivos», enlazado al que quedó.
    await page.locator('[data-prueba="vista-routers"]').getByRole('tab', { name: 'Inactivos' }).click()
    await expect(page.locator('[data-prueba="unido-4"]')).toHaveText('Unido a RB-Centro')
})

test('desde la ficha del duplicado: unir y quedar enlazado al que quedó', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // Recién entrado los fixtures están intactos: `goto` no pierde nada y no depende de que el menú
    // navegue antes de que Vite compile la página (la primera visita pasa de 5 s en frío).
    await page.goto('/routers')
    await expect(page.locator('[data-prueba="tabla-routers"]')).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-prueba="tabla-routers"]').getByRole('link', { name: 'RB-Centro PCQ' }).click()
    await expect(page).toHaveURL(/\/routers\/4$/)

    const aviso = page.locator('[data-prueba="grupo-duplicados-0"]')
    await expect(aviso).toContainText('parecen el mismo MikroTik')
    await aviso.getByRole('button', { name: /^Unir/ }).click()
    const modal = page.getByRole('dialog', { name: 'Unir routers duplicados' })
    await expect(modal.locator('[data-prueba="union-queda"]')).toHaveText('RB-Centro')
    await modal.getByRole('checkbox').click()
    await modal.getByRole('button', { name: 'Unir routers' }).click()

    const unido = page.locator('[data-prueba="router-unido"]')
    await expect(unido).toContainText('Este router se unió a otro')
    await unido.getByRole('link', { name: 'Ver el router que quedó' }).click()
    await expect(page).toHaveURL(/\/routers\/1$/)
    await expect(page.locator('[data-prueba="routers-duplicados"]')).toHaveCount(0)
})

test('dar de alta el mismo MikroTik otra vez explica el 409', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    // Recién entrado los fixtures están intactos: `goto` no pierde nada y no depende de que el menú
    // navegue antes de que Vite compile la página (la primera visita pasa de 5 s en frío).
    await page.goto('/routers')
    await expect(page.locator('[data-prueba="tabla-routers"]')).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-prueba="nuevo-router"]').click()
    const alta = page.getByRole('dialog', { name: 'Nuevo router' })
    await campo(alta, 'router-nombre').fill('RB-Centro otra vez')
    await campo(alta, 'router-host').fill('10.10.0.1')
    await campo(alta, 'router-nas').fill('10.10.0.9')
    await alta.locator('[data-prueba="router-guardar"]').click()
    const error = alta.locator('[data-prueba="router-duplicado"]')
    await expect(error).toContainText('Ese MikroTik ya está registrado')
    await expect(error).toContainText('«RB-Centro» (router 1): misma dirección de la API (10.10.0.1:443)')
    await expect(page).toHaveURL(/\/routers$/)
})
