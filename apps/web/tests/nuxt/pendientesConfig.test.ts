import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { CORREO_LIMITADO_FIXTURE, TOKEN_RECUPERACION_FIXTURE, UNIDAD_CON_INTENTOS } from '~~/fixtures/operacionPm/datos'
import PaginaRedPortal from '~/pages/configuracion/portal-corte.vue'
import PaginaReglasCobro from '~/pages/configuracion/reglas-cobro.vue'
import PaginaBancosOrigen from '~/pages/configuracion/bancos-origen.vue'
import PaginaReportes from '~/pages/configuracion/reportes.vue'
import PaginaLogin from '~/pages/login.vue'
import PaginaDeclarar from '~/pages/inventario/por-recuperar/[id].vue'
import PaginaTecnicosIris from '~/pages/inventario/tecnicos-iris.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pantallas de «Pendientes del backend» (tableros OperLogin, OperConfigRed, OperConfigCobro,
 * PendEnviosReportes, OperConfigIntegraciones, PendIntentosRecuperacion y PendVinculosTecnicos):
 * composables contra los fixtures fieles a la API, esquemas espejo y lo que cada pantalla manda.
 */
function enApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

const montadas: { unmount: () => void }[] = []

async function montar(componente: Component, route: string) {
    const vista = await mountSuspended(enApp(componente), { route, attachTo: document.body })
    montadas.push(vista)
    return vista
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function boton(texto: string): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().includes(texto))
}

async function escribir(selector: string, valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(selector)
    if (!campo) {
        throw new Error(`Sin campo ${selector}`)
    }
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
    campo.dispatchEvent(new Event('change'))
    campo.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
}

beforeEach(async () => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().inicializar()
    await flushPromises()
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
    localStorage.clear()
    for (const vista of montadas.splice(0)) {
        vista.unmount()
    }
})

describe('login · recuperar la contraseña (decisión 22)', () => {
    it('opciones públicas: recuperar encendido de fábrica; Iris y Horus según su conector', async () => {
        const r = await useRecuperacionContrasena().opciones()
        expect(r.ok && r.data).toEqual({ recuperar_contrasena: true, iris: false, horus: false })
        await useAjustesOperacion().guardar(null, { 'auth.recuperar_contrasena': false })
        const apagada = await useRecuperacionContrasena().opciones()
        expect(apagada.ok && apagada.data.recuperar_contrasena).toBe(false)
        const pedido = await useRecuperacionContrasena().pedirEnlace('admin@argos.test')
        expect(!pedido.ok && codigoProblema(pedido.problema)).toBe('recuperacion_apagada')
    })

    it('misma respuesta exista o no el correo; 429 demasiadas_solicitudes; el enlace vale una vez', async () => {
        const existe = await useRecuperacionContrasena().pedirEnlace('admin@argos.test')
        const noExiste = await useRecuperacionContrasena().pedirEnlace('nadie@argos.test')
        expect(existe.ok && existe.data).toEqual({ aceptada: true })
        expect(noExiste.ok && noExiste.data).toEqual({ aceptada: true })
        const limitado = await useRecuperacionContrasena().pedirEnlace(CORREO_LIMITADO_FIXTURE)
        expect(!limitado.ok && codigoProblema(limitado.problema)).toBe('demasiadas_solicitudes')
        const cambio = await useRecuperacionContrasena().restablecer(TOKEN_RECUPERACION_FIXTURE, 'nueva-clave-segura')
        expect(cambio.ok && cambio.data.sesiones_cerradas).toBe(2)
        const otraVez = await useRecuperacionContrasena().restablecer(TOKEN_RECUPERACION_FIXTURE, 'nueva-clave-segura')
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('enlace_invalido')
    })

    it('el esquema pide 8 caracteres y que coincidan', () => {
        expect(esquemaRestablecerContrasena.safeParse({ password: 'corta', repetir: 'corta' }).success).toBe(false)
        expect(esquemaRestablecerContrasena.safeParse({ password: 'larga-123', repetir: 'otra-1234' }).success).toBe(false)
        expect(esquemaRestablecerContrasena.safeParse({ password: 'larga-123', repetir: 'larga-123' }).success).toBe(true)
    })

    it('«¿La olvidaste?» abre la recuperación y muestra «Revisa tu correo»', async () => {
        useUsuarioActual().value = null
        sesionFixture(null)
        await montar(PaginaLogin, '/login')
        await esperar(() => expect(enBody('olvidaste')).not.toBeNull())
        enBody('olvidaste')!.click()
        await esperar(() => expect(document.body.textContent).toContain('¿Olvidaste tu contraseña?'))
        await escribir('input[type="email"]', 'admin@argos.test')
        enBody('mandar-enlace')!.closest('form')!.requestSubmit()
        await esperar(() => expect(enBody('recuperar-enviado')?.textContent).toContain('admin@argos.test'))
    })
})

