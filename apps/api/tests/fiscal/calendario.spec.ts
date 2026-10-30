import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { llevarFacturasA } from '#tests/contabilidad/ayudas_libros'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { eventos, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import GenerarCalendario from '#fiscal/actions/generar_calendario'
import EmitirAlertasFiscales from '#fiscal/actions/emitir_alertas_fiscales'
import AgregarFeriado from '#fiscal/actions/agregar_feriado'
import { ejecutarCalendarioFiscal } from '#fiscal/jobs'
import { ConsumidorCalendario } from '#fiscal/consumidor_calendario'
import {
    calcularVencimiento,
    enesimoDiaHabil,
    periodosEntre,
    siguienteHabil,
    umbralVencimiento,
} from '#fiscal/calendario'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 7 · PR A (contrato de localización fiscal §3.7, §9.3, §11.3 y §21): calendario fiscal por
 * régimen y periodicidad, días hábiles con feriados, conciliación del calendario y alertas de
 * vencimiento y del límite del pequeño contribuyente. Nada de esto mueve el libro: cada prueba
 * termina en `afirmarLibro`.
 */

const SIN_FERIADOS = new Set<string>()

/**
 * Lleva el reverso del asiento de una compra a `fecha` (mismo patrón que `llevarFacturasA` del
 * auditor): `AnularCompra` revierte con la fecha real de hoy.
 */
async function llevarReversoA(compraId: number, fecha: string) {
    await db.transaction(async (trx) => {
        await trx.rawQuery('ALTER TABLE ledger.asientos DISABLE TRIGGER USER')
        await trx.rawQuery(
            `UPDATE ledger.asientos SET fecha = ?
              WHERE reversa_de IN (SELECT id FROM ledger.asientos WHERE origen_tipo = 'compra' AND origen_id = ?)`,
            [fecha, compraId],
        )
        await trx.rawQuery('ALTER TABLE ledger.asientos ENABLE TRIGGER USER')
    })
}

async function obligaciones(empresaId: number) {
    return (await db
        .from('fiscal.obligaciones')
        .where('empresa_id', empresaId)
        .orderBy([
            { column: 'impuesto', order: 'asc' },
            { column: 'periodo_desde', order: 'asc' },
        ])
        .select(
            'id',
            'impuesto',
            db.raw(`to_char(periodo_desde, 'YYYY-MM-DD') as periodo_desde`),
            db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            'formulario',
            'estado',
            'motivo_estado',
            'version',
        )) as Array<{
        id: number
        impuesto: string
        periodo_desde: string
        vence_en: string
        formulario: string | null
        estado: string
        motivo_estado: string | null
        version: number
    }>
}

function de(filas: Awaited<ReturnType<typeof obligaciones>>, impuesto: string) {
    return filas.filter((f) => f.impuesto === impuesto)
}

async function inicioLibros(ctx: ContextoAccion, empresaId: number, fecha: string) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave: 'inicio_libros',
            valor: fecha,
            vigente_desde: '2014-01-01',
            motivo: 'Libros en ArgosIsp desde esa fecha (prueba)',
        },
        ctx,
    )
}

async function regimenInicial(ctx: ContextoAccion, empresaId: number, regimen: string) {
    await new CambiarRegimen().execute(
        { empresa_id: empresaId, regimen, vigente_desde: '2014-01-01', motivo: 'Inscripción (prueba)' },
        ctx,
    )
}

