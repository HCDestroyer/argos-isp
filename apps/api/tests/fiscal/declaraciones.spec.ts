import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { cola, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { eventos, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import { checksVigentes } from '#ledger/checks'
import { bloqueoVigente } from '#ledger/bloqueos'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { crearClienteFila } from '#tests/core/fabricas'
import { datosNit } from '#tests/fiscal/ayudas_fel'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 7 · PR B (contrato de localización fiscal §9.3, §10.2, §10.4, §10.5, §10.6 y §21):
 * declaraciones de IVA y de pequeño contribuyente como borradores, cuadradas contra las etiquetas
 * del libro, liquidación obligatoria con su bloqueo de impuestos, presentación y pago. Cada prueba
 * termina en `afirmarLibro`. Aceptación: IVA del borrador = cuadrículas = ventas − compras − retenciones.
 */

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

async function compra(ctx: ContextoAccion, empresaId: number, fecha: string, total: string) {
    const proveedor = await proveedorEn(empresaId, ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('D'),
            fecha_documento: fecha,
            periodo_iva: `${fecha.slice(0, 7)}-01`,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total }],
        },
        ctx,
    )
}

/** Venta del mes (factura sin FEL del 1.º) por `precio`. */
function venta(empresaId: number, mes: string, precio: string) {
    return servicioFacturado(empresaId, `${mes}-01`, { precio, instalacion: `${mes}-01` })
}

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
/** mes en curso (las facturas y compras de las pruebas se registran hoy) */
const MES = HOY.slice(0, 7)
const FIN = DateTime.fromISO(`${MES}-01`).endOf('month').toISODate()!
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')

const DESPUES = DateTime.fromISO(`${MES}-01`).plus({ months: 2 }).toFormat('yyyy-MM')
const reloj = (mes: string) => (relojFiscal.ahora = () => new Date(`${mes}-05T18:00:00Z`))
const mesTras = (mes: string) => DateTime.fromISO(`${mes}-01`).plus({ months: 1 }).toFormat('yyyy-MM')

const calcular = (
    ctx: ContextoAccion,
    empresaId: number,
    periodo: string,
    extra: Record<string, unknown> = {},
) =>
    new CalcularDeclaracion().execute(
        { empresa_id: empresaId, impuesto: 'iva_mensual', periodo, ...extra },
        ctx,
    )

