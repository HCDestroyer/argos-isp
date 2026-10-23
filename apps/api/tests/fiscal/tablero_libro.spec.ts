import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { tableroFiscal } from '#fiscal/tablero'
import { consejosFiscales, type ConsejoVista } from '#fiscal/consejos'
import { reservaIncobrables } from '#ledger/checks'
import EditarParametro from '#fiscal/actions/editar_parametro'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import type { Bloque } from '#fiscal/bloques'

/**
 * Fase 8 · PR D (contrato de localización fiscal §9.4 y §22): bloques del tablero calculados del libro
 * para los consejos que faltaban (compras sin NIT, reserva de incobrables, depreciación bajo el
 * máximo) y «crédito por vencer» como no aplica documentado. Solo lectura: `afirmarLibro` al final.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const datos = (b: Bloque) => b.datos as Record<string, any>

test.group('Fase 8 · bloques del libro y sus consejos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('compras sin NIT, reserva de incobrables y depreciación bajo el máximo: cifras del libro y consejos con ellas', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'inicio_libros',
                valor: '2026-01-01',
                vigente_desde: '2014-01-01',
                motivo: 'Prueba de la PR D',
            },
            e.ctx,
        )
        // venta sin cobrar: saldo deudor 224.00 → tope de la reserva 3 % = 6.72
        await servicioFacturado(e.B, `${MES}-01`, { precio: '224.00', instalacion: `${MES}-01` })

        // compras: una desde el límite con proveedor sin NIT (CUI), una con NIT y una debajo del límite
        const conCui = await proveedorEn(e.B, e.ctx, {
            tipo_documento: 'cui',
            nit: '1234567890101',
            regimen_isr: 'utilidades',
        })
        const conNit = await proveedorEn(e.B, e.ctx, { regimen_isr: 'utilidades' })
        const compra = (proveedor: number, total: string) =>
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor,
                    tipo_documento: 'FACT',
                    numero: unico('D'),
                    fecha_documento: HOY,
                    condicion: 'credito',
                    lineas: [{ descripcion: 'Servicio', total }],
                },
                e.ctx,
            )
        const sinNit = await compra(conCui.id, '3360.00')
        await compra(conNit.id, '3360.00')
        await compra(conCui.id, '1120.00')

        // activos: uno al 20 % (máximo 33.33 %) y otro al máximo
        const bajo = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor RADIUS',
                fecha_alta: HOY,
                costo: '6000.00',
                tasa_anual: '20.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Conmutador',
                fecha_alta: HOY,
                costo: '3000.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )

        const tablero = await tableroFiscal([e.B])
        const t = tablero.empresas[0]!
        // compras sin NIT: solo la de 3,360 con CUI
        assert.equal(t.bloques.compras_sin_nit.estado, 'ok')
        const compras = datos(t.bloques.compras_sin_nit)
        assert.include(compras, { cantidad: 1, total: '3360.00', limite: '2500.00' })
        assert.equal(compras.compras[0].compra_id, sinNit.id)
        assert.match(compras.compras[0].identificacion, /^cui: /)

        // incobrables: la misma cuenta que cartera.provisionar y el check
        const reserva = await reservaIncobrables(db.connection(), e.B, HOY)
        assert.include(datos(t.bloques.incobrables), {
            base: reserva.base.toFixed(2),
            porcentaje: '3.00',
            tope: reserva.tope.toFixed(2),
            estimacion: '0.00',
            disponible: reserva.tope.toFixed(2),
            sobre_tope: false,
        })
        assert.equal(Number(await saldoCuenta(e.B, '1.1.12')), 0)

        // depreciación: (6,000 − 0) × (33.33 % − 20 %) = 799.80 al año
        const dep = datos(t.bloques.depreciacion)
        assert.include(dep, { activos: 2, bajo_maximo: 1, diferencia_anual: '799.80' })
        assert.include(dep.detalle[0], {
            activo_id: bajo.id,
            tasa_anual: '20.00',
            tasa_maxima: '33.33',
            depreciacion_anual: '1200.00',
            depreciacion_anual_maxima: '1999.80',
        })

        // los consejos salen de esos bloques
        const evaluados = await consejosFiscales([e.B], null)
        const lista = evaluados.empresas[0]!.consejos
        const consejo = (clave: string) => lista.find((c) => c.clave === clave) as ConsejoVista
        assert.equal(consejo('compras_sin_nit').estado, 'aplica')
        assert.deepEqual(consejo('compras_sin_nit').datos, {
            cantidad: 1,
            total: '3360.00',
            limite: '2500.00',
        })
        assert.equal(consejo('incobrables_sin_usar').estado, 'aplica')
        assert.equal(consejo('incobrables_sin_usar').datos!.disponible, reserva.tope.toFixed(2))
        assert.equal(consejo('depreciacion_bajo_maximo').estado, 'aplica')
        assert.deepEqual(consejo('depreciacion_bajo_maximo').datos, {
            activos: 1,
            diferencia_anual: '799.80',
        })
        // crédito por vencer: no hay caso con los datos del sistema; no aplica con su motivo, sin cifras
        const credito = consejo('credito_por_vencer')
        assert.deepEqual([credito.estado, credito.texto, credito.datos], ['no_aplica', null, null])
        assert.match(credito.motivo!, /§15 #84/)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H38: un activo con poco por depreciar no promete más deducción que lo que le queda', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Servidor viejo',
                fecha_alta: HOY,
                costo: '10000.00',
                depreciacion_inicial: '9999.99',
                tasa_anual: '5.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        // a 5 % (500 al año) le quedan 0.01: al 33.33 % tampoco deduce más que 0.01
        const casi = await new RegistrarActivo().execute(
            {
                empresa_id: e.B,
                clase: 'computacion',
                descripcion: 'Router con 1,000 por depreciar',
                fecha_alta: HOY,
                costo: '6000.00',
                depreciacion_inicial: '5000.00',
                tasa_anual: '10.00',
                contrapartida: '3.1.01',
            },
            e.ctx,
        )
        const tablero = await tableroFiscal([e.B])
        const d = datos(tablero.empresas[0]!.bloques.depreciacion)
        // solo el segundo: a 10 % deduce 600, al máximo 1,999.80 pero le quedan 1,000 → 400 de diferencia
        assert.include(d, { activos: 2, bajo_maximo: 1, diferencia_anual: '400.00' })
        assert.include(d.detalle[0], {
            activo_id: casi.id,
            acumulada: '5000.00',
            por_depreciar: '1000.00',
            depreciacion_anual: '600.00',
            depreciacion_anual_maxima: '1000.00',
        })
        await afirmarLibro(assert, [e.B, e.C])
    })
})
