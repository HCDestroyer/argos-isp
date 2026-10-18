import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { LOCK_CONCILIACION, verConciliacion, type ConciliacionVista } from '#ledger/conciliacion'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `bancos.conciliar` (`POST /bancos/conciliaciones`): liga una línea del extracto con lo que ya está
 * en el libro (contrato de localización fiscal §10.3). **Nunca reescribe un asiento.**
 *
 * - `movimientos[]`: movimientos del libro en la cuenta del extracto, de la misma empresa y sin
 *   conciliación vigente; cada uno cuenta por su neto (debe − haber).
 * - `depositos[]` / `traslados[]`: lo que estaba en `1.1.11 Fondos en tránsito` y llega con esta
 *   línea. Se registra su llegada (asiento **nuevo** `Banco / 1.1.11`, mismo origen que el
 *   documento, fecha de la línea) y su movimiento del banco entra a la conciliación.
 * - Σ = monto de la línea (422 `conciliacion_descuadrada`). La línea ya conciliada responde 409
 *   `linea_conciliada`; un movimiento ya conciliado, 409 `movimiento_conciliado`.
 * - Filas en `ledger.conciliaciones` con un mismo `grupo`; evento `banco.conciliado`.
 */

export interface EntradaConciliarLinea {
    linea_id: number
    movimientos?: number[] | null
    depositos?: number[] | null
    traslados?: number[] | null
    /** interno: regla que la concilió (`bancos.aplicar_reglas`) */
    regla_id?: number | null
}

interface Linea {
    id: number
    empresa_id: number
    cuenta_id: number
    fecha: string
    monto: string
    descripcion: string
}

export default class ConciliarLinea extends DomainAction<EntradaConciliarLinea, ConciliacionVista> {
    readonly nombre = 'bancos.conciliar'

