import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import * as comun from '~~/fixtures/comun'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import PaginaPortalCorte from '~/pages/configuracion/portal-corte.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Configuración → Portal de corte (`GET`/`PUT /corte/configuracion`): IPv4, IPv6 y puerto del NAT de
 * corte y modo de suspensión. Esquema espejo, fixtures fieles a la API, 409 con «Recargar», errores
 * con «Reintentar», confirmación al reescribir los routers y solo lectura sin `portal_corte.configurar`.
 */
type Me = Schema<'Me'>

function enApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

const montadas: { unmount: () => void }[] = []

async function montar() {
    const vista = await mountSuspended(enApp(PaginaPortalCorte), { route: '/configuracion/portal-corte', attachTo: document.body })
    montadas.push(vista)
    return vista
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

async function escribir(prueba: string, valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(`[data-prueba="${prueba}"] input, input[data-prueba="${prueba}"]`)
    if (!campo) {
        throw new Error(`Sin campo ${prueba}`)
    }
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
    // El puerto (`UInputNumber`) toma el valor al salir del campo, como en el navegador.
    campo.dispatchEvent(new Event('change'))
    campo.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
}

async function comoToken(usuario: Me, cuerpo: () => Promise<void>) {
    const original = comun.usuariosPorToken['fixture-admin']
    comun.usuariosPorToken['fixture-admin'] = usuario
    try {
        await cuerpo()
    }
    finally {
        if (original) {
            comun.usuariosPorToken['fixture-admin'] = original
        }
    }
}

beforeEach(async () => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
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

describe('portal de corte · esquema espejo de configurarPortalCorteValidator', () => {
    const base = { portal_v4: '', portal_v6: '', portal_puerto: 80, modo_suspension: 'desconectar' as const }

    it('IPs vacías = null; IPv6 en minúsculas; rechaza IPs y puertos inválidos', () => {
        const vacia = esquemaPortalCorte.safeParse(base)
        expect(vacia.success && vacia.data).toEqual({ portal_v4: null, portal_v6: null, portal_puerto: 80, modo_suspension: 'desconectar' })
        const llena = esquemaPortalCorte.safeParse({ ...base, portal_v4: ' 190.56.10.20 ', portal_v6: '2803:D100::20', portal_puerto: 8088, modo_suspension: 'coa' })
        expect(llena.success && llena.data).toEqual({ portal_v4: '190.56.10.20', portal_v6: '2803:d100::20', portal_puerto: 8088, modo_suspension: 'coa' })
        for (const mala of ['190.56.10', '300.1.1.1', 'portal.argosnet.gt', '2803:d100::20']) {
            expect(esquemaPortalCorte.safeParse({ ...base, portal_v4: mala }).success, mala).toBe(false)
        }
        for (const mala of ['190.56.10.20', '2803:d100::20::1', 'zz::1']) {
            expect(esquemaPortalCorte.safeParse({ ...base, portal_v6: mala }).success, mala).toBe(false)
        }
        for (const puerto of [0, 65536, 80.5]) {
            expect(esquemaPortalCorte.safeParse({ ...base, portal_puerto: puerto }).success, String(puerto)).toBe(false)
        }
        expect(esquemaPortalCorte.safeParse({ ...base, modo_suspension: 'disconnect' }).success).toBe(false)
    })

    it('la IPv4 vacía dice cuál se usa: la IP de la dirección pública, el nombre que se resuelve o que falta', () => {
        expect(ayudaIpv4Vacia('http://190.56.10.20:8088')).toContain('se usa 190.56.10.20')
        expect(ayudaIpv4Vacia('http://portal.argosnet.gt')).toContain('la IPv4 de portal.argosnet.gt')
        expect(ayudaIpv4Vacia(null)).toContain('Escribe la IPv4')
        expect(ipv4Deducida('no es url')).toBeNull()
    })

    it('solo IPv4, IPv6 o puerto reescriben los routers; el modo de suspensión no', () => {
        const actual = bd.portalCorte
        expect(cambiaReglasRouters(actual, { portal_v4: null, portal_v6: null, portal_puerto: 80, modo_suspension: 'coa' })).toBe(false)
        expect(cambiaReglasRouters(actual, { portal_v4: null, portal_v6: null, portal_puerto: 8088, modo_suspension: 'desconectar' })).toBe(true)
        expect(cambiaReglasRouters(actual, { portal_v4: '190.56.10.20', portal_v6: null, portal_puerto: 80, modo_suspension: 'desconectar' })).toBe(true)
    })
})

describe('portal de corte · contra la API (fixtures)', () => {
    it('sin guardar: version 0, valores iniciales del servidor; al guardar pasa a version 1 y solo cambia lo enviado', async () => {
        const portal = usePortalCorte()
        const leida = await portal.ver()
        expect(leida.ok && leida.data).toMatchObject({ version: 0, origen: 'entorno', portal_v4: null, portal_puerto: 80, modo_suspension: 'desconectar', updated_at: null })
        const guardada = await portal.configurar({ version: 0, modo_suspension: 'coa' })
        expect(guardada.ok && guardada.data).toMatchObject({ version: 1, origen: 'configuracion', portal_puerto: 80, modo_suspension: 'coa' })
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'portal_corte.configurar', entidad_tipo: 'portal_corte', entidad_id: 1 })
    })

    it('409 si la versión cambió y 422 en el campo con una IP inválida', async () => {
        const portal = usePortalCorte()
        await portal.configurar({ version: 0, portal_puerto: 8088 })
        const vieja = await portal.configurar({ version: 0, portal_puerto: 80 })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
        const mala = await portal.configurar({ version: 1, portal_v4: '300.1.1.1' })
        expect(mala.ok).toBe(false)
        if (!mala.ok) {
            expect(mala.problema.status).toBe(422)
            expect(erroresDeFormulario(mala.problema).map(e => e.name)).toEqual(['portal_v4'])
        }
    })

    it('ver pide portal_corte.ver y guardar portal_corte.configurar', async () => {
        await comoToken({ ...meCajero, permisos: [...meCajero.permisos, 'portal_corte.ver'] }, async () => {
            expect((await usePortalCorte().ver()).ok).toBe(true)
            const sinPermiso = await usePortalCorte().configurar({ version: 0, portal_puerto: 8088 })
            expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
        })
        await comoToken(meCajero, async () => {
            const sinVer = await usePortalCorte().ver()
            expect(!sinVer.ok && sinVer.problema.status).toBe(403)
        })
    })
})

