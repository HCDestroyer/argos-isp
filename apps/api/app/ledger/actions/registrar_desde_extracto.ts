import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { LOCK_CONCILIACION, contrapartidaProhibida, type ConciliacionVista } from '#ledger/conciliacion'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import ConciliarLinea from '#ledger/actions/conciliar_linea'

/**
 * `bancos.registrar_desde_extracto` (`POST /bancos/extractos/lineas/:id/registrar`, permiso
 * `bancos.conciliar`): una línea del extracto sin documento en el libro (comisión, cargo,
 * interés) genera un asiento **nuevo** de origen `banco` y se concilia con él (contrato §10.3; a
 * diferencia de Odoo, nunca se reescribe un asiento de suspenso).
 *
 * - Cargo (monto < 0): `contrapartida (por defecto 5.3.07 Gastos y comisiones bancarias) / Banco`.
 * - Abono (monto > 0): `Banco / contrapartida`; la contrapartida es obligatoria (un ingreso no se
 *   adivina). No puede ser caja, banco, puentes ni cuentas con auxiliar (422 `contrapartida`).
 * - Fecha del asiento: la de la línea. Una línea se registra una sola vez (409 `linea_registrada`).
 */

export interface EntradaRegistrarDesdeExtracto {
    linea_id: number
    /** código de la contrapartida */
    cuenta?: string | null
    descripcion?: string | null
    /** interno: regla que lo registró (`bancos.aplicar_reglas`) */
    regla_id?: number | null
}

export default class RegistrarDesdeExtracto extends DomainAction<
    EntradaRegistrarDesdeExtracto,
    ConciliacionVista
> {
    readonly nombre = 'bancos.registrar_desde_extracto'

    protected async handle(input: EntradaRegistrarDesdeExtracto, t: Transaccion): Promise<ConciliacionVista> {
        const linea = (await t.trx
            .from('ledger.extractos_lineas as l')
            .join('ledger.cuentas as c', 'c.id', 'l.cuenta_id')
            .where('l.id', input.linea_id)
            .select(
                'l.id',
                'l.empresa_id',
                'l.cuenta_id',
                'c.nombre as cuenta_nombre',
                t.trx.raw(`to_char(l.fecha, 'YYYY-MM-DD') as fecha`),
                'l.monto',
                'l.descripcion',
                'l.referencia',
            )
            .first()) as {
            id: number
            empresa_id: number
            cuenta_id: number
            cuenta_nombre: string
            fecha: string
            monto: string
            descripcion: string
            referencia: string | null
        } | null
        if (!linea) throw new NoEncontrado(`La línea de extracto ${input.linea_id} no existe`)
        const empresaId = Number(linea.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('extracto_linea', linea.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CONCILIACION, linea.cuenta_id])

        const registrada = await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'banco')
            .where('a.origen_id', linea.id)
            .whereNull('a.reversa_de')
            .select('a.id')
            .first()
        if (registrada) {
            throw new Conflicto(
                `La línea ${linea.id} ya tiene su asiento (${registrada.id}); concíliala con él`,
                'linea_registrada',
                'Línea registrada',
            )
        }
        const monto = dec(linea.monto)
        const codigo = input.cuenta?.trim() || (monto.isNegative() ? CUENTAS_GT.GASTOS_BANCARIOS : null)
        if (!codigo) {
            throw new ValidacionFallida([
                {
                    field: 'cuenta',
                    message: 'Un abono del banco necesita su contrapartida (interés, otro ingreso…)',
                    rule: 'required',
                },
            ])
        }
        const contrapartida = (await t.trx
            .from('ledger.cuentas')
            .where('codigo', codigo)
            .where('pais', 'GT')
            .where((q) => q.whereNull('empresa_id').orWhere('empresa_id', empresaId))
            .select('id', 'codigo', 'activa', 'imputable', 'auxiliar_cliente', 'auxiliar_proveedor')
            .first()) as {
            id: number
            codigo: string
            activa: boolean
            imputable: boolean
            auxiliar_cliente: boolean
            auxiliar_proveedor: boolean
        } | null
        if (
            !contrapartida ||
            !contrapartida.activa ||
            !contrapartida.imputable ||
            contrapartida.auxiliar_cliente ||
            contrapartida.auxiliar_proveedor ||
            contrapartidaProhibida(contrapartida.codigo)
        ) {
            throw new ValidacionFallida([
                {
                    field: 'cuenta',
                    message: `La cuenta ${codigo} no sirve de contrapartida (debe ser imputable, sin auxiliar y no de dinero ni puente)`,
                    rule: 'contrapartida',
                },
            ])
        }
        const abs = aTexto(monto.abs())
        const movimientos: LineaAsiento[] = monto.isNegative()
            ? [
                  { cuenta: Number(contrapartida.id), debe: abs },
                  { cuenta: Number(linea.cuenta_id), haber: abs },
              ]
            : [
                  { cuenta: Number(linea.cuenta_id), debe: abs },
                  { cuenta: Number(contrapartida.id), haber: abs },
              ]
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha: linea.fecha,
                descripcion:
                    input.descripcion?.trim() ||
                    `Extracto ${linea.cuenta_nombre}: ${linea.descripcion}${linea.referencia ? ` · ref. ${linea.referencia}` : ''}`,
                origen_tipo: 'banco',
                origen_id: linea.id,
                // partida del extracto: con la fecha cerrada o bloqueada va al primer día abierto (§10.4)
                trasladar_si_bloqueado: true,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )
        const asiento = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .where('a.origen_tipo', 'banco')
            .where('a.origen_id', linea.id)
            .where('m.cuenta_id', linea.cuenta_id)
            .select('m.id')
            .firstOrFail()) as { id: number }
        return new ConciliarLinea().execute(
            { linea_id: linea.id, movimientos: [Number(asiento.id)], regla_id: input.regla_id ?? null },
            t.ctx,
            { trx: t.trx },
        )
    }
}
