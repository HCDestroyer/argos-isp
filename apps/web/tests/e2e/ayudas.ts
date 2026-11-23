import { expect, test, type Locator, type Page } from '@playwright/test'
import { HOY_FIXTURES } from '../../fixtures/facturacion/datos'

/**
 * Piezas comunes de las pruebas de flujo. En modo fixtures los datos viven en memoria: después
 * de entrar se navega por la SPA (menú, enlaces), nunca con `page.goto`, que los reiniciaría.
 */

/**
 * Fija la fecha del navegador en el "hoy" de los fixtures (`HOY_FIXTURES`, mediodía en Guatemala),
 * como `fijarHoyFixtures()` de Vitest: las pantallas comparan contra el reloj real y, sin esto, una
 * factura de los fixtures pasa a vencida cuando el calendario la alcanza. Pone `Date` en esa fecha y
 * lo deja correr desde ahí (`setSystemTime`, no `setFixedTime`): con `Date.now()` congelado, el
 * `USelect` de un modal no llega a abrir sus opciones (bloqueos del libro). Los temporizadores siguen
 * reales. Va antes de `entrar`.
 */
export async function fijarHoyFixtures(page: Page): Promise<void> {
    await page.clock.setSystemTime(new Date(`${HOY_FIXTURES}T18:00:00.000Z`))
}

export async function entrar(page: Page, email: string): Promise<void> {
    await page.goto('/login')
    await page.getByLabel('Correo').fill(email)
    await page.getByLabel('Contraseña').fill('clave-de-prueba')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).not.toHaveURL(/\/login/)
}

/** «Más» de la isla de navegación del teléfono: abre el menú completo a pantalla completa. */
export function botonMasIsla(page: Page): Locator {
    return page.locator('[data-prueba="isla-mas"]')
}

/**
 * Abre el menú si está plegado (teléfono: «Más» de la isla de abajo) y devuelve su contenedor. En
 * escritorio el menú arranca compacto (rail de iconos): se pasa a expandido (con nombres), que queda
 * recordado.
 */
export async function menu(page: Page) {
    const lateral = page.locator('#dashboard-sidebar-principal')
    const abrir = botonMasIsla(page)
    // Esperar a que el layout pinte el menú (escritorio) o la isla que lo abre (teléfono).
    await expect(lateral.getByRole('link', { name: 'Inicio' }).or(abrir).first()).toBeVisible()
    if (!(await lateral.isVisible())) {
        await abrir.click()
    }
    else if (await lateral.locator('[data-prueba="menu-rail"]').isVisible()) {
        await lateral.locator('[data-prueba="alternar-menu"]').click()
        await expect(lateral.locator('[data-prueba="menu-principal"]')).toBeVisible()
    }
    // En teléfono el menú se abre a pantalla completa con los mismos enlaces.
    const abierto = page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Inicio' }) })
    const contenedor = (await lateral.isVisible()) ? lateral : abierto
    await expandirGrupos(contenedor)
    return contenedor
}

/**
 * El menú va en grupos plegables (solo el de la página actual abierto): abre todos para que las
 * pruebas vean cada enlace permitido. Un grupo sin secciones permitidas no existe.
 */
export async function expandirGrupos(contenedor: Locator): Promise<void> {
    const cerrados = contenedor.locator(':is([data-prueba="menu-principal"], [data-prueba="menu-ajustes"]) button[aria-expanded="false"]')
    while (await cerrados.count()) {
        await cerrados.first().click()
    }
}

/** Espera a que `elemento` deje de moverse (misma caja en dos lecturas seguidas). */
async function esperarQuieto(elemento: Locator): Promise<void> {
    let anterior = ''
    await expect.poll(async () => {
        const caja = JSON.stringify(await elemento.boundingBox())
        const quieto = caja === anterior && caja !== 'null'
        anterior = caja
        return quieto
    }, { intervals: [100] }).toBe(true)
}

/** Elige la empresa activa desde el menú del usuario (barra superior). */
export async function elegirEmpresa(page: Page, nombre: string | RegExp): Promise<void> {
    await page.locator('[data-prueba="menu-usuario"]').click()
    await page.getByRole('menuitemcheckbox', { name: nombre }).click()
    await expect(empresaActiva(page)).toContainText(nombre)
}

/** La empresa activa que muestra el botón del usuario. */
export function empresaActiva(page: Page): Locator {
    return page.locator('[data-prueba="empresa-activa"]').first()
}