describe('configuración · red y portal (ajustes de operación)', () => {
    it('efectivo = empresa → global → fábrica; una clave solo global no se guarda por empresa', async () => {
        const ajustes = useAjustesOperacion()
        const fabrica = await ajustes.ver(null)
        expect(fabrica.ok && fabrica.data.efectivo['codigo_corte.vigencia_min']).toBe(15)
        await ajustes.guardar(null, { 'codigo_corte.vigencia_min': 20 })
        await ajustes.guardar(2, { 'codigo_corte.vigencia_min': 30 })
        const empresa1 = await ajustes.ver(1)
        const empresa2 = await ajustes.ver(2)
        expect(empresa1.ok && empresa1.data.efectivo['codigo_corte.vigencia_min']).toBe(20)
        expect(empresa2.ok && empresa2.data.efectivo['codigo_corte.vigencia_min']).toBe(30)
        const soloGlobal = await ajustes.guardar(2, { 'retiro.orden_iris': false })
        expect(!soloGlobal.ok && soloGlobal.problema.errors?.[0]?.field).toBe('valores.retiro.orden_iris')
        const fuera = await ajustes.guardar(null, { 'codigo_corte.vigencia_min': 90 })
        expect(!fuera.ok && fuera.problema.status).toBe(422)
    })

    it('el esquema espejo usa los límites de la API y el umbral en porcentaje llega a 100', async () => {
        const r = await useAjustesOperacion().ver(null)
        if (!r.ok) {
            throw new Error('sin ajustes')
        }
        const esquema = esquemaAjustesOperacion(r.data.definiciones)
        const base = { ...r.data.efectivo } as Record<string, ValorAjusteOperacion>
        expect(esquema.safeParse(base).success).toBe(true)
        expect(esquema.safeParse({ ...base, 'caidas.umbral': 1 }).success).toBe(false)
        expect(esquema.safeParse({ ...base, 'falla_general.umbral': 150 }).success).toBe(false)
        expect(esquema.safeParse({ ...base, 'falla_general.modo': 'cantidad', 'falla_general.umbral': 150 }).success).toBe(true)
        expect(umbralFallaGeneral(410, 'porcentaje', 30, 5)).toBe(123)
    })

    it('en una empresa: guarda solo lo que cambió y «Usar el de Todas» lo borra', async () => {
        await montar(PaginaRedPortal, '/configuracion/portal-corte?pestana=caidas')
        await esperar(() => expect(document.body.querySelector('[data-ajuste="caidas.umbral"] input')).not.toBeNull())
        document.body.querySelector<HTMLElement>('[data-ambito="1"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-ajuste="caidas.umbral"]')?.textContent).toContain('Igual que «Todas»'))
        await escribir('[data-ajuste="caidas.umbral"] input', '4')
        enBody('portal-corte-guardar')!.click()
        await esperar(() => expect(bd.operacionPm.ajustesEmpresa[1]).toEqual({ 'caidas.umbral': 4 }))
        expect(bd.operacionPm.ajustesGlobal).toEqual({})
        await esperar(() => expect(document.body.querySelector('[data-ajuste="caidas.umbral"]')?.textContent).toContain('Propio de esta empresa'))
        boton('Usar el de «Todas»')!.click()
        await esperar(() => expect(bd.operacionPm.ajustesEmpresa[1]).toEqual({}))
    })
})

