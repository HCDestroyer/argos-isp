import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { generar } from '#tests/billing/ayudas_billing'
import { crearClienteFila } from '#tests/core/fabricas'
import { cola, dtesDe, empresasFel } from '#tests/fiscal/ayudas_fel'
import type { ContextoAccion } from '#shared/contexto'
import AsignarPerfilFiscal from '#billing/actions/asignar_perfil_fiscal'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import { estadoCuenta } from '#billing/estado_cuenta'
import { perfilFiscalDe, simularRetenciones, type PerfilFiscalFactura } from '#billing/perfil_fiscal'

/**
 * Lote B4 del plan de contabilidad: perfil fiscal del cliente (Normal, Agente retenedor de IVA,
 * Exento apagado y «me retiene ISR»). La factura guarda su instantánea con las retenciones
 * esperadas, el estado de cuenta las devuelve y el libro cuadra en cada paso.
 */

async function regimen(ctx: ContextoAccion, empresaId: number, valor: string) {
    await new CambiarRegimen().execute(
        {
            empresa_id: empresaId,
            regimen: valor,
            vigente_desde: '2014-01-01',
            motivo: 'Inscripción (prueba)',
        },
        ctx,
    )
}

async function asignar(
    ctx: ContextoAccion,
    clienteId: number,
    datos: Partial<{ tipo_impuesto: 'normal' | 'agente_retenedor_iva' | 'exento'; retiene_isr: boolean }> & {
        resolucion_exencion?: { numero: string; fecha: string } | null
    },
) {
    const { version } = await perfilFiscalDe(clienteId)
    return new AsignarPerfilFiscal().execute(
        { cliente_id: clienteId, tipo_impuesto: 'normal', retiene_isr: false, ...datos, version },
        ctx,
    )
}

async function facturaDe(servicioId: number) {
    const fila = (await db
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .orderBy('id', 'desc')
        .select('id', 'total', 'iva', 'subtotal', 'perfil_fiscal')
        .firstOrFail()) as {
        id: number
        total: string
        iva: string
        subtotal: string
        perfil_fiscal: PerfilFiscalFactura
    }
    return { ...fila, id: Number(fila.id) }
}

const resumen = (p: PerfilFiscalFactura) => ({
    retenciones: p.retenciones.map((r) => [r.impuesto, r.codigo, r.base, r.tasa, r.monto]),
    sin: p.sin_retencion.map((r) => [r.impuesto, r.motivo]),
    total: p.total_retenciones,
    a_recibir: p.a_recibir,
})

