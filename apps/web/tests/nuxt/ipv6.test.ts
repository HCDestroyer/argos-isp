import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import RouterDireccionamiento from '~/components/RouterDireccionamiento.vue'
import { esperar } from '../ayudas/esperar'

/** Aritmética de prefijos del direccionamiento del router (`utils/ipv6.ts`). */
describe('prefijos IPv6', () => {
    it('lee y abrevia direcciones como RFC 5952', () => {
        expect(textoIpv6(numeroIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')!)).toBe('2001:db8::1')
        expect(textoIpv6(numeroIpv6('2001:db8:100::')!)).toBe('2001:db8:100::')
        expect(textoIpv6(numeroIpv6('2001:db8:0:1:0:0:0:1')!)).toBe('2001:db8:0:1::1')
        expect(numeroIpv6('2001:db8:::1')).toBeNull()
        expect(numeroIpv6('nada')).toBeNull()
        expect(prefijoV6('2001:db8:100:8000::5/44')).toEqual({ red: numeroIpv6('2001:db8:100::'), largo: 44 })
    })

    it('cuenta cuántos clientes caben y qué recibe cada uno', () => {
        expect(cuantosCaben(44, 56)).toBe(4096n)
        expect(cuantosCaben(44, 64)).toBe(1_048_576n)
        expect(cuantosCaben(56, 48)).toBe(0n)
        const resumen = resumenIpv6([
            { prefijo: '2001:db8:100::/44', tipo: 'delegacion', tamano_entrega: 56 },
            { prefijo: '2001:db8:1f0::/44', tipo: 'enlace', tamano_entrega: 64 },
        ])
        expect(resumen.clientes).toBe(4096n)
        expect(resumen.tamanoDelegado).toBe(56)
        expect(resumen.ejemplos).toEqual([
            { enlace: '2001:db8:1f0::/64', delegado: '2001:db8:100::/56' },
            { enlace: '2001:db8:1f0:1::/64', delegado: '2001:db8:100:100::/56' },
        ])
        expect(cantidadPrefijos(resumen.enlaces)).toBe('1,048,576')
        // Sin pool de delegación nadie recibe IPv6 completa.
        expect(resumenIpv6([{ prefijo: '2001:db8:1f0::/44', tipo: 'enlace', tamano_entrega: 64 }])).toMatchObject({ clientes: 0n, faltaDelegacion: true })
    })

    it('sugiere un pool libre dentro del bloque sin pisar los que hay', () => {
        expect(sugerirPool('2001:db8:100::/40', [], 'delegacion', 56)).toBe('2001:db8:100::/41')
        expect(sugerirPool('2001:db8:100::/40', [], 'enlace', 64)).toBe('2001:db8:1f0::/44')
        expect(sugerirPool('2001:db8:100::/40', ['2001:db8:100::/41'], 'delegacion', 56)).toBe('2001:db8:180::/41')
        expect(sugerirPool('2001:db8:100::/56', ['2001:db8:100::/56'], 'delegacion', 56)).toBeNull()
        expect(seSolapan(prefijoV6('2001:db8:100::/40')!, prefijoV6('2001:db8:1f0::/44')!)).toBe(true)
        expect(contiene(prefijoV6('2001:db8:100::/40')!, prefijoV6('2001:db8:200::/44')!)).toBe(false)
    })

    it('IPv4 utilizables de una red', () => {
        expect(capacidadIpv4('100.64.10.0/24', true)).toBe(253)
        expect(capacidadIpv4('100.64.10.0/24', false)).toBe(254)
        expect(capacidadIpv4('203.0.113.8/30', true)).toBe(1)
        expect(capacidadIpv4('203.0.113.8/32', false)).toBe(1)
    })
})

describe('direccionamiento del router explicado', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('muestra la ocupación de redes y pools, el bloque a escala y lo que recibe cada cliente', async () => {
        const vista = await mountSuspended(RouterDireccionamiento, { props: { routerId: 1 } })
        await esperar(() => expect(vista.find('[data-prueba="clientes-bloque-1"]').exists()).toBe(true))
        // Red 1: 254 hosts, el gateway reservado; los servicios del RB-Centro tienen IP en ella.
        const red = vista.get('[data-prueba="ocupacion-red-1"]')
        expect(red.text()).toMatch(/% · Con espacio/)
        expect(red.text()).toContain('de 253 IP en uso · 1 reservadas')
        expect(vista.get('[data-prueba="clientes-bloque-1"]').text()).toBe('Caben 32,768 clientes')
        expect(vista.get('[data-prueba="ocupacion-pool-1"]').text()).toContain('de 1,048,576 prefijos en uso')
        expect(vista.get('[data-prueba="entrega-pool-2"]').text()).toContain('Delegated-IPv6-Prefix')
        expect(vista.get('[data-prueba="entrega-pool-2"]').text()).toContain('256 redes /64 en su casa')
        expect(vista.get('[data-bloque="1"]').text()).toContain('de Tigo Business')
        expect(vista.findAll('[data-prueba="barra-bloque-1"] span')).toHaveLength(2)
        const explicacion = vista.get('[data-prueba="ipv6-explicacion"]')
        expect(explicacion.text()).toContain('Cliente 1: 2803:d100:1000::/64')
        expect(explicacion.text()).toContain('Cliente 1: 2803:d100:1080::/56')
        expect(vista.get('[data-prueba="ipv6-capacidad"]').text()).toContain('Caben 32,768 clientes con IPv6 completa')
    })

    it('sin bloques explica con un bloque de ejemplo', async () => {
        const vista = await mountSuspended(RouterDireccionamiento, { props: { routerId: 3 } })
        await esperar(() => expect(vista.find('[data-prueba="ipv6-explicacion"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="ipv6-capacidad"]').text()).toContain('Ejemplo con un bloque 2001:db8:100::/40')
    })
})