describe('portal de corte · pantalla', () => {
    it('sin guardar: lo dice en palabras del operador, explica la IPv4 deducida y avisa de los routers', async () => {
        await montar()
        await esperar(() => expect(enBody('portal-corte-sin-guardar')).not.toBeNull())
        const texto = document.body.textContent ?? ''
        expect(texto).toContain('Valores iniciales del servidor, todavía no guardados')
        expect(texto).toContain('la IPv4 de portal.argosnet.gt')
        expect(texto).toContain('Desconectar la sesión')
        expect(texto).toContain('Mantener la sesión y cambiar velocidad (CoA)')
        expect(enBody('portal-corte-aviso-routers')?.textContent).toContain('reescribe las reglas de corte en todos los routers')
        expect(enBody('portal-corte-empresas')?.getAttribute('href')).toBe('/configuracion/empresas')
        expect(texto).not.toMatch(/entorno|ROUTERS_SERVICIO|COA_SUSPENDER|origen/)
        expect(enBody('portal-corte-guardar')?.textContent).toContain('Guardar estos valores')
    })

    it('cambiar el puerto pide confirmar la actualización de los routers y guarda con la versión', async () => {
        await montar()
        await esperar(() => expect(enBody('portal-corte-puerto')).not.toBeNull())
        await escribir('portal-corte-v4', '190.56.10.20')
        await escribir('portal-corte-puerto', '8088')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(enBody('portal-corte-confirmar')?.textContent).toContain('190.56.10.20:8088'))
        expect(bd.portalCorte.version).toBe(0)
        enBody('portal-corte-confirmar-guardar')!.click()
        await esperar(() => expect(bd.portalCorte).toMatchObject({ version: 1, portal_v4: '190.56.10.20', portal_puerto: 8088, origen: 'configuracion' }))
        await esperar(() => expect(enBody('portal-corte-guardado')?.textContent).toContain('Guardado el'))
        expect(enBody('portal-corte-sin-guardar')).toBeNull()
    })

    it('una IPv4 inválida queda marcada en el campo y no se envía', async () => {
        await montar()
        await esperar(() => expect(enBody('portal-corte-v4')).not.toBeNull())
        await escribir('portal-corte-v4', '190.56.10')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(document.body.textContent).toContain('Escribe una IPv4, p. ej. 190.56.10.20, o déjala vacía'))
        expect(enBody('portal-corte-confirmar')).toBeNull()
        expect(bd.portalCorte.version).toBe(0)
    })

    it('409 al guardar: se ve el conflicto con «Recargar», que trae la versión nueva', async () => {
        await montar()
        await esperar(() => expect(enBody('portal-corte-guardar')).not.toBeNull())
        // Otra sesión guarda antes.
        bd.portalCorte = { ...bd.portalCorte, version: 3, origen: 'configuracion', modo_suspension: 'coa', updated_at: '2026-11-06T15:00:00.000Z' }
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(document.body.textContent).toContain('Conflicto de versión'))
        const recargar = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Recargar'))
        expect(recargar).toBeDefined()
        recargar!.click()
        await esperar(() => expect(document.body.textContent).not.toContain('Conflicto de versión'))
        expect(enBody('portal-corte-guardado')).not.toBeNull()
    })

    it('si la API falla se ve el error con «Reintentar» y ningún valor inventado', async () => {
        simularFalla('GET /api/v1/corte/configuracion', 500)
        await montar()
        await esperar(() => expect(document.body.textContent).toContain('Reintentar'))
        expect(enBody('portal-corte-v4')).toBeNull()
        expect(document.body.textContent).not.toContain('Desconectar la sesión')
        bd.fallas = {}
        ;[...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Reintentar'))!.click()
        await esperar(() => expect(enBody('portal-corte-v4')).not.toBeNull())
    })

    it('sin portal_corte.configurar se ve en solo lectura, sin «Guardar»', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'portal_corte.configurar') }
        await montar()
        await esperar(() => expect(document.body.textContent).toContain('Solo lectura'))
        expect(enBody('portal-corte-guardar')).toBeNull()
        expect(document.body.querySelector<HTMLInputElement>('[data-prueba="portal-corte-v4"] input, input[data-prueba="portal-corte-v4"]')?.disabled).toBe(true)
    })
})

describe('portal de corte · menú y diagnóstico', () => {
    it('la entrada del menú de configuración pide el permiso exacto', () => {
        expect(obtenerSeccion('portal-corte')).toMatchObject({ ruta: '/configuracion/portal-corte', permiso: 'portal_corte.ver' })
        expect(grupoDeRuta('/configuracion/portal-corte')?.id).toBe('configuracion')
    })

    it('el diagnóstico de corte no nombra variables del servidor y apunta a esta pantalla', () => {
        const fuente = readFileSync(join(process.cwd(), 'app/components/RouterDiagnosticoCorte.vue'), 'utf8')
        expect(fuente).not.toMatch(/ROUTERS_SERVICIO_PORTAL|COA_SUSPENDER/)
        expect(fuente).toContain('to="/configuracion/portal-corte"')
        expect(fuente).toContain('puede(\'portal_corte.ver\')')
    })
})
