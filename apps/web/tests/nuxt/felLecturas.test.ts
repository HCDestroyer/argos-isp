import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import LibroCierres from '~/components/LibroCierres.vue'
import LibroDiarios from '~/components/LibroDiarios.vue'
import PaginaAviso from '~/pages/configuracion/aviso-cobro.vue'
import PaginaFel from '~/pages/configuracion/fel.vue'
import PaginaDteDetalle from '~/pages/dte/[id].vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import PaginaNota from '~/pages/notas-credito/[id].vue'
import PaginaNotas from '~/pages/notas-credito/index.vue'

/**
 * Lecturas FEL de la segunda tanda de A3 y A5 (`3e1c218`, `7078281`): catálogo de certificadores,
 * filtros múltiples e intentos de DTE, la NCRE dentro de la nota, sustituciones, diarios, el 409
 * `ncre_sin_certificar` con `errors[]`, la plantilla de fábrica y el PDF de la nota.
 */

type Dte = Schema<'Dte'>

function dteDe(estado: Dte['estado'], tipo: Dte['documento_tipo'] = 'factura'): Dte {
    const dte = bd.fel.dte.find(d => d.estado === estado && d.documento_tipo === tipo)
    if (!dte) {
        throw new Error(`sin DTE ${tipo} ${estado}`)
    }
    return dte
}

function conApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

