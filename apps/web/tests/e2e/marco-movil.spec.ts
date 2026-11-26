import { expect, test, type Locator, type Page } from '@playwright/test'
import { entrar, ir, llenarFecha } from './ayudas'

/**
 * Marco del teléfono (tablero MarcoMovil): la acción principal de cada pantalla va en la isla fija
 * justo encima de la isla de navegación, con su texto, y el contenido se puede desplazar hasta el
 * final sin que nada quede debajo de las islas. En escritorio la acción va en el encabezado. Se
 * revisa una lista (Servicios), una ficha (perfil de QoS) y un formulario de Configuración (empresa,
 * con «Descartar / Guardar»), más el campo de fecha en dd/mm/aaaa.
 */

const esTelefono = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024

/** La caja de un elemento visible (falla con su nombre si no la tiene). */
async function caja(elemento: Locator) {
    const rect = await elemento.boundingBox()
    expect(rect, 'el elemento debe estar en pantalla').not.toBeNull()
    return rect!
}

/** En el teléfono, la barra queda entera encima de la isla de navegación, sin tocarla. */
async function encimaDeLaIsla(page: Page, barra: Locator): Promise<void> {
    const isla = await caja(page.locator('[data-prueba="isla-movil"]'))
    const rect = await caja(barra)
    expect(rect.y + rect.height).toBeLessThanOrEqual(isla.y)
    expect(rect.y).toBeGreaterThan(page.viewportSize()!.height / 2)
}

/** Desplaza el cuerpo de la página hasta el final. */
async function alFinal(page: Page): Promise<void> {
    await page.locator('.panel-cuerpo').first().evaluate((cuerpo) => {
        cuerpo.scrollTop = cuerpo.scrollHeight
    })
}

test('lista: «Nuevo servicio» con su texto, en la isla fija del teléfono o en el encabezado', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Servicios', /\/servicios$/)
    const principal = page.locator('[data-prueba="accion-principal"]')
    const boton = principal.getByRole('link', { name: 'Nuevo servicio' })
    await expect(boton).toBeVisible()
    await expect(boton).toContainText('Nuevo servicio')
    if (esTelefono(page)) {
        await encimaDeLaIsla(page, principal)
        // La última fila de la lista se puede llevar por encima de la barra.
        await alFinal(page)
        const ultima = page.locator('.panel-cuerpo').first().locator(':scope > *').last()
        const rectUltima = await caja(ultima)
        const rectBarra = await caja(principal)
        expect(rectUltima.y + rectUltima.height).toBeLessThanOrEqual(rectBarra.y + 1)
    }
    else {
        const encabezado = await caja(page.locator('[data-prueba="encabezado-pagina"], [data-prueba="encabezado-ficha"]').first())
        const rect = await caja(boton)
        expect(rect.y).toBeLessThan(encabezado.y + encabezado.height)
    }
    await boton.click()
    await expect(page).toHaveURL(/\/servicios\/nuevo$/)
})

test('ficha: «Copiar perfil» de QoS es la acción principal y abre su ventana', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Prioridad (QoS)', /\/red\/qos$/)
    // La lista también lleva su acción principal con texto.
    await expect(page.locator('[data-prueba="accion-principal"]').getByRole('button', { name: 'Nuevo perfil' })).toBeVisible()
    await page.locator('[data-prueba="perfil-qos-1"]').click()
    await expect(page).toHaveURL(/\/red\/qos\/1$/)
    const principal = page.locator('[data-prueba="accion-principal"]')
    const copiar = principal.getByRole('button', { name: 'Copiar perfil' })
    await expect(copiar).toBeVisible()
    if (esTelefono(page)) {
        await encimaDeLaIsla(page, principal)
    }
    await copiar.click()
    await expect(page.getByRole('dialog')).toBeVisible()
})

test('formulario de Ajustes: «Descartar / Guardar» fijos abajo y el último campo alcanzable', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await page.goto('/configuracion/empresa')
    const pie = page.locator('[data-prueba="pie-configuracion"]')
    const guardar = pie.getByRole('button', { name: 'Guardar' })
    await expect(guardar).toBeVisible()
    const campos = page.locator('[data-prueba="tarjeta-configuracion"] :is(input, textarea, [role="combobox"])')
    await expect(campos.first()).toBeVisible()
    if (esTelefono(page)) {
        await encimaDeLaIsla(page, pie)
        await alFinal(page)
        const ultimo = campos.last()
        await ultimo.scrollIntoViewIfNeeded()
        const rectCampo = await caja(ultimo)
        const rectPie = await caja(pie)
        expect(rectCampo.y + rectCampo.height).toBeLessThanOrEqual(rectPie.y)
        // Editar el último campo habilita «Guardar» sin salir de la vista.
        await ultimo.click()
        await expect(pie).toBeVisible()
    }
    else {
        // En escritorio el pie va al final de la tarjeta, dentro de ella.
        const tarjeta = await caja(page.locator('[data-prueba="tarjeta-configuracion"]'))
        const rectPie = await caja(pie)
        expect(rectPie.y + rectPie.height).toBeLessThanOrEqual(tarjeta.y + tarjeta.height + 1)
    }
})

