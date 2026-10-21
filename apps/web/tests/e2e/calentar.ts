import { chromium, expect, type FullConfig } from '@playwright/test'

/**
 * Calienta `nuxt dev` antes de la primera prueba. El `webServer` de Playwright da el servidor por
 * listo cuando responde el shell, pero Vite compila los módulos al pedirlos: con el servidor en
 * frío la página de login tardaba ~19 s en pintarse y la primera navegación después de entrar
 * ~5.5 s, más que los 5 s de `entrar()`, y la primera prueba de cada corrida fallaba en el login.
 * Aquí se recorre una vez login → inicio con márgenes amplios; después cada prueba encuentra los
 * módulos ya compilados. No es un reintento: ninguna prueba se repite.
 *
 * Solo con el servidor que levanta Playwright (modo fixtures); con `PW_BASE_URL` el panel ya corre
 * aparte y sus credenciales no son las de los fixtures.
 */
export default async function calentar(config: FullConfig): Promise<void> {
    if (process.env.PW_BASE_URL) {
        return
    }
    const baseURL = config.projects[0]?.use.baseURL
    if (!baseURL) {
        return
    }
    const navegador = await chromium.launch()
    try {
        const page = await navegador.newPage({ baseURL })
        await page.goto('/login', { timeout: 180_000 })
        await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible({ timeout: 180_000 })
        await page.getByLabel('Correo').fill('admin@argos.test')
        await page.getByLabel('Contraseña').fill('calentar')
        await page.getByRole('button', { name: 'Entrar' }).click()
        await expect(page).not.toHaveURL(/\/login/, { timeout: 180_000 })
        await expect(page.getByRole('link', { name: 'Inicio' }).first()).toBeVisible({ timeout: 180_000 })
    }
    finally {
        await navegador.close()
    }
}
