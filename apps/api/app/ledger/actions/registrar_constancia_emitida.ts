import { DomainAction, type Transaccion } from '#shared/domain_action'
import { LOCK_COMPRA } from '#ledger/actions/registrar_pago_proveedor'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { verConstancia, type ConstanciaVista } from '#ledger/constancias'

/**
 * `compras.registrar_constancia` (`POST /compras/:id/constancias`, permiso `compras.registrar`): el
 * número de la constancia de retención que la empresa emitió a su proveedor (Retenciones Web de la
 * SAT) por una retención de la compra (contrato de localización fiscal §3.4).
 *
 * No mueve el libro: la retención ya está en `2.1.04` o `2.1.05` desde la compra. El monto es el de
 * la retención de ese impuesto en la compra. Una constancia por retención (409
 * `constancia_registrada`); número único por empresa e impuesto entre las emitidas (409
 * `constancia_duplicada`); compra anulada: 409 `compra_anulada`.
 */

export interface EntradaConstanciaEmitida {
    compra_id: number
    impuesto_codigo: string
    numero: string
    fecha?: string | null
}

export default class RegistrarConstanciaEmitida extends DomainAction<
    EntradaConstanciaEmitida,
    ConstanciaVista
> {
    readonly nombre = 'compras.registrar_constancia'

    protected async handle(input: EntradaConstanciaEmitida, t: Transaccion): Promise<ConstanciaVista> {
        t.fijarEntidad('compra', input.compra_id)
        const compra = await t.trx
            .from('ledger.compras')
            .where('id', input.compra_id)
            .select('id', 'empresa_id', 'proveedor_id')
            .first()
        if (!compra) throw new NoEncontrado(`La compra ${input.compra_id} no existe`)
        const empresaId = Number(compra.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_COMPRA, compra.id])
        const anulada = await t.trx.from('ledger.compras_anulaciones').where('compra_id', compra.id).first()
        if (anulada) {
            throw new Conflicto(`La compra ${compra.id} está anulada`, 'compra_anulada', 'Compra anulada')
        }

        const codigo = input.impuesto_codigo.trim().toUpperCase()
        const retencion = (await t.trx
            .from('ledger.compras_retenciones')
            .where({ compra_id: compra.id, impuesto_codigo: codigo })
            .select('impuesto', 'monto')
            .first()) as { impuesto: 'iva' | 'isr'; monto: string } | null
        if (!retencion) {
            throw new ValidacionFallida([
                {
                    field: 'impuesto_codigo',
                    message: `La compra ${compra.id} no tiene la retención ${codigo}`,
                    rule: 'exists',
                },
            ])
        }
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
            ])
        }
        const numero = input.numero.trim().toUpperCase()
        const previa = await t.trx
            .from('ledger.constancias_retencion')
            .where({ compra_id: compra.id, impuesto_codigo: codigo, direccion: 'emitida' })
            .select('numero')
            .first()
        if (previa) {
            throw new Conflicto(
                `La retención ${codigo} de la compra ${compra.id} ya tiene la constancia ${previa.numero}`,
                'constancia_registrada',
                'Constancia registrada',
            )
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [
            3014,
            `${empresaId}:emitida:${retencion.impuesto}:${numero}`,
        ])
        const repetida = await t.trx
            .from('ledger.constancias_retencion')
            .where({ empresa_id: empresaId, direccion: 'emitida', impuesto: retencion.impuesto, numero })
            .select('compra_id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La constancia ${numero} ya está registrada en la compra ${repetida.compra_id}`,
                'constancia_duplicada',
                'Constancia duplicada',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.constancias_retencion')
            .insert({
                empresa_id: empresaId,
                direccion: 'emitida',
                impuesto: retencion.impuesto,
                impuesto_codigo: codigo,
                numero,
                fecha,
                monto: retencion.monto,
                compra_id: compra.id,
                proveedor_id: Number(compra.proveedor_id),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        return verConstancia(Number(fila!.id), t.trx)
    }
}