test.group('Billing · perfil fiscal del cliente (B4)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('por defecto Normal (version 0); asignar audita el diff, emite cliente.actualizado y controla la version', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const clienteId = await crearClienteFila()
        const inicial = await perfilFiscalDe(clienteId)
        assert.deepInclude(inicial, { tipo_impuesto: 'normal', retiene_isr: false, version: 0 })

        const agente = await asignar(e.ctx, clienteId, { tipo_impuesto: 'agente_retenedor_iva' })
        assert.deepInclude(agente, { tipo_impuesto: 'agente_retenedor_iva', retiene_isr: false, version: 1 })
        assert.deepEqual(agente.exencion, { disponible: false, motivo: 'exencion_sin_frase' })

        const isr = await asignar(e.ctx, clienteId, {
            tipo_impuesto: 'agente_retenedor_iva',
            retiene_isr: true,
        })
        assert.equal(isr.version, 2)
        // misma asignación: sin campos cambiados no hay evento
        await asignar(e.ctx, clienteId, { tipo_impuesto: 'agente_retenedor_iva', retiene_isr: true })

        const eventos = (await db
            .from('audit.outbox')
            .where('evento', 'cliente.actualizado')
            .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [clienteId])
            .orderBy('id')
            .select('payload')) as Array<{ payload: { campos: string[] } }>
        assert.deepEqual(
            eventos.map((x) => x.payload.campos),
            [['tipo_impuesto'], ['retiene_isr']],
        )
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente_perfil_fiscal', entidad_id: clienteId })
            .orderBy('id')
            .select('campo', 'antes', 'despues')
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['tipo_impuesto', 'normal', 'agente_retenedor_iva'],
                ['retiene_isr', false, true],
            ],
        )
        const acciones = await db
            .from('audit.acciones')
            .where({ accion: 'clientes.asignar_perfil_fiscal', entidad_id: clienteId })
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(acciones.n), 3)

        const viejo = await errorDe(
            new AsignarPerfilFiscal().execute(
                { cliente_id: clienteId, tipo_impuesto: 'normal', retiene_isr: false, version: 1 },
                e.ctx,
            ),
        )
        assert.equal(viejo.status, 409)
    })

    test('exento exige resolución (y solo va con exento); se guarda pero la factura sale con IVA', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-10-01' })
        const sin = await errorDe(asignar(e.ctx, s.clienteId, { tipo_impuesto: 'exento' }))
        assert.equal(sin.status, 422)
        assert.includeMembers(sin.reglas, ['required'])
        const sobra = await errorDe(
            asignar(e.ctx, s.clienteId, {
                tipo_impuesto: 'normal',
                resolucion_exencion: { numero: 'R-1', fecha: '2026-01-15' },
            }),
        )
        assert.deepEqual(sobra.reglas, ['no_aplica'])

        const exento = await asignar(e.ctx, s.clienteId, {
            tipo_impuesto: 'exento',
            resolucion_exencion: { numero: 'sat-2026-77', fecha: '2026-01-15' },
        })
        assert.deepEqual(exento.resolucion_exencion, { numero: 'SAT-2026-77', fecha: '2026-01-15' })

        await generar(s.servicioId, '2026-10-01')
        const f = await facturaDe(s.servicioId)
        assert.equal(f.iva, '16.07')
        assert.deepInclude(f.perfil_fiscal, {
            tipo_impuesto: 'exento',
            exento_aplicado: false,
            motivo_exento: 'exencion_sin_frase',
            regimen: 'utilidades',
        })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('régimen general: agente retenedor desde el mínimo (15 % del IVA); ISR solo en el régimen opcional', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        // B en utilidades (por defecto), C en opcional simplificado
        await regimen(e.ctx, e.C, 'opcional_simplificado')
        const clienteId = await crearClienteFila()
        await asignar(e.ctx, clienteId, { tipo_impuesto: 'agente_retenedor_iva', retiene_isr: true })

        const grande = await servicioEn(e.B, { precio: '2800.00', instalacion: '2026-10-01', clienteId })
        await generar(grande.servicioId, '2026-10-01')
        const fB = await facturaDe(grande.servicioId)
        assert.deepEqual(resumen(fB.perfil_fiscal), {
            retenciones: [['iva', 'RET_IVA_ESP', '300.00', '15.00', '45.00']],
            sin: [['isr', 'regimen_utilidades']],
            total: '45.00',
            a_recibir: '2755.00',
        })

        const enC = await servicioEn(e.C, { precio: '2800.00', instalacion: '2026-10-01', clienteId })
        await generar(enC.servicioId, '2026-10-01')
        const fC = await facturaDe(enC.servicioId)
        assert.deepEqual(resumen(fC.perfil_fiscal), {
            retenciones: [
                ['iva', 'RET_IVA_ESP', '300.00', '15.00', '45.00'],
                ['isr', 'RET_ISR_OPC', '2500.00', '5.00', '125.00'],
            ],
            sin: [],
            total: '170.00',
            a_recibir: '2630.00',
        })

        // bajo el mínimo de retención de IVA (Q2,500): no se espera constancia de IVA
        const chico = await servicioEn(e.C, { precio: '150.00', instalacion: '2026-10-01', clienteId })
        await generar(chico.servicioId, '2026-10-01')
        const fChico = await facturaDe(chico.servicioId)
        assert.deepEqual(resumen(fChico.perfil_fiscal).sin, [['iva', 'bajo_minimo']])
        assert.equal(fChico.perfil_fiscal.retenciones[0]!.monto, '6.70')

        // la simulación (Nueva factura / Cobrar) da lo mismo que la instantánea
        assert.deepEqual(
            resumen(await simularRetenciones(clienteId, e.C, '2800.00')),
            resumen(fC.perfil_fiscal),
        )

        // cambiar el perfil no toca lo emitido
        await asignar(e.ctx, clienteId, { tipo_impuesto: 'normal', retiene_isr: false })
        const reLeida = await facturaDe(grande.servicioId)
        assert.deepEqual(reLeida.perfil_fiscal, fB.perfil_fiscal)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pequeño contribuyente: sin IVA en la factura ni retenciones esperadas', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        await regimen(e.ctx, e.B, 'pequeno_contribuyente')
        const s = await servicioEn(e.B, { precio: '2800.00', instalacion: '2026-10-01' })
        await asignar(e.ctx, s.clienteId, { tipo_impuesto: 'agente_retenedor_iva', retiene_isr: true })
        await generar(s.servicioId, '2026-10-01')
        const f = await facturaDe(s.servicioId)
        assert.equal(f.iva, '0.00')
        assert.deepEqual(resumen(f.perfil_fiscal), {
            retenciones: [],
            sin: [
                ['iva', 'regimen_pequeno_contribuyente'],
                ['isr', 'regimen_pequeno_contribuyente'],
            ],
            total: '0.00',
            a_recibir: '2800.00',
        })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('estado de cuenta: perfil del cliente y retenciones esperadas por factura (instantánea o perfil de hoy)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await servicioEn(e.B, { precio: '2800.00', instalacion: '2026-10-01' })
        await generar(s.servicioId, '2026-10-01')
        const anterior = await facturaDe(s.servicioId)
        // una factura anterior a B4 no tiene instantánea: se calcula con el perfil de hoy
        await db.from('billing.facturas').where('id', anterior.id).update({ perfil_fiscal: null })
        await asignar(e.ctx, s.clienteId, { tipo_impuesto: 'agente_retenedor_iva' })
        const nueva = await servicioEn(e.B, {
            precio: '2800.00',
            instalacion: '2026-10-01',
            clienteId: s.clienteId,
        })
        await generar(nueva.servicioId, '2026-10-01')

        const ec = await estadoCuenta(s.clienteId)
        assert.equal(ec.perfil_fiscal.tipo_impuesto, 'agente_retenedor_iva')
        const seccion = ec.empresas.find((x) => x.empresa_id === e.B)!
        assert.deepEqual(
            seccion.retenciones_esperadas.map((r) => [
                r.fuente,
                r.pendiente,
                r.retencion_iva,
                r.retencion_isr,
                r.a_recibir,
            ]),
            [
                ['perfil_actual', '2800.00', '45.00', '0.00', '2755.00'],
                ['factura', '2800.00', '45.00', '0.00', '2755.00'],
            ],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('FEL (certificador falso): el cliente exento certifica su factura con IVA; cargo único igual', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioEn(e.B, {
            precio: '150.00',
            instalacion: '2026-10-01',
            plantilla: { certificar_al: 'emitir' },
        })
        await asignar(e.ctx, s.clienteId, {
            tipo_impuesto: 'exento',
            resolucion_exencion: { numero: 'R-9', fecha: '2026-02-01' },
        })
        await generar(s.servicioId, '2026-10-01')
        const f = await facturaDe(s.servicioId)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        assert.equal(f.iva, '16.07')
        assert.isFalse(f.perfil_fiscal.exento_aplicado)

        const instalacion = (await db
            .from('billing.conceptos_cargo')
            .where({ empresa_id: e.B, nombre: 'Instalación' })
            .select('id')
            .firstOrFail()) as { id: number }
        const cargo = await new EmitirCargoUnico().execute(
            {
                servicio_id: s.servicioId,
                lineas: [{ concepto_id: Number(instalacion.id), precio_unitario: '350.00' }],
            },
            e.ctx,
        )
        if (cargo.documento !== 'factura') throw new Error('se esperaba factura')
        assert.equal(cargo.iva, '37.50')
        assert.deepInclude(cargo.perfil_fiscal!, { tipo_impuesto: 'exento', exento_aplicado: false })
        await cola(e)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('HTTP: leer con clientes.ver, asignar con clientes.asignar_perfil_fiscal (cajero 403), simular', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const clienteId = await crearClienteFila()
        const ruta = `/api/v1/clientes/${clienteId}/perfil-fiscal`
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: conta } = await usuarioConRoles(['contabilidad'])

        const leido = await estado(client.get(ruta).bearerToken(cajero), 200)
        assert.deepInclude(leido.body(), { tipo_impuesto: 'normal', version: 0 })
        const cuerpo = { tipo_impuesto: 'agente_retenedor_iva', retiene_isr: false, version: 0 }
        await estado(client.post(ruta).bearerToken(cajero).json(cuerpo), 403)
        const guardado = await estado(client.post(ruta).bearerToken(conta).json(cuerpo), 200)
        assert.deepInclude(guardado.body(), { tipo_impuesto: 'agente_retenedor_iva', version: 1 })
        await estado(client.post(ruta).bearerToken(conta).json(cuerpo), 409)

        const sim = await estado(
            client.get(`${ruta}/retenciones?total=2800.00&empresa_id=${e.B}`).bearerToken(conta),
            200,
        )
        assert.equal(sim.body().total_retenciones, '45.00')
        assert.equal(sim.body().a_recibir, '2755.00')
    })
})