/** Va a una sección por el menú lateral. */
export async function ir(page: Page, seccion: string, url: RegExp): Promise<void> {
    const contenedor = await menu(page)
    const enlace = contenedor.getByRole('link', { name: seccion, exact: true })
    // Los grupos se abren con animación: con el menú largo, un enlace del final (Integraciones)
    // seguía bajando mientras Playwright lo llevaba a la vista y el clic caía en otro lado.
    await esperarQuieto(enlace)
    await enlace.scrollIntoViewIfNeeded()
    await esperarQuieto(enlace)
    const antes = await enlace.boundingBox()
    await enlace.click()
    try {
        // Con el servidor de desarrollo, la primera visita a una página la compila (varios segundos).
        await expect(page).toHaveURL(url, { timeout: 20_000 })
    }
    catch (error) {
        // Sin reintento: si el clic no navegó, la falla dice qué había en pantalla (menú del
        // teléfono abierto o cerrado, grupos plegados, si el enlace se movió) para hallar la causa.
        const diagnostico = {
            url: page.url(),
            dialogos: await page.getByRole('dialog').count(),
            lateralVisible: await page.locator('#dashboard-sidebar-principal').isVisible(),
            gruposPlegados: await contenedor.locator(':is([data-prueba="menu-principal"], [data-prueba="menu-ajustes"]) button[aria-expanded="false"]').count().catch(() => -1),
            enlaceAntes: antes,
            enlaceDespues: await enlace.boundingBox({ timeout: 1000 }).catch(() => null),
        }
        await test.info().attach('diagnostico-ir', { body: JSON.stringify(diagnostico, null, 2), contentType: 'application/json' })
        throw error
    }
}

/** Abre una pestaña de la ficha del router («Resumen», «Conexión», «Red e IPs», «Velocidad»…). */
export async function pestanaRouter(page: Page, nombre: string): Promise<void> {
    await page.locator('[data-prueba="pestanas-router"]').getByRole('tab', { name: nombre }).click()
}

/**
 * Alta de servicio: elige el router en el buscador (lista desplegable en escritorio, hoja a
 * pantalla completa en el teléfono). `nombre` es el nombre exacto del router.
 */
export async function elegirRouter(page: Page, nombre: string): Promise<void> {
    const hoja = page.locator('[data-prueba="selector-router-hoja"]')
    // Espera a que el selector cargue los routers: en el teléfono es la hoja; en escritorio, la lista.
    await expect(page.locator('[data-prueba="selector-router-hoja"]:visible, [data-prueba="selector-router-menu"]:visible').first()).toBeVisible()
    if (await hoja.isVisible()) {
        await hoja.click()
        const dialogo = page.getByRole('dialog', { name: 'Elegir router' })
        await dialogo.getByPlaceholder('Buscar por nombre, zona o tipo').fill(nombre)
        await dialogo.getByRole('option').filter({ has: page.getByText(nombre, { exact: true }) }).click()
        await expect(dialogo).toBeHidden()
    }
    else {
        await page.locator('[data-prueba="selector-router-menu"]').click()
        await page.getByRole('option').filter({ has: page.getByText(nombre, { exact: true }) }).click()
    }
    await expect(page.locator('[data-prueba="selector-router"]').getByText(nombre, { exact: true }).first()).toBeVisible()
}

/** Ficha del cliente: elige una acción del menú «Más» de la franja («Nuevo servicio», «Ver datos del cliente»…). */
export async function accionCliente(page: Page, nombre: string | RegExp): Promise<void> {
    await page.locator('[data-prueba="mas-cliente"]:visible').first().click()
    await page.getByRole('menuitem', { name: nombre }).click()
}

/** Ficha del cliente: abre «Datos del cliente» (Más › Ver datos del cliente). */
export async function verDatosCliente(page: Page): Promise<void> {
    const datos = page.locator('[data-prueba="datos-cliente"]')
    if (await datos.isVisible()) {
        return
    }
    await accionCliente(page, 'Ver datos del cliente')
    await expect(datos).toBeVisible()
}

/** Datos del alta de un router en «Conectar router» (`/routers/nuevo`, 4 pasos). */
export interface AltaRouter {
    nombre: string
    host: string
    /** Con acceso directo (usuario y clave de la API escritos a mano). */
    apiUsuario?: string
    apiClave?: string
    /** «Sin RADIUS». */
    sinRadius?: boolean
    nas?: string
    corte?: 'codigo' | 'ip'
    /** Por túnel (el script) en vez de acceso directo. */
    tunel?: boolean
}

/**
 * Conectar router (tablero RedRouterNuevo): llena «Equipo» y «Cómo trabaja» y pulsa crear. No
 * espera a la ficha: la prueba decide (un 409 se queda en el paso 2).
 */
