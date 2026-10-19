import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { LOCK_CONCILIACION, type ConciliacionVista } from '#ledger/conciliacion'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import ConciliarLinea from '#ledger/actions/conciliar_linea'

/**
 * `bancos.reatribuir_llegada` (`POST /bancos/llegadas/reatribuir`, permiso `bancos.reatribuir_llegada`):
 * corrige una llegada al banco atribuida al depósito o traslado equivocado (desvío c del contrato
 * §18, pedido del líder). Todo de solo inserción:
 *
 * 1. Deshace la conciliación de la línea (filas de anulación con el motivo).
 * 2. Revierte el asiento de llegada (`Banco / 1.1.11`) con su espejo y deja la fila en
 *    `ledger.transitos_reatribuciones`: el documento original vuelve a estar en tránsito.
 * 3. Registra la llegada del documento correcto con la misma línea (`bancos.conciliar` anidada:
 *    asiento nuevo `Banco / 1.1.11` y conciliación nueva). Los demás movimientos que la línea tenía
 *    conciliados se vuelven a ligar; Σ debe seguir siendo el monto de la línea (422
 *    `conciliacion_descuadrada`).
 */

export interface EntradaReatribuirLlegada {
    tipo: 'deposito' | 'traslado'
    documento_id: number
    nuevo_tipo: 'deposito' | 'traslado'
    nuevo_documento_id: number
    motivo: string
}

export default class ReatribuirLlegada extends DomainAction<EntradaReatribuirLlegada, ConciliacionVista> {
    readonly nombre = 'bancos.reatribuir_llegada'

    protected async handle(input: EntradaReatribuirLlegada, t: Transaccion): Promise<ConciliacionVista> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'El motivo es obligatorio', rule: 'required' },
            ])
        }
        if (input.tipo === input.nuevo_tipo && input.documento_id === input.nuevo_documento_id) {
            throw new ValidacionFallida([
                { field: 'nuevo_documento_id', message: 'El documento nuevo es el mismo', rule: 'distinto' },
            ])
        }
        const llegada = (await t.trx
            .from('ledger.transitos_acreditados as x')
            .where({ 'x.tipo': input.tipo, 'x.documento_id': input.documento_id })
            .whereNotExists((q) =>
                q.from('ledger.transitos_reatribuciones as r').whereRaw('r.acreditado_id = x.id'),
            )
            .select('x.id', 'x.empresa_id', 'x.cuenta_id', 'x.linea_id')
            .first()) as { id: number; empresa_id: number; cuenta_id: number; linea_id: number | null } | null
        if (!llegada) {
            throw new NoEncontrado(
                `El ${input.tipo} ${input.documento_id} no tiene una llegada vigente al banco`,
            )
        }
        const empresaId = Number(llegada.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad(input.tipo, input.documento_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [
            LOCK_CONCILIACION,
            llegada.cuenta_id,
        ])
        if (!llegada.linea_id) {
            throw new Conflicto(
                'La llegada no está ligada a una línea del extracto',
                'llegada_sin_linea',
                'Llegada sin línea',
            )
        }

        // asiento de llegada vigente: Banco (debe) / 1.1.11 (haber) del documento
        const asiento = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .where('a.origen_tipo', input.tipo)
            .where('a.origen_id', input.documento_id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .where('m.cuenta_id', llegada.cuenta_id)
            .where('m.debe', '>', 0)
            .whereExists((q) =>
                q
                    .from('ledger.movimientos as mt')
                    .join('ledger.cuentas as ct', 'ct.id', 'mt.cuenta_id')
                    .whereRaw('mt.asiento_id = a.id')
                    .where('ct.codigo', CUENTAS_GT.FONDOS_EN_TRANSITO)
                    .where('mt.haber', '>', 0),
            )
            .orderBy('a.id', 'desc')
            .select('a.id as asiento_id', 'm.id as movimiento_id')
            .first()) as { asiento_id: number; movimiento_id: number } | null
        if (!asiento) {
            throw new NoEncontrado(
                `No se encontró el asiento de llegada del ${input.tipo} ${input.documento_id}`,
            )
        }

        // 1. deshacer la conciliación de la línea
        const filas = (await t.trx
            .from('ledger.conciliaciones as k')
            .where('k.linea_id', llegada.linea_id)
            .whereNotExists((q) =>
                q.from('ledger.conciliaciones_anulaciones as x').whereRaw('x.conciliacion_id = k.id'),
            )
            .select('k.id', 'k.movimiento_id')) as Array<{ id: number; movimiento_id: number }>
        if (filas.length > 0) {
            await t.trx
                .insertQuery()
                .table('ledger.conciliaciones_anulaciones')
                .multiInsert(
                    filas.map((f) => ({
                        conciliacion_id: f.id,
                        motivo: `reatribución de la llegada del ${input.tipo} ${input.documento_id}: ${motivo}`,
                        anulado_por: usuarioDelActor(t.ctx.actor),
                    })),
                )
        }
        // 2. reverso espejo de la llegada y su fila de reatribución
        const reverso = await new RevertirAsiento().execute(
            {
                asiento_id: Number(asiento.asiento_id),
                motivo: `reatribución de la llegada del ${input.tipo} ${input.documento_id}: ${motivo}`,
                por_anulacion: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('ledger.transitos_reatribuciones')
            .insert({
                empresa_id: empresaId,
                acreditado_id: llegada.id,
                asiento_reverso_id: reverso.id,
                motivo,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
        // 3. llegada del documento correcto y conciliación nueva de la misma línea
        const otros = filas
            .map((f) => Number(f.movimiento_id))
            .filter((id) => id !== Number(asiento.movimiento_id))
        return new ConciliarLinea().execute(
            {
                linea_id: Number(llegada.linea_id),
                movimientos: otros,
                depositos: input.nuevo_tipo === 'deposito' ? [input.nuevo_documento_id] : [],
                traslados: input.nuevo_tipo === 'traslado' ? [input.nuevo_documento_id] : [],
            },
            t.ctx,
            { trx: t.trx },
        )
    }
}