    protected async handle(input: EntradaConciliarLinea, t: Transaccion): Promise<ConciliacionVista> {
        const linea = (await t.trx
            .from('ledger.extractos_lineas')
            .where('id', input.linea_id)
            .select(
                'id',
                'empresa_id',
                'cuenta_id',
                t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
                'monto',
                'descripcion',
            )
            .first()) as Linea | null
        if (!linea) throw new NoEncontrado(`La línea de extracto ${input.linea_id} no existe`)
        const empresaId = Number(linea.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('extracto_linea', linea.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CONCILIACION, linea.cuenta_id])

        const yaConciliada = await t.trx
            .from('ledger.conciliaciones as k')
            .where('k.linea_id', linea.id)
            .whereNotExists((q) =>
                q.from('ledger.conciliaciones_anulaciones as x').whereRaw('x.conciliacion_id = k.id'),
            )
            .select('k.id')
            .first()
        if (yaConciliada) {
            throw new Conflicto(
                `La línea ${linea.id} ya está conciliada (conciliación ${yaConciliada.id}); anúlala primero`,
                'linea_conciliada',
                'Línea conciliada',
            )
        }

        const movimientosIds = [...new Set(input.movimientos ?? [])]
        const depositosIds = [...new Set(input.depositos ?? [])]
        const trasladosIds = [...new Set(input.traslados ?? [])]
        if (movimientosIds.length + depositosIds.length + trasladosIds.length === 0) {
            throw new ValidacionFallida([
                {
                    field: 'movimientos',
                    message: 'Indica los movimientos, depósitos o traslados de la línea',
                    rule: 'required',
                },
            ])
        }

        const errores: ErrorCampo[] = []
        let suma = CERO
        const movimientos = (await t.trx
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .whereIn('m.id', movimientosIds.length > 0 ? movimientosIds : [0])
            .select(
                'm.id',
                'm.cuenta_id',
                'a.empresa_id',
                t.trx.raw('(m.debe - m.haber)::text as neto'),
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.movimiento_id = m.id
                       AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id)) as conciliado`,
                ),
            )) as Array<{
            id: number
            cuenta_id: number
            empresa_id: number
            neto: string
            conciliado: boolean
        }>
        const porId = new Map(movimientos.map((m) => [Number(m.id), m]))
        const conciliados: ErrorCampo[] = []
        movimientosIds.forEach((id, i) => {
            const m = porId.get(id)
            if (!m || Number(m.cuenta_id) !== Number(linea.cuenta_id) || Number(m.empresa_id) !== empresaId) {
                errores.push({
                    field: `movimientos.${i}`,
                    message: `El movimiento ${id} no es de la cuenta del extracto en esta empresa`,
                    rule: 'otra_cuenta',
                })
            } else if (m.conciliado) {
                conciliados.push({
                    field: `movimientos.${i}`,
                    message: `El movimiento ${id} ya está conciliado`,
                    rule: 'movimiento_conciliado',
                })
            } else {
                suma = suma.plus(m.neto)
            }
        })
        const transitos = [
            ...(await this.enTransito(t, 'deposito', depositosIds, linea, errores)),
            ...(await this.enTransito(t, 'traslado', trasladosIds, linea, errores)),
        ]
        for (const x of transitos) suma = suma.plus(x.monto)
        if (conciliados.length > 0) {
            throw new Problema(
                409,
                'movimiento_conciliado',
                'Movimiento conciliado',
                'Un movimiento se concilia una sola vez',
                conciliados,
            )
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        if (!suma.equals(linea.monto)) {
            throw new Problema(
                422,
                'conciliacion_descuadrada',
                'Conciliación descuadrada',
                `La línea es de Q${aTexto(linea.monto)} y lo elegido suma Q${aTexto(suma)}`,
                [{ field: 'movimientos', message: `Σ = Q${aTexto(suma)}`, rule: 'conciliacion_descuadrada' }],
            )
        }

        // llegada de lo que estaba en tránsito: asiento nuevo Banco / 1.1.11 con la fecha de la línea
        const nuevos: Array<{ id: number; neto: Dec }> = []
        for (const x of transitos) {
            const fecha = x.fecha > linea.fecha ? x.fecha : linea.fecha
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha,
                    descripcion: `Llegada al banco del ${x.tipo === 'deposito' ? 'depósito' : 'traslado'} ${x.id} (línea ${linea.id} del extracto)`,
                    origen_tipo: x.tipo,
                    origen_id: x.id,
                    movimientos: [
                        { cuenta: Number(linea.cuenta_id), debe: aTexto(x.monto) },
                        { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, haber: aTexto(x.monto) },
                    ],
                },
                t.ctx,
                { trx: t.trx },
            )
            await t.trx
                .insertQuery()
                .table('ledger.transitos_acreditados')
                .insert({
                    empresa_id: empresaId,
                    tipo: x.tipo,
                    documento_id: x.id,
                    cuenta_id: Number(linea.cuenta_id),
                    fecha,
                    linea_id: linea.id,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })
            const mov = asiento.movimientos.find((m) => Number(m.cuenta_id) === Number(linea.cuenta_id))!
            nuevos.push({ id: mov.id, neto: x.monto })
        }

        const grupo = randomUUID()
        const filas = [...movimientosIds.map((id) => ({ id, neto: dec(porId.get(id)!.neto) })), ...nuevos]
        const insertadas = (await t.trx
            .insertQuery()
            .table('ledger.conciliaciones')
            .multiInsert(
                filas.map((f) => ({
                    empresa_id: empresaId,
                    cuenta_id: Number(linea.cuenta_id),
                    grupo,
                    linea_id: linea.id,
                    movimiento_id: f.id,
                    monto: aTexto(f.neto),
                    regla_id: input.regla_id ?? null,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })),
            )
            .returning('id')) as Array<{ id: number }>
        const primera = Math.min(...insertadas.map((f) => Number(f.id)))
        t.fijarEntidad('conciliacion', primera)
        const cuentaBancaria = (await t.trx
            .from('billing.cuentas_bancarias')
            .where('cuenta_id', linea.cuenta_id)
            .select('id')
            .first()) as { id: number } | null
        await t.emit('banco.conciliado', {
            conciliacion_id: primera,
            empresa_id: empresaId,
            cuenta_bancaria_id: cuentaBancaria ? Number(cuentaBancaria.id) : null,
            cuenta_id: Number(linea.cuenta_id),
            linea_id: linea.id,
            lineas: 1,
            monto: aTexto(linea.monto),
        })
        return verConciliacion(primera, t.trx)
    }

    /** Depósitos o traslados en tránsito que llegan a la cuenta de la línea. */
    private async enTransito(
        t: Transaccion,
        tipo: 'deposito' | 'traslado',
        ids: number[],
        linea: Linea,
        errores: ErrorCampo[],
    ): Promise<Array<{ tipo: 'deposito' | 'traslado'; id: number; monto: Dec; fecha: string }>> {
        if (ids.length === 0) return []
        const tabla = tipo === 'deposito' ? 'ledger.depositos' : 'ledger.traslados'
        const destino = tipo === 'deposito' ? 'cuenta_id' : 'cuenta_destino_id'
        const filas = (await t.trx
            .from(`${tabla} as d`)
            .whereIn('d.id', ids)
            .select(
                'd.id',
                'd.empresa_id',
                `d.${destino} as cuenta_id`,
                'd.monto',
                t.trx.raw(`to_char(d.fecha, 'YYYY-MM-DD') as fecha`),
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = ? AND x.documento_id = d.id) as acreditado`,
                    [tipo],
                ),
            )) as Array<{
            id: number
            empresa_id: number
            cuenta_id: number
            monto: string
            fecha: string
            acreditado: boolean
        }>
        const porId = new Map(filas.map((f) => [Number(f.id), f]))
        const campo = tipo === 'deposito' ? 'depositos' : 'traslados'
        const salida: Array<{ tipo: 'deposito' | 'traslado'; id: number; monto: Dec; fecha: string }> = []
        ids.forEach((id, i) => {
            const f = porId.get(id)
            if (
                !f ||
                Number(f.empresa_id) !== Number(linea.empresa_id) ||
                Number(f.cuenta_id) !== Number(linea.cuenta_id)
            ) {
                errores.push({
                    field: `${campo}.${i}`,
                    message: `El ${tipo} ${id} no llega a la cuenta del extracto`,
                    rule: 'otra_cuenta',
                })
            } else if (f.acreditado) {
                errores.push({
                    field: `${campo}.${i}`,
                    message: `El ${tipo} ${id} ya llegó al banco`,
                    rule: 'acreditado',
                })
            } else {
                salida.push({ tipo, id, monto: dec(f.monto), fecha: f.fecha })
            }
        })
        return salida
    }
}
