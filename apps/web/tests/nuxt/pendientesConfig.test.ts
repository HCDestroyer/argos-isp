import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { usuariosPorToken } from '~~/fixtures/comun'
import { tableroEmpresa } from '~~/fixtures/tablero/rutas'
import { CORREO_LIMITADO_FIXTURE, TOKEN_RECUPERACION_FIXTURE, UNIDAD_CON_INTENTOS } from '~~/fixtures/operacionPm/datos'
import PaginaRedPortal from '~/pages/configuracion/portal-corte.vue'
import PaginaReglasCobro from '~/pages/configuracion/reglas-cobro.vue'
import PaginaBancosOrigen from '~/pages/configuracion/bancos-origen.vue'
import PaginaReportes from '~/pages/configuracion/reportes.vue'
import PaginaFiscal from '~/pages/configuracion/fiscal.vue'
import PaginaFinanzas from '~/pages/finanzas/index.vue'
import PaginaEnvios from '~/pages/reportes/envios.vue'
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

/** Lo facturado en el año por la empresa, como lo calcula el tablero fiscal del fixture. */
function acumuladoPc(empresaId: number): number {
    const datos = tableroEmpresa(empresaId, hoyGuatemala()).bloques.pequeno_contribuyente.datos
    return datos ? Number(datos.acumulado) : 0
}

/** Un límite anual propio de la empresa para llevarla al porcentaje que pida la prueba. */
function limitePc(empresaId: number, valor: string, desde?: string) {
    const hoy = hoyGuatemala()
    bd.fiscal.valores.push({
        id: 9_000 + bd.fiscal.valores.length,
        pais: 'GT',
        empresa_id: empresaId,
        clave: 'pc_limite_anual',
        valor,
        vigente_desde: desde ?? `${hoy.slice(0, 4)}-01-01`,
        origen: 'usuario',
        motivo: 'Prueba del aviso',
        creado_por: null,
        created_at: `${hoy}T00:00:00.000Z`,
        nivel: 'empresa',
    })
}

function botonEn(prueba: string, texto: string): HTMLButtonElement | undefined {
    return [...(enBody(prueba)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(b => b.textContent?.trim().includes(texto))
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
    usuariosPorToken['fixture-admin'] = meAdmin
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
        expect(r.ok && r.data).toEqual({ recuperar_contrasena: true, iris: false, horus: false, iris_url: null, horus_url: null })
        bd.iris.conector = { ...bd.iris.conector, activo: true, url_base: 'https://iris.argosnet.gt/api/v1' }
        const conIris = await useRecuperacionContrasena().opciones()
        expect(conIris.ok && conIris.data).toMatchObject({ iris: true, iris_url: 'https://iris.argosnet.gt', horus: false, horus_url: null })
        bd.iris.conector = { ...bd.iris.conector, activo: false }
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
        const guardada = await usePanelFinancieroAjustes().guardar({ dias_baja: 90, version: 1 })
        // Como la API: la primera vez se inserta la fila con su `version` de fábrica (1); luego sube.
        expect(guardada.ok && guardada.data).toMatchObject({ dias_baja: 90, fabrica: false, version: 1 })
        const otra = await usePanelFinancieroAjustes().guardar({ dias_baja: 30, version: 1 })
        expect(otra.ok && otra.data).toMatchObject({ dias_baja: 30, version: 2 })
    })

    it('la pantalla de Reportes ya no trae el aviso de pequeño contribuyente (se movió a Fiscal)', async () => {
        useEmpresaActiva().elegir(2)
        await montar(PaginaReportes, '/configuracion/reportes')
        await esperar(() => expect(enBody('bloque-bajas')).not.toBeNull())
        expect(enBody('bloque-aviso-pc')).toBeNull()
        expect(enBody('aviso-pc-activo')).toBeNull()
    })
})

