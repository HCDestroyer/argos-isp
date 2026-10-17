import { expect, test, type Page } from '@playwright/test'
import { entrar, ir, menu } from './ayudas'

/**
 * Sesión deslizante y ventana de bloqueo (`contratos/sesion-panel.md` §4, decisión del PM de la
 * semana 3, tanda 3). En modo fixtures, `argos_fixtures_vencer_sesion` en `localStorage` hace que
 * la siguiente petición responda 401 `sesion_expirada`, como la API con la cookie vencida.
 */
test.skip(Boolean(process.env.PW_BASE_URL), 'Vence la sesión simulada: solo en modo fixtures')

/** La siguiente petición POST (el alta) encuentra la sesión vencida. */
async function vencerSesion(page: Page): Promise<void> {
    await page.evaluate(() => localStorage.setItem('argos_fixtures_vencer_sesion', 'POST'))
}

/** Alta de cliente a medias y la sesión vencida al guardar: se abre la ventana de bloqueo. */
async function altaAMediasYBloqueo(page: Page, nombre: string) {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Clientes', /\/clientes$/)
    await page.getByRole('link', { name: 'Nuevo cliente' }).click()
    await page.getByLabel('Nombre', { exact: true }).fill(nombre)
    await page.getByLabel('Teléfono').fill('5555-4321')
    await vencerSesion(page)
    await page.getByRole('button', { name: 'Crear cliente' }).click()

    const ventana = page.getByRole('dialog', { name: 'Sesión bloqueada' })
    await expect(ventana).toBeVisible()
    await expect(ventana).toContainText('Ana Administradora')
    await expect(ventana).toContainText('admin@argos.test')
    await expect(ventana.getByLabel('Correo')).toHaveCount(0)
    // No se cierra con Esc.
    await page.keyboard.press('Escape')
    await expect(ventana).toBeVisible()
    return ventana
}

test('expira con el alta a medias: se desbloquea, el formulario sigue y el alta se repite', async ({ page }) => {
    const ventana = await altaAMediasYBloqueo(page, 'Rosa Bloqueo Pruebas')
    // Debajo, la página sigue montada con lo escrito.
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Rosa Bloqueo Pruebas')
    await expect(page).toHaveURL(/\/clientes\/nuevo/)

    await ventana.getByLabel('Contraseña').fill('clave-de-prueba')
    await ventana.getByRole('button', { name: 'Desbloquear' }).click()
    await expect(ventana).toBeHidden()

    // La petición que falló (POST /clientes) se repitió: la ficha del cliente nuevo.
    await expect(page).toHaveURL(/\/clientes\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Rosa Bloqueo Pruebas' }).first()).toBeVisible()
})

test('contraseña mala: el error se ve en la ventana y sigue bloqueada', async ({ page }) => {
    const ventana = await altaAMediasYBloqueo(page, 'Teo Clave Mala')
    await ventana.getByLabel('Contraseña').fill('incorrecta')
    await ventana.getByRole('button', { name: 'Desbloquear' }).click()
    await expect(ventana.getByRole('alert').or(ventana.getByText(/credenciales/i)).first()).toBeVisible()
    await expect(ventana).toBeVisible()
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Teo Clave Mala')
})

test('"No soy yo / Salir" va al login completo sin los datos de la sesión', async ({ page }) => {
    const ventana = await altaAMediasYBloqueo(page, 'Uriel No Soy Yo')
    await ventana.getByRole('button', { name: 'No soy yo / Salir' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('Correo')).toBeVisible()
    await expect(page.getByText('Uriel No Soy Yo')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Sesión bloqueada' })).toHaveCount(0)
})

test('a menos de 15 min del tope avisa que guarde su trabajo', async ({ page }) => {
    await entrar(page, 'cajero@argos.test')
    // Mueve el tope de la cookie simulada y recarga en el mismo paso (si no, una petición en vuelo
    // la renovaría y volvería a escribirla).
    const recarga = page.waitForEvent('load')
    await page.evaluate(() => {
        const clave = 'argos_fixtures_cookie_sesion'
        const sesion: Record<string, unknown> = JSON.parse(sessionStorage.getItem(clave) ?? '{}')
        sesion.expiraEn = new Date(Date.now() + 5 * 60_000).toISOString()
        sesion.expiraMaxEn = new Date(Date.now() + 10 * 60_000).toISOString()
        window.addEventListener('beforeunload', () => sessionStorage.setItem(clave, JSON.stringify(sesion)))
        location.reload()
    })
    await recarga
    await menu(page)
    await expect(page.getByText('Tu sesión terminará pronto; guarda tu trabajo').first()).toBeVisible()
})