test.group('Fase 7 · declaración de IVA y liquidación obligatoria', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('IVA = ventas − compras − retenciones = cuadrículas; revisar liquida, bloquea impuestos y pasa los checks; presentada tarde paga mora y multa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await venta(e.B, MES, '224.00')
        await compra(e.ctx, e.B, HOY, '112.00')

        // las ventas llevan su etiqueta: Σ V_IVA del mes = IVA del libro de ventas
        const partidasVenta = await partidas('factura', s.facturas[0]!.id)
        assert.deepEqual(
            partidasVenta.filter((x) => x[0] === '2.1.02'),
            [['2.1.02', '0.00', '24.00', '+V_IVA']],
        )

        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const borrador = await calcular(e.ctx, e.B, MES)
        assert.equal(borrador.version, 1)
        assert.equal(borrador.estado, 'borrador')
        assert.include(borrador.totales, {
            debito: '24.00',
            credito: '12.00',
            retenciones: '0.00',
            impuesto_determinado: '12.00',
            credito_usado: '12.00',
            a_pagar: '12.00',
            remanente_credito: '0.00',
        })
        assert.equal(borrador.formulario, 'SAT-2237')
        assert.match(borrador.datos_hash, /^[0-9a-f]{64}$/)
        assert.sameDeepMembers(
            borrador.detalle.renglones.map((r) => [r.seccion, r.iva]),
            [
                ['ventas', '24.00'],
                ['compras', '12.00'],
            ],
        )
        // la obligación queda enlazada y en borrador
        const obligacion = await db
            .from('fiscal.obligaciones')
            .where('id', borrador.obligacion_id)
            .firstOrFail()
        assert.deepEqual([obligacion.estado, Number(obligacion.declaracion_id)], ['borrador', borrador.id])
        assert.lengthOf(await eventos('declaracion.calculada', 'declaracion_id', borrador.id), 1)

        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: borrador.id }, e.ctx)
        assert.equal(revisada.estado, 'revisada')
        assert.isNotNull(revisada.asiento_id)
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', borrador.id), [
            ['2.1.02', '24.00', '0.00', null],
            ['1.1.04', '0.00', '12.00', null],
            ['2.1.06', '0.00', '12.00', null],
        ])
        const asiento = await db
            .from('ledger.asientos')
            .where('id', revisada.asiento_id!)
            .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()
        assert.equal(asiento.fecha, FIN)
        assert.equal(await bloqueoVigente(db.connection(), e.B, 'impuestos'), FIN)
        const checks = await checksVigentes(db.connection(), e.B, 'impuestos', `${MES}-01`)
        assert.deepEqual(
            checks.map((c) => [c.clave, c.resultado]),
            [
                ['iva_cuadrado', 'ok'],
                ['iva_liquidado', 'ok'],
            ],
        )
        assert.equal(checks[0]!.esperado, 'V_IVA 24.00 · C_IVA 12.00 · RET_IVA_REC 0.00')
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '-12.00')
        assert.equal(await saldoCuenta(e.B, '2.1.02'), '0.00')

        // revisar dos veces: 409; una partida etiquetada del mes ya no entra (bloqueo de impuestos)
        const otraVez = await errorDe(
            new RevisarDeclaracion().execute({ declaracion_id: borrador.id }, e.ctx),
        )
        assert.deepEqual([otraVez.status, otraVez.codigo], [409, 'declaracion_revisada'])
        const bajoBloqueo = await errorDe(
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha: HOY,
                    descripcion: 'IVA tardío',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: '1.1.02.01', debe: '12.00' },
                        { cuenta: '2.1.02', haber: '12.00', impuesto_codigo: 'IVA12', cuadricula: '+V_IVA' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.deepEqual([bajoBloqueo.codigo, bajoBloqueo.reglas], ['periodo_bloqueado', ['impuestos']])
        // también sin etiqueta: un ajuste manual a 2.1.02 en el mes liquidado no entra…
        const ajusteManual = (fecha: string, trx?: TransactionClientContract) =>
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha,
                    descripcion: 'Ajuste manual del IVA',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: '1.1.02.01', debe: '5.00' },
                        { cuenta: '2.1.02', haber: '5.00' },
                    ],
                },
                e.ctx,
                trx ? { trx } : {},
            )
        const sinEtiqueta = await errorDe(ajusteManual(HOY))
        assert.deepEqual([sinEtiqueta.codigo, sinEtiqueta.reglas], ['periodo_bloqueado', ['impuestos']])
        // …y en un mes abierto sí (se deshace para no dejarlo en el libro)
        const trx = await db.transaction()
        try {
            const abierto = await ajusteManual(`${SIGUIENTE}-02`, trx)
            assert.equal(abierto.fecha, `${SIGUIENTE}-02`)
        } finally {
            await trx.rollback()
        }

        // presentada 15 días y pagada 20 días después del vencimiento: multa y mora
        const vence = DateTime.fromISO(borrador.vence_en)
        const presentacion = vence.plus({ days: 15 }).toISODate()!
        const pago = vence.plus({ days: 20 }).toISODate()!
        relojFiscal.ahora = () => new Date(`${pago}T18:00:00Z`)
        const presentada = await new MarcarDeclaracionPresentada().execute(
            {
                declaracion_id: borrador.id,
                numero_formulario: '2237-000123',
                fecha_presentacion: presentacion,
                boleta: 'B-77',
            },
            e.ctx,
        )
        assert.equal(presentada.estado, 'presentada')
        const presentadaObligacion = await db
            .from('fiscal.obligaciones')
            .where('id', borrador.obligacion_id)
            .firstOrFail()
        assert.equal(presentadaObligacion.estado, 'presentada')
        const noOtra = await errorDe(
            new MarcarDeclaracionPresentada().execute(
                {
                    declaracion_id: borrador.id,
                    numero_formulario: '2237-9',
                    fecha_presentacion: presentacion,
                },
                e.ctx,
            ),
        )
        assert.equal(noOtra.codigo, 'declaracion_presentada')

        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: borrador.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: pago,
                boleta: 'BOL-1',
            },
            e.ctx,
        )
        // 20 días tarde: 12.00 × 0.05 % × 20 = 0.12; multa 15 días × Q50 = Q750
        assert.include(pagada.pago, {
            impuesto: '12.00',
            mora: '0.12',
            multa: '750.00',
            total: '762.12',
            dias_atraso: 20,
        })
        const partidasPago = await partidas('pago_impuesto', borrador.id)
        assert.sameDeepMembers(
            partidasPago.map((p) => [p[0] === '2.1.06' || p[0] === '5.4.02' ? p[0] : 'banco', p[1], p[2]]),
            [
                ['2.1.06', '12.00', '0.00'],
                ['5.4.02', '750.12', '0.00'],
                ['banco', '0.00', '762.12'],
            ],
        )
        assert.equal(await saldoCuenta(e.B, '2.1.06'), '0.00')
        // H35: ni la liquidación ni el pago se revierten directo
        for (const origen of ['liquidacion_impuesto', 'pago_impuesto']) {
            const fila = await db
                .from('ledger.asientos')
                .where({ origen_tipo: origen, origen_id: borrador.id })
                .whereNull('reversa_de')
                .firstOrFail()
            const reverso = await errorDe(
                new RevertirAsiento().execute({ asiento_id: Number(fila.id), motivo: 'Corrección' }, e.ctx),
            )
            assert.deepEqual([reverso.status, reverso.codigo], [409, 'asiento_de_declaracion'], origen)
        }
        const repetido = await errorDe(
            new RegistrarPagoDeclaracion().execute(
                {
                    declaracion_id: borrador.id,
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                },
                e.ctx,
            ),
        )
        assert.equal(repetido.codigo, 'declaracion_pagada')
        assert.lengthOf(await eventos('declaracion.pagada', 'declaracion_id', borrador.id), 1)
        // lo calculado no cambia ni se borra
        await assert.rejects(
            () => db.from('fiscal.declaraciones').where('id', borrador.id).update({ totales: '{}' }),
            /no cambia/,
        )
        await assert.rejects(
            () => db.from('fiscal.declaraciones').where('id', borrador.id).delete(),
            /no se borran/,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('remanente de crédito al mes siguiente; datos_hash detecta el cambio (409); sustitutiva con la diferencia', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, MES, '112.00') // IVA 12
        await compra(e.ctx, e.B, HOY, '336.00') // crédito 36
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)

        const v1 = await calcular(e.ctx, e.B, MES)
        assert.include(v1.totales, {
            debito: '12.00',
            credito: '36.00',
            a_pagar: '0.00',
            remanente_credito: '24.00',
        })
        // otra compra del mes antes de revisar: el borrador quedó viejo
        await compra(e.ctx, e.B, HOY, '112.00') // crédito 12
        const viejo = await errorDe(new RevisarDeclaracion().execute({ declaracion_id: v1.id }, e.ctx))
        assert.deepEqual([viejo.status, viejo.codigo], [409, 'declaracion_desactualizada'])

        const v2 = await calcular(e.ctx, e.B, MES)
        const v1Despues = await db.from('fiscal.declaraciones').where('id', v1.id).firstOrFail()
        assert.equal(v2.version, 2)
        assert.equal(v1Despues.estado, 'sustituida')
        const sustituida = await errorDe(new RevisarDeclaracion().execute({ declaracion_id: v1.id }, e.ctx))
        assert.equal(sustituida.codigo, 'declaracion_sustituida')
        await new RevisarDeclaracion().execute({ declaracion_id: v2.id }, e.ctx)
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', v2.id), [
            ['1.1.04', '0.00', '12.00', null],
            ['2.1.02', '12.00', '0.00', null],
        ])

        // el mes siguiente arrastra el remanente (48 − 12 = 36), sin asiento
        relojFiscal.ahora = () =>
            new Date(
                `${DateTime.fromISO(`${SIGUIENTE}-01`).plus({ months: 1 }).toFormat('yyyy-MM')}-05T18:00:00Z`,
            )
        const siguiente = await calcular(e.ctx, e.B, SIGUIENTE)
        assert.include(siguiente.totales, {
            remanente_credito_anterior: '36.00',
            debito: '0.00',
            a_pagar: '0.00',
            remanente_credito: '36.00',
        })
        assert.equal(siguiente.detalle.anterior_id, v2.id)

        // una compra del mes que entra con una excepción del bloqueo: sustitutiva
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.B,
                tipo: 'impuestos',
                motivo: 'Factura del mes recibida tarde',
                hasta_en: new Date(Date.now() + 3_600_000).toISOString(),
            },
            e.ctx,
        )
        await compra(e.ctx, e.B, HOY, '56.00') // crédito 6
        const revisadaYa = await errorDe(calcular(e.ctx, e.B, MES))
        assert.deepEqual([revisadaYa.status, revisadaYa.codigo], [409, 'declaracion_revisada'])
        const v3 = await calcular(e.ctx, e.B, MES, { sustitutiva: true })
        assert.deepEqual([v3.version, v3.sustitutiva, v3.sustituye_a], [3, true, v2.id])
        assert.include(v3.totales, { remanente_credito: '42.00' })
        await new RevisarDeclaracion().execute({ declaracion_id: v3.id }, e.ctx)
        // solo la diferencia: ninguna (el crédito no usado queda en 1.1.04 sin asiento)
        assert.lengthOf(await partidas('liquidacion_impuesto', v3.id), 0)
        const checks = await checksVigentes(db.connection(), e.B, 'impuestos', `${MES}-01`)
        assert.isTrue(checks.every((c) => c.resultado === 'ok'))
        // el borrador del mes siguiente ya no cuadra (cambió el remanente que arrastra)
        const desactualizado = await errorDe(
            new RevisarDeclaracion().execute({ declaracion_id: siguiente.id }, e.ctx),
        )
        assert.equal(desactualizado.codigo, 'declaracion_desactualizada')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('retenciones recibidas: el borrador las resta y cuadra con RET_IVA_REC; el pago anulado las devuelve', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const s = await venta(e.B, MES, '150.00')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '147.59',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_IVA_ESP', numero: unico('ct'), monto: '2.41' }],
            },
            e.ctx,
        )
        const mes = MES
        const conRetencion = await calcular(e.ctx, e.B, mes)
        assert.include(conRetencion.totales, {
            debito: '16.07',
            retenciones: '2.41',
            impuesto_determinado: '13.66',
            a_pagar: '13.66',
        })
        await new VerificarCierre().execute({ empresa_id: e.B, tipo: 'impuestos', periodo: mes }, e.ctx)
        let [cuadrado] = await checksVigentes(db.connection(), e.B, 'impuestos', `${mes}-01`)
        assert.deepEqual(
            [cuadrado!.resultado, cuadrado!.obtenido],
            ['ok', 'V_IVA 16.07 · C_IVA 0.00 · RET_IVA_REC 2.41'],
        )

        // anular el pago revierte su etiqueta: la retención sale del mes y el borrador viejo ya no cuadra
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'Constancia equivocada' }, e.ctx)
        await new VerificarCierre().execute({ empresa_id: e.B, tipo: 'impuestos', periodo: mes }, e.ctx)
        ;[cuadrado] = await checksVigentes(db.connection(), e.B, 'impuestos', `${mes}-01`)
        assert.deepEqual(
            [cuadrado!.resultado, cuadrado!.obtenido],
            ['anomalia', 'V_IVA 16.07 · C_IVA 0.00 · RET_IVA_REC 0.00 · borrador desactualizado'],
        )
        const otra = await calcular(e.ctx, e.B, mes)
        assert.include(otra.totales, { retenciones: '0.00', a_pagar: '16.07' })
        assert.sameMembers(
            otra.detalle.renglones.filter((r) => r.seccion === 'retenciones').map((r) => r.iva),
            ['2.41', '-2.41'],
        )
        await new VerificarCierre().execute({ empresa_id: e.B, tipo: 'impuestos', periodo: mes }, e.ctx)
        ;[cuadrado] = await checksVigentes(db.connection(), e.B, 'impuestos', `${mes}-01`)
        assert.equal(cuadrado!.resultado, 'ok')
        // el mes no ha terminado: no se revisa
        const enCurso = await errorDe(new RevisarDeclaracion().execute({ declaracion_id: otra.id }, e.ctx))
        assert.equal(enCurso.codigo, 'periodo_en_curso')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('reglas: antes de inicio_libros, obligación que no aplica, periodo futuro', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-06-01')
        const antes = await errorDe(calcular(e.ctx, e.B, '2026-05'))
        assert.deepEqual([antes.status, antes.codigo], [422, 'antes_de_inicio_libros'])
        const futuro = await errorDe(calcular(e.ctx, e.B, '2099-01'))
        assert.equal(futuro.reglas[0], 'futuro')
        const pc = await errorDe(
            new CalcularDeclaracion().execute(
                { empresa_id: e.B, impuesto: 'pc_mensual', periodo: '2026-07' },
                e.ctx,
            ),
        )
        assert.deepEqual([pc.status, pc.codigo], [422, 'obligacion_no_aplica'])
        await afirmarLibro(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · cascada de remanentes (H34)', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    async function excepcion(e: Awaited<ReturnType<typeof prepararEmpresasGt>>) {
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.B,
                tipo: 'impuestos',
                motivo: 'Factura del mes recibida tarde',
                hasta_en: new Date(Date.now() + 3_600_000).toISOString(),
            },
            e.ctx,
        )
    }

    test('una sustitutiva que cambia el remanente rectifica en cascada los dos meses siguientes ya revisados (uno presentado)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, MES, '112.00') // IVA 12
        await compra(e.ctx, e.B, HOY, '336.00') // crédito 36 → remanente 24
        reloj(SIGUIENTE)
        const octubre = await calcular(e.ctx, e.B, MES)
        await new RevisarDeclaracion().execute({ declaracion_id: octubre.id }, e.ctx)
        reloj(DESPUES)
        const noviembre = await calcular(e.ctx, e.B, SIGUIENTE)
        await new RevisarDeclaracion().execute({ declaracion_id: noviembre.id }, e.ctx)
        await new MarcarDeclaracionPresentada().execute(
            {
                declaracion_id: noviembre.id,
                numero_formulario: '2237-11',
                fecha_presentacion: `${DESPUES}-02`,
            },
            e.ctx,
        )
        reloj(mesTras(DESPUES))
        const diciembre = await calcular(e.ctx, e.B, DESPUES)
        assert.include(diciembre.totales, { remanente_credito_anterior: '24.00', remanente_credito: '24.00' })
        await new RevisarDeclaracion().execute({ declaracion_id: diciembre.id }, e.ctx)

        // compra tardía del primer mes: su sustitutiva deja 30 y rectifica noviembre y diciembre
        await excepcion(e)
        await compra(e.ctx, e.B, HOY, '56.00') // crédito 6
        const sustitutiva = await calcular(e.ctx, e.B, MES, { sustitutiva: true })
        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: sustitutiva.id }, e.ctx)
        assert.deepEqual(
            revisada.cascada.map((m) => [
                m.periodo,
                m.version,
                m.estaba_presentada,
                m.remanente_credito_anterior,
                m.remanente_credito,
            ]),
            [
                [SIGUIENTE, 2, true, '30.00', '30.00'],
                [DESPUES, 2, false, '30.00', '30.00'],
            ],
        )
        // noviembre vuelve a «por presentar» como rectificativa; su versión presentada queda sustituida
        const obligacion = await db
            .from('fiscal.obligaciones')
            .where({ empresa_id: e.B, impuesto: 'iva_mensual', periodo_desde: `${SIGUIENTE}-01` })
            .firstOrFail()
        assert.deepEqual(
            [obligacion.estado, obligacion.motivo_estado, Number(obligacion.declaracion_id)],
            ['borrador', 'rectificativa', revisada.cascada[0]!.declaracion_id],
        )
        const presentadaAntes = await db.from('fiscal.declaraciones').where('id', noviembre.id).firstOrFail()
        assert.equal(presentadaAntes.estado, 'sustituida')
        const avisos = await eventos('declaracion.revisada', 'cascada_de', sustitutiva.id)
        assert.deepEqual(
            avisos.map((a) => [a.motivo, a.periodo_desde]),
            [
                ['cascada', `${SIGUIENTE}-01`],
                ['cascada', `${DESPUES}-01`],
            ],
        )
        // sin asiento extra: el crédito no usado queda en 1.1.04 (30) y todo cuadra
        assert.equal(await saldoCuenta(e.B, '1.1.04'), '30.00')
        for (const mes of [MES, SIGUIENTE, DESPUES]) {
            const checks = await checksVigentes(db.connection(), e.B, 'impuestos', `${mes}-01`)
            assert.isTrue(
                checks.every((c) => c.resultado === 'ok'),
                mes,
            )
        }
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('la cascada se detiene donde el remanente no cambia', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        await venta(e.B, MES, '224.00') // IVA 24
        await compra(e.ctx, e.B, HOY, '112.00') // crédito 12 → a pagar 12, remanente 0
        reloj(SIGUIENTE)
        const octubre = await calcular(e.ctx, e.B, MES)
        await new RevisarDeclaracion().execute({ declaracion_id: octubre.id }, e.ctx)
        reloj(DESPUES)
        const noviembre = await calcular(e.ctx, e.B, SIGUIENTE)
        await new RevisarDeclaracion().execute({ declaracion_id: noviembre.id }, e.ctx)

        await excepcion(e)
        await compra(e.ctx, e.B, HOY, '56.00') // crédito 6: a pagar 6, remanente sigue en 0
        const sustitutiva = await calcular(e.ctx, e.B, MES, { sustitutiva: true })
        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: sustitutiva.id }, e.ctx)
        assert.include(revisada.totales, { a_pagar: '6.00', remanente_credito: '0.00' })
        assert.deepEqual(revisada.cascada, [])
        const intacta = await db.from('fiscal.declaraciones').where('id', noviembre.id).firstOrFail()
        assert.equal(intacta.estado, 'revisada')
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', sustitutiva.id), [
            ['1.1.04', '0.00', '6.00', null],
            ['2.1.06', '6.00', '0.00', null],
        ])
        await afirmarLibro(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · pequeño contribuyente y NCRE', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('pequeño contribuyente: 5 % del total del libro de ventas; liquidación 5.3.04 / 2.1.09 y bloqueo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        const pcVenta = await venta(e.B, MES, '336.00')
        // el pequeño contribuyente no separa IVA: total = precio, todo a ingresos, sin 2.1.02 ni etiqueta
        const factura = pcVenta.facturas[0]!
        assert.deepEqual([factura.total, factura.iva], ['336.00', '0.00'])
        const partidasPc = await partidas('factura', factura.id)
        assert.isTrue(partidasPc.every((p) => p[0] !== '2.1.02' && p[0] !== '2.1.11' && p[3] === null))
        // su nota de crédito tampoco: reduce el total del libro de ventas
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: factura.id, monto: '36.00', motivo: 'Descuento acordado' },
            e.ctx,
        )
        assert.equal(nota.iva, '0.00')
        const partidasNota = await partidas('nota_credito', nota.id)
        assert.isTrue(partidasNota.every((p) => p[0] !== '2.1.02'))
        // la empresa general del mismo escenario sigue separando el IVA
        const general = await venta(e.C, MES, '112.00')
        assert.equal(general.facturas[0]!.iva, '12.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const iva = await errorDe(calcular(e.ctx, e.B, MES))
        assert.equal(iva.codigo, 'obligacion_no_aplica')
        const pc = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'pc_mensual', periodo: MES },
            e.ctx,
        )
        assert.include(pc.totales, {
            ventas: '300.00',
            base: '300.00',
            impuesto: '15.00',
            a_pagar: '15.00',
            iva_en_ventas: '0.00',
        })
        assert.equal(pc.formulario, 'SAT-2046')
        assert.include(
            pc.parametros.map((p) => p.clave),
            'impuesto:IVA_PC',
        )
        await new RevisarDeclaracion().execute({ declaracion_id: pc.id }, e.ctx)
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', pc.id), [
            ['2.1.09', '0.00', '15.00', null],
            ['5.3.04', '15.00', '0.00', null],
        ])
        assert.equal(await bloqueoVigente(db.connection(), e.B, 'impuestos'), FIN)
        const checks = await checksVigentes(db.connection(), e.B, 'impuestos', `${MES}-01`)
        assert.deepEqual(
            checks.map((c) => [c.clave, c.resultado, c.esperado]),
            [
                ['iva_cuadrado', 'ok', 'ventas 300.00 · RET_IVA_REC 0.00'],
                ['iva_liquidado', 'ok', '2.1.09 -15.00'],
            ],
        )
        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: pc.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: `${SIGUIENTE}-05`,
            },
            e.ctx,
        )
        assert.include(pagada.pago, { impuesto: '15.00', mora: '0.00', multa: '0.00', total: '15.00' })
        assert.equal(await saldoCuenta(e.B, '2.1.09'), '0.00')
        // nada queda en 2.1.02 de la empresa PC
        assert.equal(Number(await saldoCuenta(e.B, '2.1.02')), 0)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('una NCRE sin certificar del mes impide liquidar (409 ncre_sin_certificar)', async ({ assert }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        await cola(e)
        await new EmitirNotaCredito().execute(
            { factura_id: s.facturas[0]!.id, monto: '50.00', motivo: 'descuento' },
            e.ctx,
        )
        // el mes de la nota ya terminó (reloj fiscal); su NCRE sigue en cola
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const borrador = await calcular(e.ctx, e.B, MES)
        const error = await errorDe(new RevisarDeclaracion().execute({ declaracion_id: borrador.id }, e.ctx))
        assert.deepEqual([error.status, error.codigo], [409, 'ncre_sin_certificar'])
        assert.isNull(await bloqueoVigente(db.connection(), e.B, 'impuestos'))
        await afirmarLibro(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · declaraciones por la API', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('calcular, ver (desactualizada), listar, revisar y presentar con su esquema y permisos', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        await venta(e.B, MES, '224.00')
        const cabecera = { 'X-Empresa-Id': String(e.B) }

        const creada = await estado(
            client
                .post('/api/v1/declaraciones/calcular')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('decl') })
                .json({ impuesto: 'iva_mensual', periodo: MES }),
            201,
        )
        const s = await esquemas()
        exigirCampos(assert, s.Declaracion!, creada.body(), 'Declaracion')
        const id = creada.body().id
        const vista = await estado(
            client.get(`/api/v1/declaraciones/${id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        exigirCampos(assert, s.DeclaracionDetalle!, vista.body(), 'DeclaracionDetalle')
        assert.isFalse(vista.body().desactualizada)
        await compra(e.ctx, e.B, HOY, '112.00')
        const cambiada = await estado(
            client.get(`/api/v1/declaraciones/${id}`).bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.isTrue(cambiada.body().desactualizada)

        const lista = await estado(
            client.get('/api/v1/declaraciones').bearerToken(e.token).headers(cabecera).qs({ periodo: MES }),
            200,
        )
        assert.deepEqual(
            lista.body().data.map((d: any) => d.id),
            [id],
        )
        const otra = await estado(
            client
                .post('/api/v1/declaraciones/calcular')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('decl') })
                .json({ impuesto: 'iva_mensual', periodo: MES }),
            201,
        )
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        await estado(
            client
                .post(`/api/v1/declaraciones/${otra.body().id}/revisar`)
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('rev') }),
            200,
        )
        const presentada = await estado(
            client
                .post(`/api/v1/declaraciones/${otra.body().id}/marcar-presentada`)
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('pre') })
                .json({ numero_formulario: '2237-55', fecha_presentacion: `${SIGUIENTE}-04` }),
            200,
        )
        assert.equal(presentada.body().estado, 'presentada')

        // obligaciones: regla tipada y filtro de vencidas
        const vencidas = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ vencida: true }),
            200,
        )
        assert.isAbove(vencidas.body().data.length, 0)
        assert.isTrue(vencidas.body().data.every((o: any) => o.vencida === true))
        exigirCampos(assert, s.ObligacionFiscal!, vencidas.body().data[0], 'ObligacionFiscal')
        assert.includeMembers(Object.keys(vencidas.body().data[0].regla), [
            'parametro',
            'valor',
            'vigente_desde',
            'nivel',
            'vence_base',
            'corrido_a_habil',
        ])
        const noVencidas = await estado(
            client
                .get('/api/v1/fiscal/obligaciones')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ vencida: false }),
            200,
        )
        assert.isTrue(noVencidas.body().data.every((o: any) => o.vencida === false))

        const { usuarioConRoles } = await import('#tests/ayudas')
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .post('/api/v1/declaraciones/calcular')
                .bearerToken(cajero.token)
                .headers(cabecera)
                .json({ impuesto: 'iva_mensual', periodo: MES }),
            403,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
