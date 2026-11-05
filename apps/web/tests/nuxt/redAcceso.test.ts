import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaRouter from '~/pages/routers/[id].vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import RouterRedAcceso from '~/components/RouterRedAcceso.vue'
import RedAccesoDescubrir from '~/components/RedAccesoDescubrir.vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/**
 * Red de acceso (`contratos/red-acceso.md`, A1): fixtures con las reglas de la API (2 VLAN por
 * puerto, red con gateway, servidor por VLAN, 422 `servidor_pppoe_requerido`), la pestaña con el
 * árbol y el local-address de solo lectura, «Detectar en el router» (501 = «Todavía no disponible»)
 * e «Importar», y el servidor y el gateway en la ficha del servicio.
 */

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

describe('red de acceso', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('fixtures como la API: local-address del gateway, 2 VLAN por puerto y red con gateway', async () => {
        const red = await useRedAcceso().ver(1)
        expect(red.ok && red.data.servidores_pppoe.map(s => [s.nombre, s.local_address, s.perfil])).toEqual([['PPPoE Centro', '100.64.10.1', 'argosisp-pppoe-1']])
        expect(red.ok && red.data.vlans[0]?.puerto_pon).toEqual({ id: 1, identificador: '0/1/1', olt_id: 1, olt_nombre: 'OLT Centro' })

        // El puerto 0/1/2 ya tiene dos VLAN (las del CCR-Mixco).
        const llena = await useRedAcceso().crearVlan(1, { interfaz_padre: 'sfp-sfpplus1', vlan_id: 300, puerto_pon_id: 2 })
        expect(!llena.ok && codigoProblema(llena.problema)).toBe('puerto_pon_lleno')
        const duplicada = await useRedAcceso().crearVlan(1, { interfaz_padre: 'sfp-sfpplus1', vlan_id: 101 })
        expect(!duplicada.ok && duplicada.problema.status).toBe(409)

        const vlan = await useRedAcceso().crearVlan(1, { interfaz_padre: 'sfp-sfpplus1', vlan_id: 120, puerto_pon_id: 3 })
        expect(vlan.ok && vlan.data).toMatchObject({ nombre: 'vlan120', estado: 'administrado', comment: `argosisp:vlan:${vlan.ok ? vlan.data.id : 0}` })
        // La red 2 (pool) no tiene gateway: el local-address no se inventa.
        const sinGateway = await useRedAcceso().crearServidor(1, { nombre: 'fibra-120', vlan_id: vlan.ok ? vlan.data.id : 0, red_ipv4_id: 2 })
        expect(!sinGateway.ok && codigoProblema(sinGateway.problema)).toBe('red_sin_gateway')
        const servidor = await useRedAcceso().crearServidor(1, { nombre: 'fibra-120', vlan_id: vlan.ok ? vlan.data.id : 0, red_ipv4_id: 1 })
        expect(servidor.ok && servidor.data).toMatchObject({ interfaz: 'vlan120', local_address: '100.64.10.1', max_mtu: 1480, autenticacion: ['pap', 'chap', 'mschap1', 'mschap2'] })

        // Lo adoptado no cambia en lo de RouterOS.
        const adoptada = await useRedAcceso().editarVlan(2, { version: 1, vlan_id: 210 })
        expect(!adoptada.ok && codigoProblema(adoptada.problema)).toBe('adoptado_solo_lectura')
    })

    it('servicio PPPoE: se autoelige con un servidor y pide elegir con varios (422 servidor_pppoe_requerido)', async () => {
        const servicio = bd.servicios.find(s => s.router_id === 1 && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado === 'activo')!
        expect([servicio.servidor_pppoe_id, servicio.local_address]).toEqual([1, '100.64.10.1'])

        const base = { cliente_id: servicio.cliente_id, plan_id: 1, tipo_conexion: 'pppoe' as const, user_ppp: 'nuevo.red', pass_ppp: 'clave-de-prueba-1', plantilla_facturacion_id: bd.plantillas[0]?.id ?? null }
        const unico = await useServicios().crear({ ...base, router_id: 1 }, nuevaClaveIdempotencia())
        expect(unico.ok && [unico.data.servidor_pppoe_id, unico.data.local_address]).toEqual([1, '100.64.10.1'])

        const varios = await useServicios().crear({ ...base, router_id: 2, user_ppp: 'nuevo.mixco' }, nuevaClaveIdempotencia())
        expect(!varios.ok && codigoProblema(varios.problema)).toBe('servidor_pppoe_requerido')
        expect(!varios.ok && varios.problema.errors?.[0]?.field).toBe('servidor_pppoe_id')
        const elegido = await useServicios().crear({ ...base, router_id: 2, user_ppp: 'nuevo.mixco', servidor_pppoe_id: 3 }, nuevaClaveIdempotencia())
        expect(elegido.ok && [elegido.data.servidor_pppoe_id, elegido.data.local_address]).toEqual([3, '100.64.20.1'])
    })

    it('la pestaña muestra el árbol VLAN → servidor con su local-address y filtra por puerto PON', async () => {
        const router = bd.routers.find(r => r.id === 2)!
        const vista = await mountSuspended(enApp(RouterRedAcceso, { router }))
        await esperar(() => expect(vista.find('[data-prueba="arbol-red-acceso"]').exists()).toBe(true))
        expect(vista.findAll('[data-vlan]').length).toBe(2)
        expect(vista.find('[data-prueba="local-address-2"]').text()).toBe('100.64.20.1')
        expect(vista.text()).toContain('OLT Centro · PON 0/1/2')
        expect(vista.text()).toContain('Adoptado')
    })

    it('«Detectar en el router»: 501 se ve como «Todavía no disponible» con «Reintentar», sin datos', async () => {
        const router = bd.routers.find(r => r.id === 2)!
        await mountSuspended(enApp(RedAccesoDescubrir, { router, direccionamiento: null, open: true }))
        await esperar(() => expect(enBody('descubrir-no-disponible')).not.toBeNull())
        expect(enBody('descubrir-no-disponible')?.textContent).toContain('Todavía no disponible')
        expect(enBody('descubrir-no-disponible')?.textContent).toContain('Reintentar')
        expect(document.body.querySelector('[data-descubierta]')).toBeNull()
    })

    it('«Detectar» e «Importar»: lo nuevo se adopta con la red sugerida y la VLAN de su servidor', async () => {
        const leido = await useRedAcceso().descubrir(1)
        expect(leido.ok && leido.data.servidores_pppoe.map(s => s.argos.estado)).toEqual(['administrado', 'nuevo'])
        const importado = await useRedAcceso().adoptar(1, { servidores_pppoe: [{ ros_id: '*C', red_ipv4_id: 1 }] }, nuevaClaveIdempotencia())
        expect(importado.ok && importado.data.servidores_pppoe.map(s => [s.nombre, s.estado, s.local_address])).toEqual([['edificio-150', 'adoptado', '100.64.10.1']])
        expect(importado.ok && importado.data.vlans.map(v => [v.nombre, v.estado])).toEqual([['vlan150', 'adoptado']])
        const otraVez = await useRedAcceso().adoptar(1, { servidores_pppoe: [{ ros_id: '*C' }] }, nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('ya_registrado')
    })

    it('la ficha del servicio muestra su servidor PPPoE y el gateway (local-address)', async () => {
        const servicio = bd.servicios.find(s => s.router_id === 1 && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado === 'activo')!
        const pagina = await mountSuspended(enApp(PaginaServicio), { route: `/servicios/${servicio.id}` })
        await esperar(() => expect(pagina.find('[data-prueba="servicio-servidor-pppoe"]').text()).toContain('PPPoE Centro'))
        expect(pagina.find('[data-prueba="servicio-local-address"]').text()).toContain('100.64.10.1')
    })

    it('la ficha del router abre «Red de acceso» desde la URL', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1?pestana=red-acceso' })
        await esperar(() => expect(pagina.find('[data-servidor="1"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="local-address-1"]').text()).toBe('100.64.10.1')
    })
})
