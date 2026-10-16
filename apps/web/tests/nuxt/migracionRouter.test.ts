import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaMigracion from '~/pages/routers/migracion.vue'

type Servicio = Schema<'Servicio'>
type Sesion = Schema<'Sesion'>

const DESDE = '2026-10-05T00:00:00.000Z'

function sesion(extra: Partial<Sesion>): Sesion {
    return {
        id: 1,
        servicio_id: 1,
        router_id: 1,
        nas_ip: '10.10.0.1',
        acct_session_id: '81A00001',
        user_ppp: 'carlos.2',
        ipv4: '100.64.10.3',
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        inicio: '2026-10-01T12:00:00.000Z',
        fin: null,
        bytes_in: 0,
        bytes_out: 0,
        causa_fin: null,
        ...extra,
    }
}

const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaMigracion) }) })

function dato(wrapper: { find: (selector: string) => { exists: () => boolean, text: () => string } }, prueba: string): string | null {
    const elemento = wrapper.find(`[data-prueba="${prueba}"]`)
    return elemento.exists() ? elemento.text() : null
}

describe('semana 3 · migración de router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-admin'
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
        useUsuarioActual().value = null
        document.body.innerHTML = ''
    })

    it('hora de Guatemala a UTC y servicios sin sesión desde el cambio', () => {
        expect(instanteGuatemala('2026-10-16T08:30')).toBe('2026-10-16T14:30:00.000Z')
        expect(instanteGuatemala('16/10/2026')).toBeNull()

        const servicios = [{ id: 1, tipo_conexion: 'pppoe' }, { id: 2, tipo_conexion: 'pppoe' }, { id: 3, tipo_conexion: 'pppoe' }, { id: 4, tipo_conexion: 'ip_estatica' }] as Servicio[]
        const sesiones = [
            sesion({ id: 1, servicio_id: 1, fin: null }), // abierta desde antes: cuenta como conectado
            sesion({ id: 2, servicio_id: 2, fin: '2026-10-03T00:00:00.000Z' }), // cerrada antes del cambio
            sesion({ id: 3, servicio_id: 3, inicio: '2026-10-06T00:00:00.000Z', fin: '2026-10-06T01:00:00.000Z' }),
        ]
        expect(sinSesionDesde(servicios, sesiones, DESDE).map(s => s.id)).toEqual([2])
        expect(conSesionActiva(sesiones)).toEqual(new Set([1]))
    })

    it('leerTodas recorre el cursor y avisa si la lista no cabe', async () => {
        const pedir = async (cursor?: string): Promise<Resultado<Pagina<number>>> => ({ ok: true, data: { data: [Number(cursor ?? 0)], nextCursor: String(Number(cursor ?? 0) + 1) } })
        const corta = await leerTodas(pedir, 3)
        expect(corta.ok && corta.data).toEqual({ filas: [0, 1, 2], completa: false })
        const servicios = await leerTodas(cursor => useServicios().listar({ router_id: 1, limit: 5 }, cursor))
        expect(servicios.ok && servicios.data.completa).toBe(true)
        expect(servicios.ok && servicios.data.filas.length).toBe(bd.servicios.filter(s => s.router_id === 1).length)
    })

    it('errores de red: solo los del router o de sus servicios', () => {
        const base = bd.acciones[0]
        expect(base).toBeDefined()
        if (!base) {
            return
        }
        const acciones = [
            { ...base, id: 1, resultado: 'error' as const, entidad_tipo: 'servicio', entidad_id: 5 },
            { ...base, id: 2, resultado: 'error' as const, entidad_tipo: 'servicio', entidad_id: 99 },
            { ...base, id: 3, resultado: 'error' as const, entidad_tipo: 'router', entidad_id: 1 },
            { ...base, id: 4, resultado: 'ok' as const, entidad_tipo: 'router', entidad_id: 1 },
        ]
        expect(erroresDelRouter(acciones, 1, new Set([5])).map(a => a.id).sort()).toEqual([1, 3])
    })

    it('con datos: servicios, sesiones activas, pendientes desde la fecha y errores; sin fecha no cuenta pendientes', async () => {
        const routerId = 1
        const vigentes = bd.servicios.filter(s => s.router_id === routerId && s.estado !== 'retirado')
        const activos = new Set(bd.sesiones.filter(s => s.router_id === routerId && s.fin === null).map(s => s.servicio_id))

        const sinFecha = await mountSuspended(conApp, { route: `/routers/migracion?router=${routerId}` })
        await vi.waitFor(() => expect(dato(sinFecha, 'migracion-servicios')).toBe(String(vigentes.length)))
        await vi.waitFor(() => expect(dato(sinFecha, 'migracion-activas')).toBe(String(vigentes.filter(s => activos.has(s.id)).length)))
        expect(dato(sinFecha, 'migracion-pendientes')).toBeNull()
        expect(dato(sinFecha, 'migracion-sin-fecha')).toContain('Escribe desde cuándo')
        expect(sinFecha.text()).toContain('Falta la respuesta de los equipos (audit.red)')
        sinFecha.unmount()

        const conFecha = await mountSuspended(conApp, { route: `/routers/migracion?router=${routerId}&desde=2026-10-10T00:00` })
        await vi.waitFor(() => expect(dato(conFecha, 'migracion-pendientes')).not.toBeNull())
        const esperado = sinSesionDesde(vigentes, bd.sesiones.filter(s => s.router_id === routerId), instanteGuatemala('2026-10-10T00:00') ?? '')
        expect(dato(conFecha, 'migracion-pendientes')).toBe(String(esperado.length))
        await vi.waitFor(() => expect(dato(conFecha, 'migracion-errores')).not.toBeNull())
        conFecha.unmount()
    })

    it('si /sesiones falla: error con "Reintentar" y sin número; los servicios sí se ven', async () => {
        simularFalla('GET /api/v1/sesiones', 501)
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1&desde=2026-10-10T00:00' })
        await vi.waitFor(() => expect(dato(wrapper, 'migracion-servicios')).not.toBeNull())
        await vi.waitFor(() => expect(wrapper.text()).toContain('Reintentar'))
        expect(dato(wrapper, 'migracion-activas')).toBeNull()
        expect(dato(wrapper, 'migracion-pendientes')).toBeNull()
        wrapper.unmount()
    })

    it('sin sesiones.ver ni bitacora.ver: lo dice y no llama a esas listas', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'sesiones.ver' && p !== 'bitacora.ver') }
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1&desde=2026-10-10T00:00' })
        await vi.waitFor(() => expect(dato(wrapper, 'migracion-servicios')).not.toBeNull())
        await vi.waitFor(() => expect(wrapper.text()).toContain('Sin permiso sesiones.ver'))
        expect(wrapper.text()).toContain('Sin permiso bitacora.ver')
        expect(dato(wrapper, 'migracion-activas')).toBeNull()
        expect(dato(wrapper, 'migracion-errores')).toBeNull()
        wrapper.unmount()
    })
})