export async function conectarRouter(page: Page, datos: AltaRouter): Promise<Locator> {
    await page.goto('/routers/nuevo')
    const pagina = page.locator('[data-prueba="conectar-router"]')
    await expect(pagina).toBeVisible({ timeout: 30_000 })
    await pagina.locator('[data-prueba="router-nombre"] input, input[data-prueba="router-nombre"]').first().fill(datos.nombre)
    if (!datos.tunel) {
        await pagina.locator('[data-prueba="via-conexion"]').getByRole('radio', { name: /Ya tengo acceso directo/ }).click()
    }
    await pagina.locator('[data-prueba="router-host"] input, input[data-prueba="router-host"]').first().fill(datos.host)
    if (datos.apiUsuario) {
        await pagina.getByLabel('Usuario de la API').fill(datos.apiUsuario)
        await pagina.getByLabel('Contraseña de la API').fill(datos.apiClave ?? '')
    }
    await pagina.locator('[data-prueba="seguir-router"]').click()
    await expect(pagina.locator('[data-prueba="paso-como-trabaja"]')).toBeVisible()
    if (datos.sinRadius) {
        await pagina.locator('[data-prueba="modo-seguridad"]').getByRole('radio', { name: /Sin RADIUS/ }).click()
    }
    if (datos.nas) {
        await pagina.locator('[data-prueba="router-nas"] input, input[data-prueba="router-nas"]').first().fill(datos.nas)
    }
    if (datos.corte) {
        await pagina.locator('[data-prueba="corte-identificacion"]').getByRole('radio', { name: datos.corte === 'codigo' ? /^Por código/ : /^Por IP/ }).click()
    }
    await pagina.locator('[data-prueba="seguir-router"]').click()
    return pagina
}

/** Tras crear: «Seguir sin esperar» / «Ir a la ficha del router» lleva a la ficha. */
export async function irAFichaDesdeAlta(page: Page, pagina: Locator): Promise<void> {
    await expect(pagina.locator('[data-prueba="paso-verificar"]')).toBeVisible({ timeout: 20_000 })
    await pagina.locator('[data-prueba="seguir-router"]').click()
    await expect(page).toHaveURL(/\/routers\/\d+$/)
}

/**
 * Ficha del servicio (tablero OperServicioFicha): las acciones van en una fila, la principal a la
 * vista y el resto en «Más». Pulsa la acción por su nombre donde esté.
 */
export async function accionServicio(page: Page, nombre: string | RegExp): Promise<void> {
    const fila = page.locator('[data-prueba="acciones-servicio"]')
    await expect(fila).toBeVisible({ timeout: 30_000 })
    const directo = fila.getByRole('button', { name: nombre, exact: typeof nombre === 'string' })
    if (await directo.count() && await directo.first().isVisible()) {
        await directo.first().click()
        return
    }
    const mas = page.locator('[data-prueba="mas-acciones-servicio"]:visible').or(page.locator('[data-prueba="barra-telefono"]').getByRole('button', { name: 'Más acciones del servicio' }))
    await mas.first().click()
    await page.getByRole('menuitem', { name: nombre }).click()
}

/** ¿La acción está disponible en la ficha del servicio (a la vista o en «Más»)? */
export async function hayAccionServicio(page: Page, nombre: string | RegExp): Promise<boolean> {
    const fila = page.locator('[data-prueba="acciones-servicio"]')
    await expect(fila).toBeVisible({ timeout: 30_000 })
    const directo = fila.getByRole('button', { name: nombre, exact: typeof nombre === 'string' })
    if (await directo.count() && await directo.first().isVisible()) {
        return true
    }
    const mas = page.locator('[data-prueba="mas-acciones-servicio"]:visible').or(page.locator('[data-prueba="barra-telefono"]').getByRole('button', { name: 'Más acciones del servicio' }))
    if (!await mas.count()) {
        return false
    }
    await mas.first().click()
    const hay = await page.getByRole('menuitem', { name: nombre }).count() > 0
    await page.keyboard.press('Escape')
    return hay
}

/** Ficha del servicio: abre una pestaña (Resumen, Red y equipo, Facturas, Contactos, Bitácora, Portal de corte). */
export async function pestanaServicio(page: Page, nombre: string): Promise<void> {
    await page.locator('[data-prueba="pestanas-servicio"]').getByRole('tab', { name: nombre }).click()
}

/**
 * Cobro POS (tablero NuevoCobro): busca al cliente, lo elige y, en el teléfono, pasa a la segunda
 * pantalla con «Continuar». Devuelve el botón «Cobrar Q …» (no lo pulsa).
 */
export async function elegirClienteCobro(page: Page, buscar: string, nombre: RegExp): Promise<Locator> {
    // Sin caja abierta, la ventana «Abrir caja» aparece sola: «Ahora no» la cierra.
    const ahoraNo = page.getByRole('button', { name: 'Ahora no' })
    if (await ahoraNo.isVisible().catch(() => false)) {
        await ahoraNo.click()
    }
    await page.getByPlaceholder(/Buscar cliente: nombre/).fill(buscar)
    await page.getByRole('option', { name: nombre }).click()
    const continuar = page.locator('[data-prueba="continuar-cobro"]')
    if (await continuar.isVisible()) {
        await continuar.click()
    }
    return page.locator('[data-prueba="cobrar"]')
}
