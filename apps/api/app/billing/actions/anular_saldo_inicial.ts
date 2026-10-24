import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aperturaCerradaPara } from '#ledger/apertura'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { bloquearCliente, sumarAPagado, type FacturaPendiente } from '#billing/cobros'
import { claveImportacion } from '#billing/importacion'

/**
 * `facturas.anular_saldo_inicial` = `anularSaldoInicial` (importador de A6, sin endpoint): deshace
 * un saldo inicial importado por error. Nunca borra ni edita el libro: revierte cada asiento con
 * `RevertirAsiento` (fecha de hoy, en el periodo abierto).
 *
 * - H63: si el saldo ya entró en un cierre de apertura (cierre vigente con fecha ≥ la del saldo),
 *   409 `saldo_con_apertura_cerrada` (no se reabre 2.9.01; se corrige con nota o ajuste del periodo).
 * - Saldo deudor (`monto > 0`): revierte `CxC / 2.9.01` y anula la factura de apertura. Si ya
 *   tiene pagos aplicados → 409 `saldo_con_pagos` (anular primero esos pagos).
 * - Saldo a favor (`monto < 0`): revierte `2.9.01 / Anticipos` y cada aplicación a facturas
 *   (`Anticipos / CxC`), devolviendo esas facturas a su pendiente.
 * - El saldo queda `anulado` (con quién, cuándo y por qué); su `id_externo` no se puede volver a
 *   usar (409 `saldo_inicial_anulado`): una nueva importación lleva otro id.
 * - Sin eventos y sin reevaluar servicios (como toda la importación): el siguiente corte decide.
 */

export interface EntradaAnularSaldoInicial {
    /** id del saldo en ArgosIsp, o `id_externo` (+ `origen`) del sistema de origen */
    saldo_inicial_id?: number
    /** con `id_externo`: el sistema de origen (sin él, el prefijo del id, como al registrar) */
    origen?: string
    id_externo?: string
    motivo: string
}

export interface ResultadoAnularSaldoInicial {
    saldo_inicial_id: number
    origen: string
    id_externo: string
    cliente_id: number
    monto: string
    factura_id: number | null
    /** asientos de reverso creados */
    reversos: number[]
}

interface FilaSaldo {
    id: number
    empresa_id: number
    origen: string
    clave_externa: string
    cliente_id: number
    monto: string
    factura_id: number | null
    anulado_en: Date | null
}

export default class AnularSaldoInicial extends DomainAction<
    EntradaAnularSaldoInicial,
    ResultadoAnularSaldoInicial
