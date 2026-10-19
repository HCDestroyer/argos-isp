import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { verTraslado, type TrasladoVista } from '#ledger/transitos'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `bancos.trasladar` (`POST /bancos/trasladar`): traslado de fondos entre dos cuentas bancarias
 * propias de la **misma** empresa (contrato de localización fiscal §10.3).
 *
 * - Asiento `traslado` al salir: `1.1.11 Fondos en tránsito / Banco A`. La llegada (`Banco B /
 *   1.1.11`) la registra la conciliación de la línea del extracto de B (`bancos.conciliar`).
 * - Las dos cuentas son de la empresa o comunes (422 `cuenta_de_otra_empresa`: nunca cruza NIT) y
 *   distintas; referencia única por cuenta de origen (409 `traslado_duplicado`).
 */

export interface EntradaTrasladarFondos {
    empresa_id?: number | null
    monto: string
    fecha?: string | null
    referencia: string
    origen: PedidoCuentaBanco
    destino: PedidoCuentaBanco
}

export default class TrasladarFondos extends DomainAction<EntradaTrasladarFondos, TrasladoVista> {
    readonly nombre = 'bancos.trasladar'

    protected async handle(input: EntradaTrasladarFondos, t: Transaccion): Promise<TrasladoVista> {
        const errores: ErrorCampo[] = []
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const referencia = input.referencia?.trim() ?? ''
        if (!referencia) {
            errores.push({ field: 'referencia', message: 'La referencia es obligatoria', rule: 'required' })
        }
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // la empresa: la pedida, la de una de las cuentas propias, o la activa
        const sinEmpresa = await resolverCuentaBanco(t.trx, input.origen, { prefijo: 'origen.' })
        const destinoSinEmpresa = await resolverCuentaBanco(t.trx, input.destino, { prefijo: 'destino.' })
        const empresaId =
            input.empresa_id ??
            sinEmpresa!.empresa_id ??
            destinoSinEmpresa!.empresa_id ??
            (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const origen = (await resolverCuentaBanco(t.trx, input.origen, { prefijo: 'origen.', empresaId }))!
        const destino = (await resolverCuentaBanco(t.trx, input.destino, { prefijo: 'destino.', empresaId }))!
        if (origen.cuenta_id === destino.cuenta_id) {
            throw new ValidacionFallida([
                {
                    field: 'destino.cuenta_id',
                    message: 'El origen y el destino son la misma cuenta',
                    rule: 'distinta',
                },
            ])
        }
        const repetido = await t.trx
            .from('ledger.traslados')
            .where({ empresa_id: empresaId, cuenta_origen_id: origen.cuenta_id, referencia })
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El traslado ${referencia} desde ${origen.codigo} ya está registrado (${repetido.id})`,
                'traslado_duplicado',
                'Traslado duplicado',
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.traslados')
            .insert({
                empresa_id: empresaId,
                cuenta_origen_id: origen.cuenta_id,
                cuenta_destino_id: destino.cuenta_id,
                monto: aTexto(monto),
                fecha,
                referencia,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const trasladoId = Number(fila!.id)
        t.fijarEntidad('traslado', trasladoId)

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Traslado ${trasladoId} de ${origen.nombre} a ${destino.nombre} · ref. ${referencia}`,
                origen_tipo: 'traslado',
                origen_id: trasladoId,
                movimientos: [
                    { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, debe: aTexto(monto) },
                    { cuenta: origen.cuenta_id, haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        return verTraslado(trasladoId, t.trx)
    }
}
