import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import Ipv6PoolModal from '~/components/Ipv6PoolModal.vue'
import ProblemaPools from '~/components/ProblemaPools.vue'
import RedIpv4Modal from '~/components/RedIpv4Modal.vue'
import { esperar } from '../ayudas/esperar'

/** Pools editables, migrables y con vista previa (`contratos/pools.md`). */
describe('pools editables y migrables', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function escribir(selector: string, valor: string) {
        const campo = document.body.querySelector<HTMLInputElement>(`${selector} input, input${selector}`)
        expect(campo, selector).not.toBeNull()
        campo!.value = valor
        campo!.dispatchEvent(new Event('input', { bubbles: true }))
    }

    it('achicar una red con IPs en uso se rechaza con la lista, en lenguaje simple', async () => {
        const red = structuredClone(bd.redesIpv4[0]!)
        await mountSuspended(RedIpv4Modal, { props: { routerId: 1, red, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="form-red"]')).not.toBeNull())
        escribir('[data-prueba="red-cidr"]', '100.64.10.0/30')
        document.body.querySelector<HTMLButtonElement>('[data-prueba="red-guardar"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="problema-pools"]')).not.toBeNull())
        const aviso = document.body.querySelector('[data-prueba="problema-pools"]')!.textContent ?? ''
        expect(aviso).toContain('Hay IPs en uso que quedarían fuera')
        expect(aviso).toMatch(/100\.64\.10\.\d+ \(servicio \d+, /)
        expect(bd.redesIpv4[0]!.cidr).toBe('100.64.10.0/24')
    })

    it('editar la red con rango y DNS guarda con su versión', async () => {
        const editada = await useRedesIpv4().editar(1, { version: 1, nombre: 'Fijas', rango_inicio: '100.64.10.2', rango_fin: '100.64.10.200', dns_primario: '9.9.9.9' })
        expect(editada.ok && editada.data).toMatchObject({ nombre: 'Fijas', rango_fin: '100.64.10.200', dns_primario: '9.9.9.9', version: 2 })
        // Lo que queda fuera del rango (y el gateway) se reserva.
        expect(editada.ok && editada.data.ocupacion.reservadas).toBeGreaterThan(50)
        const vieja = await useRedesIpv4().editar(1, { version: 1, nombre: 'Otra' })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('el pool nuevo sugiere un prefijo libre y muestra lo que entregaría', async () => {
        const bloque = structuredClone(bd.ipv6Bloques[0]!)
        const pools = structuredClone(bd.ipv6Pools.filter(p => p.bloque_id === 1))
        await mountSuspended(Ipv6PoolModal, { props: { bloque, pools, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="form-pool"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="pool-sugerir"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="pool-vista-previa"]')?.textContent).toContain('Caben 16,384 clientes'))
        expect(document.body.querySelector<HTMLInputElement>('[data-prueba="pool-prefijo"] input, input[data-prueba="pool-prefijo"]')?.value).toBe('2803:d100:1040::/42')
        expect(document.body.querySelector('[data-prueba="pool-vista-previa"]')?.textContent).toContain('Cliente 1: 2803:d100:1040::/56')
    })

    it('vista previa del bloque: división sugerida y lo que recibe cada cliente', async () => {
        const previa = await useIpv6Bloques().vistaPrevia({ prefijo: '2001:db8:4000::/40', tamano_delegado: 56 })
        expect(previa.ok && previa.data).toMatchObject({
            clientes: 32768,
            redes_lan_por_cliente: 256,
            pools_sugeridos: [
                { tipo: 'enlace', prefijo: '2001:db8:4000::/49', tamano_entrega: 64 },
                { tipo: 'delegacion', prefijo: '2001:db8:4080::/41', tamano_entrega: 56 },
            ],
            ejemplos: [{ servicio: 1, prefijo_enlace: '2001:db8:4000::/64', prefijo_delegado: '2001:db8:4080::/56' }, { servicio: 2 }],
        })
    })

    it('migrar: con servicios pide moverlos; la simulación no cambia nada y la confirmación sí', async () => {
        const sinMover = await useRedesIpv4().migrar(1, { version: 1, router_id: 2 })
        expect(!sinMover.ok && codigoProblema(sinMover.problema)).toBe('pool_con_servicios')
        expect(!sinMover.ok && sinMover.problema.errors?.length).toBeGreaterThan(0)

        // Un servicio con un plan que el destino no tiene no puede pasar: no cambia nada.
        const sinPlan = await useRedesIpv4().migrar(1, { version: 1, router_id: 2, mover_servicios: true, simular: true })
        expect(!sinPlan.ok && codigoProblema(sinPlan.problema)).toBe('servicio_no_migrable')
        bd.planesPorRouter[2] = [...(bd.planesPorRouter[2] ?? []), 3]

        const simulada = await useRedesIpv4().migrar(1, { version: 1, router_id: 2, mover_servicios: true, simular: true })
        expect(simulada.ok && simulada.data.simulado).toBe(true)
        expect(simulada.ok && simulada.data.servicios.every(s => s.antes.router_id === 1 && s.despues.router_id === 2)).toBe(true)
        expect(bd.redesIpv4[0]!.router_id).toBe(1)

        const hecha = await useRedesIpv4().migrar(1, { version: 1, router_id: 2, mover_servicios: true })
        expect(hecha.ok && hecha.data.simulado).toBe(false)
        expect(bd.redesIpv4[0]!.router_id).toBe(2)
    })

    it('el rechazo de migrar se explica con qué hacer y la lista de servicios', async () => {
        const problema = { type: 'urn:argosisp:problema:pool_con_servicios', title: 'Regla de negocio', status: 422, detail: '2 servicios usan direcciones', errors: [{ field: 'mover_servicios', message: 'Servicio 3 (ana.lopez1234): 100.64.10.13', rule: 'pool_con_servicios' }] }
        const vista = await mountSuspended(ProblemaPools, { props: { problema } })
        expect(vista.text()).toContain('Hay servicios usando estas direcciones')
        expect(vista.text()).toContain('Mover también los servicios')
        expect(vista.text()).toContain('Servicio 3 (ana.lopez1234): 100.64.10.13')
    })
})