> {
    readonly nombre = 'facturas.anular_saldo_inicial'

    protected async handle(
        input: EntradaAnularSaldoInicial,
        t: Transaccion,
    ): Promise<ResultadoAnularSaldoInicial> {
        const motivo = input.motivo?.trim()
        if (!motivo) {
            throw new ValidacionFallida([{ field: 'motivo', message: 'Obligatorio', rule: 'required' }])
        }
        if (!input.saldo_inicial_id && !input.id_externo?.trim()) {
            throw new ValidacionFallida([
                { field: 'id_externo', message: 'Indique saldo_inicial_id o id_externo', rule: 'required' },
            ])
        }
        const clave = input.saldo_inicial_id ? null : claveImportacion(input)
        const buscar = () =>
            t.trx
                .from('billing.saldos_iniciales')
                .if(
                    input.saldo_inicial_id,
                    (q) => q.where('id', input.saldo_inicial_id!),
                    (q) => q.where('origen', clave!.origen).where('clave_externa', clave!.id_externo),
                )
                .select(
                    'id',
                    'empresa_id',
                    'origen',
                    'clave_externa',
                    'cliente_id',
                    'monto',
                    'factura_id',
                    'anulado_en',
                )
        const previo = (await buscar().first()) as FilaSaldo | null
        if (!previo) throw new NoEncontrado('El saldo inicial no existe')
        t.fijarEntidad('saldo_inicial', previo.id)
        exigirAccesoEmpresa(t.ctx, Number(previo.empresa_id))
        t.fijarEmpresa(Number(previo.empresa_id))
        await bloquearCliente(t.trx, previo.cliente_id)
        const saldo = (await buscar().forUpdate().firstOrFail()) as FilaSaldo
        if (saldo.anulado_en) {
            throw new Conflicto(
                `El saldo inicial ${saldo.clave_externa} ya está anulado`,
                'saldo_inicial_anulado',
                'Saldo inicial anulado',
            )
        }

        // H63: si el saldo ya entró en un cierre de apertura, anularlo reabriría 2.9.01 (como la importada)
        const fila = (await t.trx
            .from('billing.saldos_iniciales')
            .where('id', saldo.id)
            .select(t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
            .firstOrFail()) as { fecha: string }
        if (await aperturaCerradaPara(t.trx, Number(previo.empresa_id), fila.fecha)) {
            throw new Conflicto(
                `El saldo inicial ${saldo.clave_externa} ya entró en el cierre de apertura: corrígelo con una nota de crédito o un ajuste del periodo`,
                'saldo_con_apertura_cerrada',
                'Saldo con la apertura cerrada',
            )
        }

        const reversos: number[] = []
        const revertir = async (origenTipo: 'factura' | 'ajuste', origenId: number) => {
            const asientos = (await t.trx
                .from('ledger.asientos as a')
                .where('a.origen_tipo', origenTipo)
                .where('a.origen_id', origenId)
                .whereNull('a.reversa_de')
                .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
                .orderBy('a.id', 'asc')
                .select('a.id')) as Array<{ id: number }>
            for (const asiento of asientos) {
                const reverso = await new RevertirAsiento().execute(
                    {
                        asiento_id: asiento.id,
                        motivo: `anulación del saldo inicial ${saldo.clave_externa}: ${motivo}`,
                        por_anulacion: true,
                    },
                    t.ctx,
                    { trx: t.trx },
                )
                reversos.push(reverso.id)
            }
        }

        if (saldo.factura_id) {
            const factura = (await t.trx
                .from('billing.facturas')
                .where('id', saldo.factura_id)
                .forUpdate()
                .select('id', 'estado', 'pagado')
                .firstOrFail()) as { id: number; estado: string; pagado: string }
            if (dec(factura.pagado).gt(0)) {
                throw new Conflicto(
                    `La factura de apertura ${factura.id} tiene Q${factura.pagado} pagados: anule primero esos pagos`,
                    'saldo_con_pagos',
                    'Saldo inicial con pagos',
                )
            }
            await revertir('factura', factura.id)
            await t.trx
                .from('billing.facturas')
                .where('id', factura.id)
                .update({
                    estado: 'anulada',
                    anulada_en: t.trx.knexRawQuery('now()'),
                    anulada_por: usuarioDelActor(t.ctx.actor),
                    motivo_anulacion: `anulación del saldo inicial ${saldo.clave_externa}: ${motivo}`,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'factura', id: factura.id },
                { estado: factura.estado },
                { estado: 'anulada' },
            )
        } else {
            // saldo a favor: devolver a cada factura lo que cubrió
            const aplicaciones = (await t.trx
                .from('billing.saldos_iniciales_aplicaciones')
                .where('saldo_inicial_id', saldo.id)
                .groupBy('factura_id')
                .select('factura_id', t.trx.raw('sum(monto)::text as monto'))) as Array<{
                factura_id: number
                monto: string
            }>
            const facturas = (await t.trx
                .from('billing.facturas')
                .whereIn(
                    'id',
                    aplicaciones.map((a) => a.factura_id),
                )
                .orderBy('id', 'asc')
                .forUpdate()
                .select(
                    'id',
                    'empresa_id',
                    'cliente_id',
                    'servicio_id',
                    'total',
                    'pagado',
                    'vencida_en',
                )) as FacturaPendiente[]
            for (const factura of facturas) {
                const aplicado = aplicaciones.find((a) => a.factura_id === factura.id)!
                await sumarAPagado(t.trx, factura, dec(aplicado.monto).negated())
            }
            await revertir('ajuste', saldo.id)
        }

        await t.trx
            .from('billing.saldos_iniciales')
            .where('id', saldo.id)
            .update({
                anulado_en: t.trx.knexRawQuery('now()'),
                anulado_por: usuarioDelActor(t.ctx.actor),
                motivo_anulacion: motivo,
            })
        await t.registrarCambios(
            { tipo: 'saldo_inicial', id: saldo.id },
            { estado: 'registrado' },
            { estado: 'anulado' },
        )

        return {
            saldo_inicial_id: saldo.id,
            origen: saldo.origen,
            id_externo: saldo.clave_externa,
            cliente_id: saldo.cliente_id,
            monto: saldo.monto,
            factura_id: saldo.factura_id,
            reversos,
        }
    }
}