describe('configuración · fiscal · aviso de pequeño contribuyente', () => {
    it('umbrales de pc_alertas, aplica según el régimen y apagadas en las alertas', async () => {
        useEmpresaActiva().elegir(2)
        const leida = await usePanelFinancieroAjustes().ver()
        expect(leida.ok && leida.data).toMatchObject({ aviso_pc_activo: true, aviso_pc_umbrales: ['80.00', '100.00'], aviso_pc_umbrales_nivel: 'paquete', aviso_pc_aplica: true })
        const umbrales = await usePanelFinancieroAjustes().guardar({ aviso_pc_umbrales: ['95', '80'], version: 1 })
        expect(umbrales.ok && umbrales.data).toMatchObject({ aviso_pc_umbrales: ['80.00', '95.00'], aviso_pc_umbrales_nivel: 'empresa', version: 1 })
        const otraVez = await usePanelFinancieroAjustes().guardar({ aviso_pc_umbrales: ['90'], version: 1 })
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('vigencia_duplicada')
        const iguales = await usePanelFinancieroAjustes().guardar({ aviso_pc_umbrales: ['80.00', '95.00'], aviso_pc_activo: false, version: 1 })
        expect(iguales.ok && iguales.data).toMatchObject({ aviso_pc_activo: false, fabrica: false, version: 1 })
        const alertas = await usePanelFinancieroAjustes().alertas()
        expect(alertas.ok && alertas.data.empresas.find(e => e.empresa_id === 2)?.apagadas).toEqual(['limite_pequeno_contribuyente'])

        useEmpresaActiva().elegir(1)
        const utilidades = await usePanelFinancieroAjustes().ver()
        expect(utilidades.ok && utilidades.data.aviso_pc_aplica).toBe(false)
    })

    it('apagado no salen el 80 % ni el 95 %; el límite superado (100 %) sale siempre', async () => {
        const acumulado = acumuladoPc(2)
        expect(acumulado).toBeGreaterThan(0)
        const alertaPc = async () => {
            const r = await usePanelFinancieroAjustes().alertas()
            const fila = r.ok ? r.data.empresas.find(e => e.empresa_id === 2) : undefined
            return { apagadas: fila?.apagadas, alerta: fila?.alertas.find(a => a.tipo === 'limite_pequeno_contribuyente') ?? null }
        }
        useEmpresaActiva().elegir(2)
        // Lleva el 85 % del límite: encendido avisa; apagado, no.
        limitePc(2, (acumulado / 0.85).toFixed(2))
        expect((await alertaPc()).alerta).not.toBeNull()
        const apagado = await usePanelFinancieroAjustes().guardar({ aviso_pc_activo: false, version: 1 })
        expect(apagado.ok).toBe(true)
        expect(await alertaPc()).toEqual({ apagadas: ['limite_pequeno_contribuyente'], alerta: null })
        // Superó el límite: sale aunque el aviso esté apagado.
        limitePc(2, (acumulado / 2).toFixed(2))
        const superado = await alertaPc()
        expect(superado.apagadas).toEqual(['limite_pequeno_contribuyente'])
        expect(superado.alerta).toMatchObject({ nivel: 'critico', titulo: 'Superó el límite anual del pequeño contribuyente', datos: { aviso_apagado: true, supera_limite: true } })
    })

    it('apagado, si la revisión del límite falla el error llega en errores y el panel lo muestra con «Reintentar»', async () => {
        bd.operacionPm.panelFinanciero[2] = { dias_baja: 60, aviso_pc_activo: false, version: 1 }
        // Un límite de la empresa sin valor del año: la revisión no se puede hacer.
        const anterior = String(Number(hoyGuatemala().slice(0, 4)) - 1)
        limitePc(2, '1.00', `${anterior}-01-01`)
        const r = await usePanelFinancieroAjustes().alertas()
        const fila = r.ok ? r.data.empresas.find(e => e.empresa_id === 2) : undefined
        expect(fila?.apagadas).toEqual(['limite_pequeno_contribuyente'])
        expect(fila?.alertas).toEqual([])
        expect(fila?.errores.map(e => e.tipo)).toEqual(['limite_pequeno_contribuyente'])

        await montar(PaginaFinanzas, '/finanzas')
        await esperar(() => expect(enBody('errores-pc')?.textContent).toContain('no se pudo revisar el límite de pequeño contribuyente'))
        expect(enBody('errores-pc')?.textContent).toContain('Reintentar')
        expect(document.body.querySelector('[data-aviso="pc-2"]')).toBeNull()
    })

    it('panel financiero: con el aviso apagado calla el 85 % pero muestra el límite superado', async () => {
        const acumulado = acumuladoPc(2)
        bd.operacionPm.panelFinanciero[2] = { dias_baja: 60, aviso_pc_activo: false, version: 1 }
        limitePc(2, (acumulado / 0.85).toFixed(2))
        await montar(PaginaFinanzas, '/finanzas')
        await esperar(() => expect(enBody('avisos-panel')).not.toBeNull())
        await flushPromises()
        expect(document.body.querySelector('[data-aviso="pc-2"]')).toBeNull()
        for (const vista of montadas.splice(0)) {
            vista.unmount()
        }
        limitePc(2, (acumulado / 2).toFixed(2))
        await montar(PaginaFinanzas, '/finanzas')
        await esperar(() => expect(document.body.querySelector('[data-aviso="pc-2"]')?.textContent).toContain('Pequeño contribuyente al 200 %'))
    })

    it('el interruptor dice que el 100 % se avisa siempre', async () => {
        useEmpresaActiva().elegir(2)
        await montar(PaginaFiscal, '/configuracion/fiscal')
        await esperar(() => expect(enBody('aviso-pc-activo')).not.toBeNull())
        expect(enBody('aviso-pc-fila')?.textContent).toContain('El 100 % (límite superado) se avisa siempre')
        enBody('aviso-pc-activo')!.click()
        await esperar(() => expect(bd.operacionPm.panelFinanciero[2]?.aviso_pc_activo).toBe(false))
        await esperar(() => expect(enBody('aviso-pc-fila')?.textContent).toContain('Apagado: no se avisan el 80 % ni el 95 %. El 100 % (límite superado) se avisa siempre, porque obliga a cambiar de régimen.'))
    })

    it('sin fiscal.editar_parametros los umbrales se ven de solo lectura y la API responde 403', async () => {
        const sinFiscal = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'fiscal.editar_parametros') }
        usuariosPorToken['fixture-admin'] = sinFiscal
        useUsuarioActual().value = sinFiscal
        useEmpresaActiva().elegir(2)
        const r = await usePanelFinancieroAjustes().guardar({ aviso_pc_umbrales: ['70'], version: 1 })
        expect(!r.ok && r.problema.status).toBe(403)
        await montar(PaginaFiscal, '/configuracion/fiscal')
        await esperar(() => expect(enBody('umbrales-lectura')?.textContent).toContain('80 %'))
        expect(enBody('umbrales-form')).toBeNull()
        expect(enBody('aviso-pc-no-aplica')).toBeNull()
    })

    it('sin panel_financiero.ver la página Fiscal no muestra el bloque', async () => {
        const sinPanel = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'panel_financiero.ver') }
        usuariosPorToken['fixture-admin'] = sinPanel
        useUsuarioActual().value = sinPanel
        useEmpresaActiva().elegir(2)
        await montar(PaginaFiscal, '/configuracion/fiscal')
        await esperar(() => expect(document.body.querySelector('#fiscal-parametros')).not.toBeNull())
        expect(enBody('bloque-aviso-pc')).toBeNull()
    })

    it('la pantalla guarda los umbrales y dice cuando ya se cambiaron hoy', async () => {
        useEmpresaActiva().elegir(2)
        await montar(PaginaFiscal, '/configuracion/fiscal')
        await esperar(() => expect(enBody('umbrales-form')).not.toBeNull())
        botonEn('umbrales-form', 'Agregar')!.click()
        await flushPromises()
        enBody('umbrales-guardar')!.click()
        await esperar(() => expect(bd.fiscal.valores.find(v => v.clave === 'pc_alertas' && v.empresa_id === 2)?.valor).toEqual(['80.00', '95.00', '100.00']))
        botonEn('umbrales-form', 'Agregar')!.click()
        await flushPromises()
        enBody('umbrales-guardar')!.click()
        await esperar(() => expect(enBody('umbrales-error')?.textContent).toContain('ya se cambiaron hoy'))
    })
})