test.group('Fase 7 · calendario fiscal: días hábiles y vencimientos', () => {
    test('día hábil siguiente, n-ésimo hábil con feriados y formas del plazo', ({ assert }) => {
        // 2026-10-31 es sábado; 2026-11-01, domingo
        assert.equal(siguienteHabil('2026-10-31', SIN_FERIADOS), '2026-11-02')
        assert.equal(siguienteHabil('2026-11-02', new Set(['2026-11-02'])), '2026-11-03')
        assert.equal(siguienteHabil('2026-11-30', SIN_FERIADOS), '2026-11-30')
        // noviembre de 2026: el 10.º hábil es el 13; con el 2 feriado, el 16
        assert.equal(enesimoDiaHabil('2026-11-01', 10, SIN_FERIADOS), '2026-11-13')
        assert.equal(enesimoDiaHabil('2026-11-01', 10, new Set(['2026-11-02'])), '2026-11-16')

        // mes siguiente: último día y, si es inhábil, el siguiente hábil
        assert.deepEqual(calcularVencimiento('2026-01-31', { plazo: 'mes_siguiente' }, SIN_FERIADOS), {
            base: '2026-02-28',
            vence_en: '2026-03-02',
        })
        assert.deepEqual(calcularVencimiento('2026-10-31', { plazo: 'mes_siguiente' }, SIN_FERIADOS), {
            base: '2026-11-30',
            vence_en: '2026-11-30',
        })
        // días hábiles del mes siguiente (opcional mensual, retenciones de IVA)
        assert.equal(
            calcularVencimiento('2026-10-31', { dias: 10, dias_habiles: true }, SIN_FERIADOS).vence_en,
            '2026-11-13',
        )
        assert.equal(
            calcularVencimiento('2026-11-30', { dias: 15, dias_habiles: true }, SIN_FERIADOS).vence_en,
            '2026-12-21',
        )
        // días calendario (retenciones de ISR): el 10 del mes siguiente; 2027-01-10 es domingo
        assert.equal(calcularVencimiento('2026-09-30', { dias: 10 }, SIN_FERIADOS).vence_en, '2026-10-12')
        assert.equal(calcularVencimiento('2026-12-31', { dias: 10 }, SIN_FERIADOS).vence_en, '2027-01-11')
        // fecha fija del año siguiente (ISR anual)
        assert.deepEqual(calcularVencimiento('2026-12-31', { vence: '03-31' }, SIN_FERIADOS), {
            base: '2027-03-31',
            vence_en: '2027-03-31',
        })
        assert.throws(() => calcularVencimiento('2026-12-31', {}, SIN_FERIADOS), /plazo/)

        assert.deepEqual(
            periodosEntre('trimestral', '2026-02-10', '2026-10-01').map((p) => [
                p.desde,
                p.hasta,
                p.trimestre,
            ]),
            [
                ['2026-01-01', '2026-03-31', 1],
                ['2026-04-01', '2026-06-30', 2],
                ['2026-07-01', '2026-09-30', 3],
                ['2026-10-01', '2026-12-31', 4],
            ],
        )
        assert.lengthOf(periodosEntre('mensual', '2026-01-15', '2026-10-22'), 10)
        assert.deepEqual([9, 7, 5, 3, 2, 1, 0, -1].map(umbralVencimiento), [null, 7, 7, 3, 3, 1, 0, null])
    })
})