describe('FEL · lecturas nuevas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
        useFel().estado.value = null
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('catálogo de certificadores: campos, ambientes y solo pruebas', async () => {
        const catalogo = await useFel().proveedores()
        expect(catalogo.ok && catalogo.data.map(p => [p.codigo, p.solo_pruebas, p.ambientes])).toEqual([
            ['infile', false, ['pruebas', 'produccion']],
            ['falso', true, ['pruebas']],
        ])
        const infile = catalogo.ok ? catalogo.data[0] : undefined
        expect(infile && campoSecreto(infile, 'llave_api')).toBe(true)
        expect(infile && campoSecreto(infile, 'usuario_api')).toBe(false)
        expect(etiquetaProveedor('falso', catalogo.ok ? catalogo.data : [])).toBe('Certificador de laboratorio (falso)')
    })

    it('la cola filtra por varios estados y por fecha de emisión; los intentos de un DTE', async () => {
        const varios = await useDte().listar({ estado: ['rechazado', 'error_temporal'] })
        const estados = new Set(varios.ok ? varios.data.data.map(d => d.estado) : [])
        expect([...estados].sort()).toEqual(['error_temporal', 'rechazado'])
        const octubre = await useDte().listar({ desde: '2026-10-01', hasta: '2026-10-31' })
        expect(octubre.ok && octubre.data.data.every(d => d.fecha_emision >= '2026-10-01')).toBe(true)

        const temporal = dteDe('error_temporal')
        const intentos = await useDte().intentos(temporal.id)
        expect(intentos.ok && intentos.data.map(i => i.resultado)).toEqual(['error_temporal', 'error_temporal', 'error_temporal'])
        const ninguno = await useDte().intentos(99_999)
        expect(!ninguno.ok && ninguno.problema.status).toBe(404)
    })

    it('la nota trae su NCRE y la factura su sustitución', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const nota = await useNotasCredito().ver(ncre.documento_id)
        expect(nota.ok && nota.data).toMatchObject({ dte_id: ncre.id, fel_estado: 'rechazado', fel_error: expect.stringContaining('SAT') })
        const interna = bd.notasCredito.find(n => !bd.fel.dte.some(d => d.documento_tipo === 'nota_credito' && d.documento_id === n.id))
        const vista = await useNotasCredito().ver(interna?.id ?? 0)
        expect(vista.ok && vista.data).toMatchObject({ dte_id: null, fel_estado: null })

        const sinDte = bd.facturas.find(f => (f.empresa_id ?? 1) === 1 && !f.dte_id && f.pagado === '0.00' && f.estado !== 'anulada' && f.tipo !== 'mora')
        const sustitucion = await useFacturas().sustituir(sinDte?.id ?? 0, { motivo: 'NIT equivocado' }, nuevaClaveIdempotencia())
        const nueva = sustitucion.ok ? sustitucion.data.nueva.id : 0
        expect(sustitucion.ok && sustitucion.data.original.sustituida_por).toBe(nueva)
        expect(sustitucion.ok && sustitucion.data.nueva.sustituye_a).toBe(sinDte?.id)
    })

    it('diarios: numeración guardada por año, consolidable, con su detalle', async () => {
        const diarios = await useLibro().diarios()
        const ven = diarios.ok ? diarios.data.find(d => d.codigo === 'VEN') : undefined
        expect(ven?.secuencias[0]?.ultimo).toBeGreaterThan(0)
        expect(diarios.ok && diarios.data.every(d => d.empresa_id === 1)).toBe(true)
        const detalle = await useLibro().verDiario(ven?.id ?? 0)
        expect(detalle.ok && detalle.data).toMatchObject({ codigo: 'VEN', tipo: 'ventas' })

        useEmpresaActiva().elegir('todas')
        const todas = await useLibro().diarios()
        expect(new Set(todas.ok ? todas.data.map(d => d.empresa_id) : [])).toEqual(new Set([1, 2]))
    })

    it('la pestaña de diarios muestra la numeración y el detalle; con error, «Reintentar»', async () => {
        const vista = await mountSuspended(conApp(LibroDiarios))
        await vi.waitFor(() => expect(vista.find('[data-prueba="tabla-diarios"]').text()).toContain('VEN'))
        expect(vista.text()).toContain('Ventas')
        vista.unmount()

        simularFalla('GET /api/v1/libro/diarios', 501)
        const conError = await mountSuspended(conApp(LibroDiarios))
        await vi.waitFor(() => expect(conError.find('[data-prueba="diarios-error"]').text()).toContain('Reintentar'))
    })

    it('el cierre lista las NCRE sin certificar desde errors[] con enlace a cada nota', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const nota = bd.notasCredito.find(n => n.id === ncre.documento_id)
        if (nota) {
            nota.fecha = '2026-08-20'
        }
        const cierre = await useLibro().cerrarPeriodo('2026-08', nuevaClaveIdempotencia())
        expect(!cierre.ok && ncreDeProblema(cierre.problema)).toEqual([{ notaId: ncre.documento_id, dteId: ncre.id, estado: 'rechazado' }])

        const vista = await mountSuspended(conApp(LibroCierres))
        await vi.waitFor(() => expect(vista.find('[data-prueba="abrir-cerrar-periodo"]').attributes('disabled')).toBeUndefined())
        await vista.find('[data-prueba="abrir-cerrar-periodo"]').trigger('click')
        const confirmar = await vi.waitFor(() => {
            const boton = document.querySelector<HTMLButtonElement>('[data-prueba="confirmar-cierre"]')
            expect(boton).not.toBeNull()
            return boton
        })
        confirmar?.click()
        await vi.waitFor(() => expect(document.querySelector('[data-prueba="cierre-ncre"]')?.textContent).toContain(`Nota de crédito #${ncre.documento_id}`))
    })

    it('Configuración → FEL usa el catálogo: el falso no se ofrece en producción', async () => {
        const vista = await mountSuspended(conApp(PaginaFel), { route: '/configuracion/fel' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="fel-modo"]').exists()).toBe(true))
        expect(vista.text()).toContain('Certificador de laboratorio (falso)')
        expect(vista.find('[data-prueba="credenciales-abrir-produccion"]').attributes('disabled')).toBeDefined()

        simularFalla('GET /api/v1/fel/proveedores', 501)
        const conError = await mountSuspended(conApp(PaginaFel), { route: '/configuracion/fel' })
        await vi.waitFor(() => expect(conError.find('[data-prueba="fel-catalogo-error"]').exists()).toBe(true))
    })

    it('el detalle del DTE lista los intentos ante el certificador', async () => {
        const rechazado = dteDe('rechazado')
        const vista = await mountSuspended(conApp(PaginaDteDetalle), { route: `/dte/${rechazado.id}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="dte-intentos-lista"]').text()).toContain('Certificar'))
        expect(vista.find('[data-prueba="dte-intentos-lista"]').text()).toContain('Rechazado')
    })

    it('la factura sustituida enlaza a la nueva y la nueva a la original', async () => {
        const sinDte = bd.facturas.find(f => (f.empresa_id ?? 1) === 1 && !f.dte_id && f.pagado === '0.00' && f.estado !== 'anulada' && f.tipo !== 'mora')
        const sustitucion = await useFacturas().sustituir(sinDte?.id ?? 0, { motivo: 'NIT equivocado' }, nuevaClaveIdempotencia())
        const nueva = sustitucion.ok ? sustitucion.data.nueva.id : 0
        const original = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${sinDte?.id}` })
        await vi.waitFor(() => expect(original.find('[data-prueba="factura-sustituida-por"]').text()).toContain(`#${nueva}`))
        expect(original.find('[data-prueba="abrir-sustituir"]').exists()).toBe(false)
        original.unmount()
        const sustituta = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${nueva}` })
        await vi.waitFor(() => expect(sustituta.find('[data-prueba="factura-sustituye-a"]').text()).toContain(`#${sinDte?.id}`))
    })

    it('la nota muestra su NCRE desde dte_id, su estado en la lista y el botón al PDF', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const vista = await mountSuspended(conApp(PaginaNota), { route: `/notas-credito/${ncre.documento_id}` })
        await vi.waitFor(() => expect(vista.find('[data-prueba="dte-estado"]').text()).toBe('Rechazado'))
        expect(vista.find('[data-prueba="nota-pdf"]').exists()).toBe(true)
        expect(vista.find('[data-prueba="abrir-anular-nota"]').exists()).toBe(true)
        vista.unmount()

        const lista = await mountSuspended(conApp(PaginaNotas), { route: '/notas-credito' })
        await vi.waitFor(() => expect(lista.find('[data-prueba="tabla-notas"]').text()).toContain('Rechazado'))
        expect(lista.find('[data-prueba="tabla-notas"]').text()).toContain('Interna')
    })

    it('el PDF de la nota y la plantilla de fábrica de la nota de crédito', async () => {
        const pdf = await useDocumentos().notaCredito(bd.notasCredito[0]?.id ?? 0)
        expect(pdf.ok && pdf.data.type).toBe('application/pdf')
        const fabrica = await useDocumentos().fabrica('nota_credito')
        expect(fabrica.ok && fabrica.data.html).toContain('{{#nota.fel}}')
        expect(fabrica.ok && fabrica.data.variables.map(v => v.nombre)).toContain('nota.fel_fecha')
    })

    it('el editor: pestaña de nota de crédito, aviso por bloque FEL faltante, comparar y restaurar la de fábrica', async () => {
        bd.plantillaNotaCredito = { ...bd.plantillaNotaCredito, version: 2, html: '<h1>{{empresa.nombre}}</h1>\n{{nota.lineas}}\n' }
        const vista = await mountSuspended(conApp(PaginaAviso), { route: '/configuracion/aviso-cobro?tipo=nota_credito' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="falta-bloque-fel"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="falta-bloque-fel"]').text()).toContain('nota.fel_uuid')
        const insertar = vista.find('[data-prueba="falta-bloque-fel"]').findAll('button').find(b => b.text().includes('Insertar bloque FEL'))
        await insertar?.trigger('click')
        await vi.waitFor(() => expect(vista.find('[data-prueba="falta-bloque-fel"]').exists()).toBe(false))
        expect((vista.find('textarea').element as HTMLTextAreaElement).value).toContain('{{/nota.fel}}')

        await vista.find('[data-prueba="comparar-fabrica"]').trigger('click')
        const restaurar = await vi.waitFor(() => {
            const boton = document.querySelector<HTMLButtonElement>('[data-prueba="restaurar-fabrica"]')
            expect(boton).not.toBeNull()
            return boton
        })
        expect(document.querySelector('[data-prueba="diferencias-fabrica"]')?.textContent).toContain('Solo en la de fábrica')
        restaurar?.click()
        await vi.waitFor(() => expect((vista.find('textarea').element as HTMLTextAreaElement).value).toContain('Total acreditado'))
    })
})
