import { expect, test, type Page } from '@playwright/test'

/**
 * «Conectar con un botón» (`contratos/iris.md` §1.4), en modo fixtures, a 1280 y 390 px: Iris abre
 * la pantalla de autorización sin sesión, el login vuelve a la misma URL con su query, y «Aprobar»
 * sale del panel a la vuelta de Iris con `#codigo=…&state=…` en el fragmento. Con un origen
 * desconocido hay que escribir el dominio, y «Rechazar» vuelve con `#error=rechazado`. La página de
 * Iris se simula con `page.route`. Capturas (claro y oscuro) en `test-results/capturas-iris-autorizar/`.
 */

const STATE = 'st4te-de-iris_0123456789'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
/** `ORIGENES_IRIS_FIXTURES`: conocido sin confirmar. */
const ORIGEN_CONOCIDO = 'https://iris.argosnet.gt'
const ORIGEN_DESCONOCIDO = 'https://iris.otro-isp.gt:8443'

function urlAutorizar(iris: string): string {
    const query = new URLSearchParams({ iris, state: STATE, code_challenge: CHALLENGE, code_challenge_method: 'S256' })
    return `/integraciones/iris/autorizar?${query.toString()}`
}

/** Iris de mentira: cualquier página de su origen responde un HTML mínimo. */
async function simularIris(page: Page, origen: string): Promise<void> {
    await page.route(`${origen}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Iris</title><p>Iris</p>' }))
}

async function capturar(page: Page, nombre: string): Promise<void> {
    const proyecto = test.info().project.name
    for (const tema of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: tema })
        await page.waitForTimeout(150)
        await page.screenshot({ path: `test-results/capturas-iris-autorizar/${proyecto}-${nombre}-${tema === 'light' ? 'claro' : 'oscuro'}.png`, fullPage: true })
    }
    await page.emulateMedia({ colorScheme: 'light' })
}

async function sinDesborde(page: Page): Promise<void> {
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ancho).toBeLessThanOrEqual(0)
}

/** Llega sin sesión: login con `redirect` = la URL completa, y al entrar vuelve a ella. */
async function llegarSinSesion(page: Page, iris: string): Promise<void> {
    const destino = urlAutorizar(iris)
    await page.goto(destino)
    await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 20_000 })
    // El router puede escribir `:` y `/` sin codificar en la query: se comparan los valores.
    const redirect = new URL(new URL(page.url()).searchParams.get('redirect') ?? '', 'http://panel')
    const esperada = new URL(destino, 'http://panel')
    expect(redirect.pathname).toBe(esperada.pathname)
    expect(Object.fromEntries(redirect.searchParams)).toEqual(Object.fromEntries(esperada.searchParams))
    await page.getByLabel('Correo').fill('admin@argos.test')
    await page.getByLabel('Contraseña').fill('clave-de-prueba')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(url => url.pathname === '/integraciones/iris/autorizar'
        && url.searchParams.get('iris') === iris
        && url.searchParams.get('state') === STATE
        && url.searchParams.get('code_challenge') === CHALLENGE
        && url.searchParams.get('code_challenge_method') === 'S256', { timeout: 20_000 })
}

test('Iris: llegar sin sesión, entrar, aprobar y volver a Iris con el código', async ({ page }) => {
    await simularIris(page, ORIGEN_CONOCIDO)
    await llegarSinSesion(page, ORIGEN_CONOCIDO)

    await expect(page.locator('[data-prueba="autorizar-titulo"]')).toHaveText(`Iris en ${ORIGEN_CONOCIDO} pide conectarse con Argos`)
    await expect(page.locator('[data-prueba="autorizar-alcance-global"]')).toHaveText('Todas las empresas, también las futuras')
    // Sin el menú lateral del panel.
    await expect(page.locator('#dashboard-sidebar-principal')).toHaveCount(0)
    await sinDesborde(page)
    await capturar(page, 'conocido')

    await page.getByRole('button', { name: 'Aprobar' }).click()
    await expect(page).toHaveURL(url => url.origin === ORIGEN_CONOCIDO && url.pathname === '/administracion/integraciones/argos/vuelta', { timeout: 20_000 })
    const fragmento = new URLSearchParams(new URL(page.url()).hash.slice(1))
    expect(fragmento.get('codigo')).toMatch(/^\w{20,}$/)
    expect(fragmento.get('state')).toBe(STATE)
    expect(fragmento.get('api')).toBeTruthy()
    // Nada en la query: todo viaja en el fragmento.
    expect(new URL(page.url()).search).toBe('')
})

test('Iris: origen desconocido exige el dominio; rechazar vuelve con error=rechazado', async ({ page }) => {
    await simularIris(page, ORIGEN_DESCONOCIDO)
    await llegarSinSesion(page, ORIGEN_DESCONOCIDO)

    await expect(page.locator('[data-prueba="autorizar-origen-desconocido"]')).toContainText('Solo aprueba si tú abriste esta conexión desde tu Iris')
    const aprobar = page.getByRole('button', { name: 'Aprobar' })
    await expect(aprobar).toBeDisabled()
    await page.locator('input[data-prueba="autorizar-dominio"]').fill('iris.otro-isp.gt:8443')
    await expect(aprobar).toBeEnabled()
    await sinDesborde(page)
    await capturar(page, 'desconocido')

    await page.getByRole('button', { name: 'Rechazar' }).click()
    await expect(page).toHaveURL(url => url.origin === ORIGEN_DESCONOCIDO && url.pathname === '/administracion/integraciones/argos/vuelta', { timeout: 20_000 })
    expect(new URL(page.url()).hash).toBe(`#error=rechazado&state=${STATE}`)
})