test('campo de fecha en dd/mm/aaaa: barras solas, y el calendario escribe la fecha', async ({ page }) => {
    await entrar(page, 'admin@argos.test')
    await ir(page, 'Bloqueos del libro', /\/libro\/bloqueos/)
    await page.locator('[data-prueba="bloqueos-empresa"]').first().locator('[data-prueba="abrir-bloquear"]').click()
    const ventana = page.getByRole('dialog', { name: 'Bloquear el libro' })
    const fecha = ventana.locator('input[data-prueba="bloqueo-hasta"]')
    await expect(fecha).toHaveAttribute('placeholder', 'dd/mm/aaaa')
    // Solo números: las barras se ponen solas.
    await fecha.pressSequentially('31082026')
    await expect(fecha).toHaveValue('31/08/2026')
    await llenarFecha(fecha, '2026-07-31')
    // El calendario abre en el mes escrito y al elegir un día lo escribe en dd/mm/aaaa.
    await ventana.locator('[data-prueba="campo-fecha-calendario"]').click()
    const dia = page.getByRole('button', { name: /15 de julio de 2026/ })
    await expect(dia).toBeVisible()
    await dia.click()
    await expect(fecha).toHaveValue('15/07/2026')
})

test.describe('cuenta en el teléfono: panel desde abajo (tablero PerfilDrawer)', () => {
    test.skip(({ isMobile }) => !isMobile, 'En la computadora la cuenta es el menú desplegable del círculo')

    test('desde el círculo: empresa, tema y Esc lo cierra', async ({ page }) => {
        await entrar(page, 'admin@argos.test')
        await page.locator('[data-prueba="menu-usuario"]').click()
        const panel = page.getByRole('dialog', { name: 'Tu cuenta' })
        await expect(panel).toBeVisible()
        // Arriba la empresa activa con su NIT; el tema a la vista; filas de 48 px o más.
        await expect(panel.locator('[data-prueba="cuenta-empresas"]')).toContainText('NIT 1234567-8')
        for (const fila of ['cuenta-mi-cuenta', 'cuenta-que-cambio', 'cuenta-cerrar-sesion']) {
            expect((await panel.locator(`[data-prueba="${fila}"]`).boundingBox())!.height).toBeGreaterThanOrEqual(48)
        }
        // El panel termina en el borde de abajo, a la altura del pulgar.
        const caja = (await panel.boundingBox())!
        expect(Math.abs(caja.y + caja.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1)

        await panel.locator('[data-tema="dark"]').click()
        await expect(page.locator('html')).toHaveClass(/dark/)
        await panel.locator('[data-tema="light"]').click()
        await expect(page.locator('html')).not.toHaveClass(/dark/)

        await panel.locator('[data-prueba="cuenta-empresas"]').getByRole('radio', { name: /Fibra del Sur/ }).click()
        await expect(panel).toBeHidden()
        await expect(page.getByRole('listitem').getByText('Empresa activa: Fibra del Sur')).toBeVisible()
        await expect(page.locator('[data-prueba="empresa-activa"]').first()).toContainText('Fibra del Sur')

        await page.locator('[data-prueba="menu-usuario"]').click()
        await expect(panel).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(panel).toBeHidden()
    })

    test('desde la fila de la cuenta arriba de «Más»: primero se cierra «Más»', async ({ page }) => {
        await entrar(page, 'admin@argos.test')
        await page.locator('[data-prueba="isla-mas"]').click()
        const fila = page.getByRole('dialog').locator('[data-prueba="mas-cuenta"]')
        await expect(fila).toContainText('Ana Administradora')
        // «Ayuda» ya no va suelta en «Más»: vive en el panel de la cuenta.
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Ayuda de esta pantalla' })).toHaveCount(0)
        await fila.click()
        const panel = page.getByRole('dialog', { name: 'Tu cuenta' })
        await expect(panel).toBeVisible()
        // Nunca dos paneles a la vez.
        await expect(page.getByRole('dialog')).toHaveCount(1)
        await expect(panel.locator('[data-prueba="cuenta-ayuda"]')).toBeVisible()
        await panel.locator('[data-prueba="cuenta-ayuda"]').click()
        await expect(panel).toBeHidden()
        await expect(page.locator('[data-prueba="ayuda-resumen"]')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(1)
    })
})
