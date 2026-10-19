import { expect, test } from '@playwright/test'
import { entrar, menu } from './ayudas'

/**
 * Versión instalada y "Qué cambió" en modo fixtures (versión 1.4.2), en escritorio y teléfono: el
 * menú de usuario abre las notas, y quien vio antes la 1.4.1 recibe un aviso discreto una sola vez.
 */
test('qué cambió desde el menú de usuario', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    const contenedor = await menu(page)
    await contenedor.getByRole('button', { name: 'Menú de usuario' }).click()
    await page.getByRole('menuitem', { name: /Qué cambió/ }).click()
    const modal = page.getByRole('dialog', { name: 'Qué cambió en la versión 1.4.2' })
    await expect(modal.locator('[data-prueba="version-cambios"]')).toContainText('programa de lealtad')
    await expect(modal.locator('[data-prueba="version-cambios"]')).toContainText('<script>alert("no")</script> se ve como texto')
    await expect(modal.locator('[data-prueba="version-notas"]')).toHaveAttribute('href', 'https://github.com/HCDestroyer/argos-isp/releases/tag/v1.4.2')
})

test('aviso de versión nueva una sola vez', async ({ page }) => {
    await page.addInitScript(() => {
        try {
            if (!sessionStorage.getItem('prueba_version')) {
                localStorage.setItem('argos_version_vista_1', '1.4.1')
                sessionStorage.setItem('prueba_version', '1')
            }
        }
        catch {
            // Sin almacenamiento la prueba no aplica.
        }
    })
    await entrar(page, 'admin@argos.test')
    const aviso = page.getByText('ArgosIsp se actualizó a la versión 1.4.2', { exact: true })
    await expect(aviso).toBeVisible()
    await page.getByRole('button', { name: 'Qué cambió' }).click()
    await expect(page.getByRole('dialog', { name: 'Qué cambió en la versión 1.4.2' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('argos_version_vista_1'))).toBe('1.4.2')

    await page.reload()
    await expect(page.locator('[id^="dashboard-panel"]').first()).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.getByText('ArgosIsp se actualizó a la versión 1.4.2', { exact: true })).toHaveCount(0)
})