describe('reportes · envíos programados', () => {
    it('lista los envíos con su detalle y corridas; pausar manda el envío completo', async () => {
        useEmpresaActiva().elegir(1)
        await montar(PaginaEnvios, '/reportes/envios')
        await esperar(() => expect(document.body.querySelector('[data-envio="Cartera vencida por zona"]')).not.toBeNull())
        expect(document.body.querySelector('[data-envio="Ingresos del mes"]')).not.toBeNull()
        await esperar(() => expect(enBody('corridas-envio')?.textContent).toContain('Omitido: el correo se retiró de la lista'))
        expect(document.body.querySelector('[data-envio-detalle="1"]')?.textContent).toContain('Retirado de la lista')
        enBody('envio-pausar')!.click()
        await esperar(() => expect(bd.operacionPm.envios.find(e => e.id === 1)?.activo).toBe(false))
        expect(bd.operacionPm.envios.find(e => e.id === 1)?.destinatarios).toHaveLength(2)
    })

    it('correos externos: envíos por correo y quién aprobó o retiró; retirar marca los envíos', async () => {
        useEmpresaActiva().elegir(1)
        const lista = await useCorreosExternos().listar()
        const contador = lista.ok ? lista.data.find(c => c.id === 1) : undefined
        expect(contador).toMatchObject({ aprobado_por_nombre: 'Ana Administradora', envios_programados: 1, envios_activos: 1 })
        await montar(PaginaEnvios, '/reportes/envios?ver=correos')
        await esperar(() => expect(document.body.querySelector('[data-envios="contador@despachomm.gt"]')?.textContent).toContain('1 programado'))
        expect(document.body.querySelector('[data-correo="gerencia@argosnet.gt"]')?.closest('tr')?.textContent).toContain('Retirado por Ana Administradora')
        const r = await useCorreosExternos().retirar(1)
        expect(r.ok).toBe(true)
        expect(bd.operacionPm.envios.find(e => e.id === 3)?.destinatarios[0]?.retirado).toBe(true)
        const otraVez = await useCorreosExternos().aprobar({ correo: 'contador@despachomm.gt', nombre: 'Despacho' })
        expect(otraVez.ok && otraVez.data).toMatchObject({ id: 1, activo: true, retirado_en: null })
        expect(bd.operacionPm.envios.find(e => e.id === 3)?.destinatarios[0]?.retirado).toBe(false)
    })

    it('sin alcance global no cuentan ni se ven los consolidados', async () => {
        const sinGlobal = { ...meAdmin, alcance_global: false }
        usuariosPorToken['fixture-admin'] = sinGlobal
        useEmpresaActiva().elegir(1)
        const envios = await useEnviosReportes().listar()
        expect(envios.ok && envios.data.map(e => e.id)).toEqual([1, 2, 4])
        const correos = await useCorreosExternos().listar()
        expect(correos.ok && correos.data.find(c => c.id === 1)?.envios_programados).toBe(0)
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