describe('configuración · facturación y cobro', () => {
    it('reglas de cobro: sin empresa pide elegirla; con empresa guarda con su versión', async () => {
        useEmpresaActiva().elegir('todas')
        await montar(PaginaReglasCobro, '/configuracion/reglas-cobro')
        await esperar(() => expect(enBody('reglas-cobro-elige-empresa')).not.toBeNull())
        useEmpresaActiva().elegir(1)
        await esperar(() => expect(enBody('pausa-tope')).not.toBeNull())
        await escribir('[data-prueba="pausa-tope"] input, input[data-prueba="pausa-tope"]', '45')
        enBody('reglas-cobro-guardar')!.click()
        await esperar(() => expect(bd.operacionPm.ajustesCobro[1]).toMatchObject({ pausa_tope_dias: 45, version: 1, asientos_requieren_aprobacion: false }))
        const vieja = await useAjustesCobro().editar(0, { pausa_tope_dias: 10 })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('impresión por caja: se guarda en la caja, no en el navegador', async () => {
        const caja = bd.cajas[0]!
        const r = await useImpresionCajas().configurar(caja, { formato_recibo: 'carta' })
        expect(r.ok && r.data).toMatchObject({ formato_recibo: 'carta', formato_factura: 'carta', version: caja.version })
        expect(localStorage.length).toBe(0)
    })

    it('bancos de origen: agregar para todas; ocultar solo en la empresa activa (y GET /bancos ya no lo trae)', async () => {
        useEmpresaActiva().elegir(1)
        const nuevo = await useBancosOrigen().crear({ nombre: 'Banco Nexa Plus' })
        expect(nuevo.ok && nuevo.data).toMatchObject({ nombre: 'Banco Nexa Plus', activo: true, oculto: false })
        const duplicado = await useBancosOrigen().crear({ nombre: 'banco nexa plus' })
        expect(!duplicado.ok && codigoProblema(duplicado.problema)).toBe('banco_duplicado')
        const banrural = bd.bancos.find(b => b.nombre === 'Banrural')!
        const oculto = await useBancosOrigen().ocultar(banrural.id)
        expect(oculto.ok && oculto.data.oculto).toBe(true)
        const lista = await useBancos().listar()
        expect(lista.ok && lista.data.some(b => b.id === banrural.id)).toBe(false)
        useEmpresaActiva().elegir(2)
        const otra = await useBancos().listar()
        expect(otra.ok && otra.data.some(b => b.id === banrural.id)).toBe(true)
    })

    it('la pantalla de bancos marca los ocultos de la empresa', async () => {
        useEmpresaActiva().elegir(1)
        const banrural = bd.bancos.find(b => b.nombre === 'Banrural')!
        bd.operacionPm.bancosOcultos[1] = [banrural.id]
        await montar(PaginaBancosOrigen, '/configuracion/bancos-origen')
        await esperar(() => expect(document.body.querySelector('[data-banco="Banrural"]')?.getAttribute('data-oculto')).toBe('true'))
        expect(enBody('agregar-banco')?.hasAttribute('disabled')).toBe(false)
    })
})

describe('configuración · reportes', () => {
    it('días para contar una baja: de la empresa activa, 60 de fábrica', async () => {
        useEmpresaActiva().elegir(1)
        const leida = await usePanelFinancieroAjustes().ver()
        expect(leida.ok && leida.data).toMatchObject({ dias_baja: 60, fabrica: true, version: 1 })
        const guardada = await usePanelFinancieroAjustes().guardar(90, 1)
        expect(guardada.ok && guardada.data).toMatchObject({ dias_baja: 90, fabrica: false, version: 2 })
    })

    it('correos externos: aprobar, retirar y reactivar', async () => {
        await montar(PaginaReportes, '/configuracion/reportes')
        await esperar(() => expect(document.body.querySelector('[data-correo="contador@despachomm.gt"]')).not.toBeNull())
        const r = await useCorreosExternos().aprobar({ correo: 'Socio@Ejemplo.gt', nombre: 'Socio' })
        expect(r.ok && r.data).toMatchObject({ correo: 'socio@ejemplo.gt', activo: true })
        const retirado = await useCorreosExternos().retirar(1)
        expect(retirado.ok && retirado.data).toMatchObject({ activo: false })
        const otraVez = await useCorreosExternos().aprobar({ correo: 'contador@despachomm.gt', nombre: 'Despacho' })
        expect(otraVez.ok && otraVez.data).toMatchObject({ id: 1, activo: true, retirado_en: null })
    })
})

describe('configuración · SmartOLT y GenieACS', () => {
    it('guardar nunca devuelve el secreto; cambiar la URL borra la prueba; probar deja el resultado', async () => {
        useEmpresaActiva().elegir(1)
        const equipos = useEquiposIntegracion()
        const guardada = await equipos.guardar(0, { activo: true, smartolt_url: 'https://miisp.smartolt.com', smartolt_token: 'secreto-123', genieacs_url: 'https://acs-falla.miisp.gt' })
        expect(guardada.ok && guardada.data.smartolt).toMatchObject({ url: 'https://miisp.smartolt.com', token: '***', prueba_ok: null })
        expect(JSON.stringify(guardada.ok && guardada.data)).not.toContain('secreto-123')
        const prueba = await equipos.probar()
        expect(prueba.ok && prueba.data.smartolt).toMatchObject({ ok: true })
        expect(prueba.ok && prueba.data.genieacs).toMatchObject({ ok: false })
        expect(prueba.ok && prueba.data.capacidades).toEqual({ ftth: true, wireless: true, tr069: false })
        const leida = await equipos.ver()
        expect(leida.ok && estadoEquipos(leida.data, 'genieacs').etiqueta).toBe('No responde')
        const cambio = await equipos.guardar(leida.ok ? leida.data.version : 0, { smartolt_url: 'https://otro.smartolt.com' })
        expect(cambio.ok && cambio.data.smartolt.prueba_ok).toBeNull()
        expect(cambio.ok && cambio.data.smartolt.token).toBe('***')
    })
})

describe('inventario · intentos de recuperación y técnicos de Iris', () => {
    it('al abrir verifica con Iris; el intento anterior se decide y cuenta', async () => {
        await montar(PaginaDeclarar, `/inventario/por-recuperar/${UNIDAD_CON_INTENTOS}`)
        await esperar(() => expect(enBody('tecnicos-cuentan')?.textContent).toContain('1 de 2'))
        expect(enBody('todavia-no')).not.toBeNull()
        expect(enBody('declarar')?.hasAttribute('disabled')).toBe(true)
        const r = await useIntentosRecuperacion().listar(UNIDAD_CON_INTENTOS)
        const anterior = r.ok ? r.data.intentos.find(i => i.verificacion === 'anterior') : undefined
        expect(anterior?.cuenta).toBe(false)
        const decision = await useIntentosRecuperacion().decidir(anterior!.id, true, 'La foto muestra la casa', nuevaClaveIdempotencia())
        expect(decision.ok && decision.data.verificacion).toBe('aceptado')
        const otraVez = await useIntentosRecuperacion().decidir(anterior!.id, false, 'otra vez', nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('intento_ya_decidido')
        const despues = await useIntentosRecuperacion().listar(UNIDAD_CON_INTENTOS)
        expect(despues.ok && despues.data.tecnicos_que_cuentan).toBe(2)
    })

    it('técnicos de Iris: los rechazados con su motivo y «Conciliar»', async () => {
        const sinIris = await useVinculosTecnicos().conciliar({ empresa_id: 1, iris_usuario_id: 'iris-u-131' })
        expect(sinIris.ok && sinIris.data).toMatchObject({ resultado: 'error', motivo: 'sin_conector' })
        bd.iris.conector = { ...bd.iris.conector, activo: true, url_base: 'https://iris.argosnet.gt' }
        await montar(PaginaTecnicosIris, '/inventario/tecnicos-iris')
        await esperar(() => expect(document.body.querySelector('[data-vinculo="iris-u-118"]')).not.toBeNull())
        expect(document.body.textContent).toContain('Ese id ya lo usa otro técnico')
        document.body.querySelector<HTMLElement>('[data-conciliar="iris-u-131"]')!.click()
        await esperar(() => expect(enBody('resultado-conciliar')?.textContent).toContain('quedó vinculado'))
        expect(bd.operacionPm.vinculos.find(v => v.iris_usuario_id === 'iris-u-131')?.estado).toBe('vinculado')
    })
})
