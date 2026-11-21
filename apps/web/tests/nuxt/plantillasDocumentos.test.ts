import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import ImprimirConPlantilla from '~/components/ImprimirConPlantilla.vue'
import PaginaLista from '~/pages/configuracion/aviso-cobro.vue'
import PaginaEditor from '~/pages/configuracion/plantillas-documentos/[id].vue'
import PaginaNueva from '~/pages/configuracion/plantillas-documentos/nueva.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Varias plantillas por documento (pedido del PM: impresoras POS de 80 mm): la lista por documento,
 * crear, editar el formato, predeterminar, desactivar y el selector «Imprimir con…». Fixtures
 * como los deja la migración: «Carta» predeterminada de cada tipo y «POS 80 mm» del aviso y del recibo.
 */

function conApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

describe('plantillas de documentos', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('la lista muestra las plantillas del documento con la predeterminada primero', async () => {
        const vista = await mountSuspended(conApp(PaginaLista), { route: '/configuracion/aviso-cobro?tipo=recibo_cobro' })
        await esperar(() => expect(vista.find('[data-prueba="lista-plantillas"]').exists()).toBe(true))
        const filas = vista.findAll('[data-plantilla]')
        expect(filas.map(f => f.attributes('data-plantilla'))).toEqual(['4', '5'])
        expect(filas[0]!.text()).toContain('Predeterminada')
        expect(filas[1]!.text()).toContain('POS 80 mm')
        expect(filas[1]!.text()).not.toContain('Predeterminada')
        expect(vista.find('[data-prueba="nueva-plantilla"]').exists()).toBe(true)
    })

    it('predeterminar, no desactivar la predeterminada y el selector ofrece solo las activas', async () => {
        const plantillas = usePlantillasDocumentos()
        const pos = await plantillas.predeterminar(5, 1)
        expect(pos.ok && pos.data.predeterminada).toBe(true)
        expect(bd.plantillasDocumentos.filter(p => p.tipo === 'recibo_cobro' && p.predeterminada).map(p => p.id)).toEqual([5])

        const noSe = await plantillas.desactivar(5, 2)
        expect(!noSe.ok && noSe.problema.type).toContain('plantilla_predeterminada')
        const carta = await plantillas.desactivar(4, 2)
        expect(carta.ok && carta.data.activa).toBe(false)
        const vieja = await plantillas.activar(4, 2)
        expect(!vieja.ok && vieja.problema.status).toBe(409)

        const activas = await plantillas.listar({ tipo: 'recibo_cobro', activa: true })
        expect(activas.ok && activas.data.map(p => p.nombre)).toEqual(['POS 80 mm'])

        // imprimir con una desactivada o de otro tipo: 422 en plantilla_id
        bd.cobros.push({ id: 900, cliente_id: bd.clientes[0]!.id, metodo: 'caja', monto: '150.00', registrado_por: meAdmin.id, created_at: '2026-11-20T15:00:00.000Z', pagos: [] })
        const desactivada = await useDocumentos().reciboCobro(900, 4)
        expect(!desactivada.ok && desactivada.problema.errors?.[0]?.field).toBe('plantilla_id')
        const ajena = await useDocumentos().reciboCobro(900, 2)
        expect(!ajena.ok && ajena.problema.status).toBe(422)
        const ticket = await useDocumentos().reciboCobro(900, 5)
        expect(ticket.ok && ticket.data.type).toBe('application/pdf')
    })

    it('nueva plantilla: POS de fábrica y nombre repetido marcado en el campo', async () => {
        const vista = await mountSuspended(conApp(PaginaNueva), { route: '/configuracion/plantillas-documentos/nueva?tipo=nota_credito' })
        await esperar(() => expect(vista.find('[data-prueba="nueva-nombre"]').exists()).toBe(true))
        const creada = await usePlantillasDocumentos().crear({ tipo: 'nota_credito', nombre: 'Ticket NC', formato: 'pos_80' })
        expect(creada.ok && creada.data).toMatchObject({ formato: 'pos_80', de_fabrica: true, predeterminada: false, activa: true })
        const repetida = await usePlantillasDocumentos().crear({ tipo: 'nota_credito', nombre: 'ticket nc' })
        expect(!repetida.ok && repetida.problema.errors?.[0]?.field).toBe('nombre')
        const copia = await usePlantillasDocumentos().crear({ tipo: 'aviso_cobro', nombre: 'Copia', copiar_de_id: 3 })
        expect(!copia.ok && copia.problema.errors?.[0]?.field).toBe('copiar_de_id')
    })

    it('el editor cambia el formato y vuelve a la de fábrica del nuevo formato', async () => {
        const vista = await mountSuspended(conApp(PaginaEditor), { route: '/configuracion/plantillas-documentos/1' })
        await esperar(() => expect(vista.find('[data-prueba="version-plantilla"]').text()).toBe('De fábrica'))
        const area = vista.get<HTMLTextAreaElement>('textarea')
        expect(area.element.value).toContain('{{factura.lineas}}')
        // guardar sin tocar el HTML de fábrica manda html: null (sigue a la de fábrica)
        const guardada = await usePlantillasDocumentos().editar(1, { version: 1, nombre: 'Carta oficial', html: null })
        expect(guardada.ok && guardada.data).toMatchObject({ nombre: 'Carta oficial', de_fabrica: true, version: 2 })
    })

    it('el selector «Imprimir con…» emite la plantilla elegida; la predeterminada va como null', async () => {
        const vista = await mountSuspended(conApp(ImprimirConPlantilla, { tipo: 'recibo_cobro', etiqueta: 'Recibo en PDF' }))
        await esperar(() => expect(vista.find('[data-prueba="imprimir-con-recibo_cobro"]').exists()).toBe(true))
        await vista.get('[data-prueba="imprimir-recibo_cobro"]').trigger('click')
        const componente = vista.findComponent(ImprimirConPlantilla)
        expect(componente.emitted('imprimir')?.[0]).toEqual([null])
        await vista.get('[data-prueba="imprimir-con-recibo_cobro"]').trigger('click')
        const opcion = await esperar(() => {
            const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.includes('POS 80 mm'))
            expect(item).toBeDefined()
            return item!
        })
        opcion.click()
        await esperar(() => expect(componente.emitted('imprimir')?.[1]).toEqual([5]))
    })

    it('el cajero ve las plantillas para imprimir pero no puede crear', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const lista = await usePlantillasDocumentos().listar({ tipo: 'aviso_cobro', activa: true })
        expect(lista.ok && lista.data.length).toBe(2)
        const crear = await usePlantillasDocumentos().crear({ tipo: 'aviso_cobro', nombre: 'No' })
        expect(!crear.ok && crear.problema.status).toBe(403)
        const vista = await mountSuspended(conApp(PaginaLista), { route: '/configuracion/aviso-cobro' })
        await esperar(() => expect(vista.find('[data-prueba="lista-plantillas"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="nueva-plantilla"]').exists()).toBe(false)
    })
})