test.group('Fase 7 · calendario fiscal: generación y conciliación', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('régimen sobre utilidades: IVA, ISR trimestral sin el 4.º, ISO y anual; idempotente', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-01-01')

        const primera = await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-22' }, e.ctx)
        assert.deepEqual([primera.creadas, primera.actualizadas, primera.sin_aplicar], [18, 0, 0])
        assert.deepEqual(primera.errores, [])

        const filas = await obligaciones(e.B)
        const iva = de(filas, 'iva_mensual')
        assert.lengthOf(iva, 10)
        assert.deepEqual(
            [iva[0], iva[8], iva[9]].map((f) => [f!.periodo_desde, f!.vence_en, f!.formulario]),
            [
                ['2026-01-01', '2026-03-02', 'SAT-2237'], // 28-feb sábado → lunes 2-mar
                ['2026-09-01', '2026-11-02', 'SAT-2237'], // 31-oct sábado → lunes 2-nov
                ['2026-10-01', '2026-11-30', 'SAT-2237'], // mes en curso incluido
            ],
        )
        assert.deepEqual(
            de(filas, 'isr_trimestral').map((f) => [f.periodo_desde, f.vence_en]),
            [
                ['2026-01-01', '2026-04-30'],
                ['2026-04-01', '2026-07-31'],
                ['2026-07-01', '2026-11-02'],
            ],
        )
        assert.deepEqual(
            de(filas, 'iso_trimestral').map((f) => f.vence_en),
            ['2026-04-30', '2026-07-31', '2026-11-02', '2027-02-01'],
        )
        assert.deepEqual(
            de(filas, 'isr_anual').map((f) => [f.periodo_desde, f.vence_en, f.formulario]),
            [['2026-01-01', '2027-03-31', 'SAT-1411']],
        )
        assert.lengthOf(de(filas, 'isr_opcional_mensual'), 0)
        assert.lengthOf(de(filas, 'pc_mensual'), 0)
        assert.lengthOf(de(filas, 'retenciones_iva'), 0)
        assert.isTrue(filas.every((f) => f.estado === 'pendiente' && f.version === 1))

        // otra corrida (y otra empresa sin tocar): nada cambia
        const segunda = await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-22' }, e.ctx)
        assert.deepEqual([segunda.creadas, segunda.actualizadas, segunda.sin_aplicar], [0, 0, 0])
        assert.deepEqual(await obligaciones(e.B), filas)
        assert.lengthOf(await obligaciones(e.C), 0)

        // un mes después: solo se agregan los periodos nuevos
        const despues = await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-11-03' }, e.ctx)
        assert.equal(despues.creadas, 1) // IVA de noviembre
        assert.lengthOf(await db.from('fiscal.obligaciones').where('empresa_id', e.B), 19)

        // la identidad no cambia y nada se borra
        await assert.rejects(
            () => db.from('fiscal.obligaciones').where('id', iva[0]!.id).delete(),
            /no se borran/,
        )
        await assert.rejects(
            () =>
                db
                    .from('fiscal.obligaciones')
                    .where('id', iva[0]!.id)
                    .update({ periodo_desde: '2025-01-01', version: 2 }),
            /no cambian/,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('régimen y banderas por periodo: opcional, cambio a utilidades el 1-ene, agente y retenciones de ISR del libro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await regimenInicial(e.ctx, e.B, 'opcional_simplificado')
        await inicioLibros(e.ctx, e.B, '2026-10-01')
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'agente_retencion_iva',
                valor: true,
                vigente_desde: '2026-12-01',
                motivo: 'Designada agente de retención (prueba)',
            },
            e.ctx,
        )
        // compra de octubre a un proveedor del régimen opcional: retención de ISR del 7 % (2.1.05)
        const opcional = await proveedorEn(e.B, e.ctx, { regimen_isr: 'opcional_simplificado' })
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: await unicoBd('R'),
                fecha_documento: '2026-10-05',
                condicion: 'credito',
                lineas: [{ descripcion: 'Mantenimiento de red', total: '112.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(
            compra.retenciones.map((r) => [r.impuesto_codigo, r.monto]),
            [['RET_ISR_OPC_C', '7.00']],
        )

        // aviso a la SAT en diciembre, cambio a utilidades desde el 1-ene-2027
        relojFiscal.ahora = () => new Date('2026-12-10T18:00:00Z')
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'utilidades',
                vigente_desde: '2027-01-01',
                aviso_sat: { numero: 'SAT-77', fecha: '2026-12-05' },
            },
            e.ctx,
        )
        relojFiscal.ahora = () => new Date('2027-02-15T18:00:00Z')

        const r = await new GenerarCalendario().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(r.hoy, '2027-02-15')
        assert.deepEqual(r.errores, [])
        const filas = await obligaciones(e.B)
        assert.deepEqual(
            de(filas, 'iva_mensual').map((f) => f.periodo_desde),
            ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'],
        )
        assert.deepEqual(
            de(filas, 'isr_opcional_mensual').map((f) => [f.periodo_desde, f.vence_en, f.formulario]),
            [
                ['2026-10-01', '2026-11-13', 'SAT-1311'], // 10 días hábiles
                ['2026-11-01', '2026-12-14', 'SAT-1311'],
                ['2026-12-01', '2027-01-14', 'SAT-1311'],
            ],
        )
        // utilidades desde 2027: el trimestral, el ISO y la anual de 2027; nada de 2026 (era opcional)
        assert.deepEqual(
            de(filas, 'isr_trimestral').map((f) => f.periodo_desde),
            ['2027-01-01'],
        )
        assert.deepEqual(
            de(filas, 'iso_trimestral').map((f) => f.periodo_desde),
            ['2027-01-01'],
        )
        assert.deepEqual(
            de(filas, 'isr_anual').map((f) => f.periodo_desde),
            ['2027-01-01'],
        )
        // agente desde diciembre (15 días hábiles, SAT-2340)
        assert.deepEqual(
            de(filas, 'retenciones_iva').map((f) => [f.periodo_desde, f.vence_en, f.formulario]),
            [
                ['2026-12-01', '2027-01-21', 'SAT-2340'],
                ['2027-01-01', '2027-02-19', 'SAT-2340'],
                ['2027-02-01', '2027-03-19', 'SAT-2340'],
            ],
        )
        // retenciones de ISR: solo octubre (el libro), día 10 calendario, formulario por confirmar
        assert.deepEqual(
            de(filas, 'retenciones_isr').map((f) => [f.periodo_desde, f.vence_en, f.formulario]),
            [['2026-10-01', '2026-11-10', null]],
        )

        // deja de ser agente desde enero: las de enero y febrero pasan a no_aplica, con su auditoría
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'agente_retencion_iva',
                valor: false,
                vigente_desde: '2027-01-01',
                motivo: 'Revocada la designación (prueba)',
            },
            e.ctx,
        )
        // el consumidor de fiscal.parametros_cambiados regenera sin esperar al cron
        const [evento] = (await db
            .from('audit.outbox')
            .where('evento', 'fiscal.parametros_cambiados')
            .whereRaw(`payload ->> 'empresa_id' = ?`, [String(e.B)])
            .orderBy('id', 'desc')
            .select('id', 'evento', 'payload')) as Array<{ id: number; evento: string; payload: any }>
        assert.deepEqual(evento!.payload.claves, ['agente_retencion_iva'])
        const consumidor = new ConsumidorCalendario()
        await consumidor.procesar({ id: evento!.id, evento: evento!.evento, payload: evento!.payload })
        await consumidor.procesar({ id: evento!.id, evento: evento!.evento, payload: evento!.payload })

        const retenciones = de(await obligaciones(e.B), 'retenciones_iva')
        assert.deepEqual(
            retenciones.map((f) => [f.periodo_desde, f.estado, f.motivo_estado, f.version]),
            [
                ['2026-12-01', 'pendiente', null, 1],
                ['2027-01-01', 'no_aplica', 'no_es_agente_retencion_iva', 2],
                ['2027-02-01', 'no_aplica', 'no_es_agente_retencion_iva', 2],
            ],
        )
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'obligacion_fiscal', entidad_id: retenciones[1]!.id })
            .orderBy('campo', 'asc')
            .select('campo', 'antes', 'despues')
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['estado', 'pendiente', 'no_aplica'],
                ['motivo_estado', null, 'no_es_agente_retencion_iva'],
            ],
        )

        // anular la compra revierte la retención en el mismo mes: la de ISR de octubre ya no aplica
        await new AnularCompra().execute({ compra_id: compra.id, motivo: 'Factura duplicada' }, e.ctx)
        // el reverso lleva la fecha real de hoy: desde noviembre caería en otro mes y la retención de
        // octubre seguiría (bien, por fecha contable); la prueba es la anulación dentro de octubre
        await llevarReversoA(compra.id, '2026-10-20')
        const sinRetencion = await new GenerarCalendario().execute({ empresa_id: e.B }, e.ctx)
        assert.equal(sinRetencion.sin_aplicar, 1)
        assert.deepEqual(
            de(await obligaciones(e.B), 'retenciones_isr').map((f) => [f.estado, f.motivo_estado]),
            [['no_aplica', 'sin_retenciones_isr']],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('feriado: corre los vencimientos sin presentar al siguiente hábil; retirarlo los devuelve', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        relojFiscal.ahora = () => new Date('2026-10-22T18:00:00Z')
        await new GenerarCalendario().execute({ empresa_id: e.B }, e.ctx)
        const generadas = await obligaciones(e.B)
        const vencenEl2 = generadas.filter((f) => f.vence_en === '2026-11-02')
        assert.deepEqual(
            vencenEl2.map((f) => f.impuesto),
            ['iso_trimestral', 'isr_trimestral', 'iva_mensual'],
        )

        const sinNombre = await errorDe(
            new AgregarFeriado().execute({ fecha: '2026-11-02', motivo: 'Prueba' }, e.ctx),
        )
        assert.deepEqual([sinNombre.status, sinNombre.reglas], [422, ['required']])
        const noEs = await errorDe(
            new AgregarFeriado().execute({ fecha: '2026-11-02', activo: false, motivo: 'Prueba' }, e.ctx),
        )
        assert.deepEqual([noEs.status, noEs.codigo], [422, 'feriado_inexistente'])

        try {
            const previo = await db.from('audit.outbox').max('id as id').first()
            const desdeOutbox = Number(previo?.id ?? 0)
            const agregado = await new AgregarFeriado().execute(
                {
                    fecha: '2026-11-02',
                    nombre: 'Día de Todos los Santos (traslado)',
                    motivo: 'Acuerdo de prueba',
                },
                e.ctx,
            )
            assert.isTrue(agregado.activo)
            assert.isAtLeast(agregado.calendario.actualizadas, 3)
            const duplicado = await errorDe(
                new AgregarFeriado().execute(
                    { fecha: '2026-11-02', nombre: 'Día de Todos los Santos (traslado)', motivo: 'Otra vez' },
                    e.ctx,
                ),
            )
            assert.deepEqual([duplicado.status, duplicado.codigo], [409, 'feriado_duplicado'])

            const conFeriado = await obligaciones(e.B)
            const corridas = conFeriado.filter((f) => vencenEl2.some((v) => v.id === f.id))
            assert.isTrue(corridas.every((f) => f.vence_en === '2026-11-03' && f.version === 2))
            const fila = await db.from('fiscal.obligaciones').where('id', corridas[0]!.id).firstOrFail()
            const regla = fila.regla as Record<string, unknown>
            assert.include(regla, { vence_base: '2026-10-31', corrido_a_habil: true })
            // solo los eventos de esta prueba (otra prueba puede usar el mismo feriado)
            const avisos = await db
                .from('audit.outbox')
                .where('evento', 'fiscal.parametros_cambiados')
                .where('id', '>', desdeOutbox)
                .whereRaw(`payload ->> 'vigente_desde' = ?`, ['2026-11-02'])
                .select('payload')
            assert.deepEqual(
                avisos.map((a) => a.payload),
                [{ empresa_id: null, claves: ['feriados'], vigente_desde: '2026-11-02' }],
            )
        } finally {
            await new AgregarFeriado().execute(
                { fecha: '2026-11-02', activo: false, motivo: 'Fin de la prueba' },
                e.ctx,
            )
        }
        const sinFeriado = await obligaciones(e.B)
        const devueltas = sinFeriado.filter((f) => vencenEl2.some((v) => v.id === f.id))
        assert.isTrue(devueltas.every((f) => f.vence_en === '2026-11-02' && f.version === 3))
        await assert.rejects(() => db.from('fiscal.feriados').where('fecha', '2026-11-02').delete())
        await afirmarLibro(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · alertas fiscales', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('fiscal.vencimiento_proximo: una vez por obligación y umbral (7, 3, 1, 0), nada vencido', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-22' }, e.ctx)
        const vencimientos = async (hoy: string) => {
            const r = await new EmitirAlertasFiscales().execute({ empresa_id: e.B, hoy }, e.ctx)
            return r.vencimientos
        }

        // a 11 días: nada; a 6: umbral 7 para las tres que vencen el 2-nov
        assert.equal(await vencimientos('2026-10-22'), 0)
        assert.equal(await vencimientos('2026-10-27'), 3)
        assert.equal(await vencimientos('2026-10-28'), 0)
        const todas = await obligaciones(e.B)
        const iva = todas.find((f) => f.impuesto === 'iva_mensual' && f.periodo_desde === '2026-09-01')!
        const delIva = await eventos('fiscal.vencimiento_proximo', 'obligacion_id', iva.id)
        assert.deepEqual(delIva, [
            {
                obligacion_id: iva.id,
                empresa_id: e.B,
                impuesto: 'iva_mensual',
                periodo_desde: '2026-09-01',
                periodo_hasta: '2026-09-30',
                formulario: 'SAT-2237',
                vence_en: '2026-11-02',
                dias: 6,
                umbral: 7,
            },
        ])
        // el cron estuvo detenido: del umbral 7 salta al 1 (no emite el 3 ya pasado)
        assert.equal(await vencimientos('2026-11-01'), 3)
        assert.equal(await vencimientos('2026-11-02'), 3)
        assert.equal(await vencimientos('2026-11-02'), 0)
        assert.equal(await vencimientos('2026-11-03'), 0)
        const emitidos = await eventos('fiscal.vencimiento_proximo', 'obligacion_id', iva.id)
        assert.deepEqual(
            emitidos.map((p) => [p.dias, p.umbral]),
            [
                [6, 7],
                [1, 1],
                [0, 0],
            ],
        )
        assert.lengthOf(await db.from('fiscal.alertas').where('empresa_id', e.B), 9)
        await assert.rejects(() => db.from('fiscal.alertas').where('empresa_id', e.B).delete())
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('fiscal.limite_pc: umbral más alto alcanzado, una vez por año; solo pequeño contribuyente', async ({
        assert,
    }) => {
        // día fijo, no el real: las ventas se fechan con el reloj real y en enero ya serían de otro año
        const hoy = '2026-10-20'
        const e = await prepararEmpresasGt()
        await regimenInicial(e.ctx, e.B, 'pequeno_contribuyente')
        await regimenInicial(e.ctx, e.C, 'utilidades')
        for (const empresaId of [e.B, e.C]) {
            await new EditarParametro().execute(
                {
                    empresa_id: empresaId,
                    clave: 'pc_limite_anual',
                    valor: '250.00',
                    vigente_desde: '2026-01-01',
                    motivo: 'Límite bajo para la prueba',
                },
                e.ctx,
            )
            const s = await servicioFacturado(empresaId, '2026-10-01', {
                precio: '210.00',
                instalacion: '2026-10-01',
            })
            await llevarFacturasA(
                s.facturas.map((f) => f.id),
                hoy,
            )
        }
        const anio = Number(hoy.slice(0, 4))
        const r = await new EmitirAlertasFiscales().execute({ hoy }, e.ctx)
        assert.isAtLeast(r.limite_pc, 1)
        assert.deepEqual(await eventos('fiscal.limite_pc', 'empresa_id', e.B), [
            { empresa_id: e.B, umbral_pct: '80.00', acumulado: '210.00', limite: '250.00', anio },
        ])
        assert.lengthOf(await eventos('fiscal.limite_pc', 'empresa_id', e.C), 0)
        const repetida = await new EmitirAlertasFiscales().execute({ empresa_id: e.B, hoy }, e.ctx)
        assert.equal(repetida.limite_pc, 0)

        const otra = await servicioFacturado(e.B, '2026-10-01', {
            precio: '50.00',
            instalacion: '2026-10-01',
        })
        await llevarFacturasA(
            otra.facturas.map((f) => f.id),
            hoy,
        )
        await new EmitirAlertasFiscales().execute({ empresa_id: e.B, hoy }, e.ctx)
        const limites = await eventos('fiscal.limite_pc', 'empresa_id', e.B)
        assert.deepEqual(
            limites.map((p) => [p.umbral_pct, p.acumulado]),
            [
                ['80.00', '210.00'],
                ['100.00', '260.00'],
            ],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cron fiscal:calendario con lock: genera y alerta todo lo pendiente, sin repetir', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        const corrida = await ejecutarCalendarioFiscal(new Date(), { hoy: '2026-10-30' })
        assert.isFalse(corrida.omitido)
        assert.isAtLeast(corrida.resultado!.calendario.creadas, 1)
        const conLasTres = await eventos('fiscal.vencimiento_proximo', 'empresa_id', e.B)
        assert.deepEqual(
            conLasTres.map((p) => [p.vence_en, p.umbral]),
            [
                ['2026-11-02', 3],
                ['2026-11-02', 3],
                ['2026-11-02', 3],
            ],
        )
        const otra = await ejecutarCalendarioFiscal(new Date(), { hoy: '2026-10-30' })
        assert.equal(otra.resultado!.calendario.creadas, 0)
        assert.lengthOf(await eventos('fiscal.vencimiento_proximo', 'empresa_id', e.B), 3)
        const auditoria = await db
            .from('audit.acciones')
            .whereIn('accion', ['fiscal.generar_calendario', 'fiscal.emitir_alertas'])
            .where('resultado', 'ok')
            .orderBy('id', 'desc')
            .limit(2)
            .select('accion')
        assert.sameMembers(
            auditoria.map((a) => a.accion),
            ['fiscal.generar_calendario', 'fiscal.emitir_alertas'],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · calendario fiscal por la API', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('GET /fiscal/obligaciones y /feriados con su esquema; permisos', async ({ assert, client }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-22' }, e.ctx)
        const cabecera = { 'X-Empresa-Id': String(e.B) }

        const pagina1 = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ limit: 10 }),
            200,
        )
        assert.lengthOf(pagina1.body().data, 10)
        assert.isNotNull(pagina1.body().nextCursor)
        const pagina2 = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ limit: 10, cursor: pagina1.body().nextCursor }),
            200,
        )
        const todas = [...pagina1.body().data, ...pagina2.body().data]
        assert.lengthOf(todas, 18)
        const vences = todas.map((o: any) => `${o.vence_en}#${String(o.id).padStart(12, '0')}`)
        assert.deepEqual(vences, [...vences].sort())
        assert.isTrue(todas.every((o: any) => o.empresa_id === e.B))

        const s = await esquemas()
        exigirCampos(assert, s.ObligacionFiscal!, todas[0], 'ObligacionFiscal')
        assert.include(todas[0], { impuesto: 'iva_mensual', vence_en: '2026-03-02', vencida: true })
        assert.equal(todas[0].nombre, 'IVA mensual (régimen general)')

        const filtradas = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ impuesto: 'isr_anual', estado: ['pendiente', 'borrador'] }),
            200,
        )
        assert.deepEqual(
            filtradas.body().data.map((o: any) => o.vence_en),
            ['2027-03-31'],
        )
        const una = await estado(
            client.get(`/api/v1/fiscal/obligaciones/${todas[0].id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(una.body().id, todas[0].id)
        // la lista de la otra empresa no las trae
        const deC = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers({ 'X-Empresa-Id': String(e.C) }),
            200,
        )
        assert.isTrue(deC.body().data.every((o: any) => o.empresa_id === e.C))

        const feriados = await estado(
            client.get('/api/v1/fiscal/feriados').bearerToken(e.token).qs({ anio: 2026 }),
            200,
        )
        exigirCampos(assert, s.FeriadosFiscales!, feriados.body(), 'FeriadosFiscales')
        assert.equal(feriados.body().anio, 2026)

        const contabilidad = await usuarioConRoles(['contabilidad'])
        await estado(
            client.get('/api/v1/fiscal/obligaciones').bearerToken(contabilidad.token).headers(cabecera),
            200,
        )
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.get('/api/v1/fiscal/obligaciones').bearerToken(cajero.token).headers(cabecera),
            403,
        )
        await estado(
            client
                .post('/api/v1/fiscal/feriados')
                .bearerToken(cajero.token)
                .json({ fecha: '2031-01-02', nombre: 'Prueba', motivo: 'Prueba' }),
            403,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
