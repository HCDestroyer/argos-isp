import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { verProveedorCobro, type ProveedorCobroVista } from '#ledger/cobros_liquidar'

/**
 * `cobros.editar_proveedor` (`PUT /cobros/proveedores/:id`, permiso `cobros.configurar`): nombre,
 * cuenta de liquidación, fecha de corte y `activo`, con `version` (409 si cambió) y `audit.cambios`.
 *
 * Decisión del líder (desvío a, §18): el proveedor se activa por empresa, nunca automático. Mientras
 * no tiene pagos, `desde` (hoy o futura) y `activo` se cambian libremente; **con pagos**, cambiar
 * `desde` o desactivarlo responde 409 `proveedor_con_pagos` (movería pagos de un lado al otro del
 * corte o dejaría su puente sin dueño). El método y el código no se editan.
 */

export interface EntradaEditarProveedorCobro extends PedidoCuentaBanco {
    id: number
    version: number
    nombre?: string | null
    activo?: boolean | null
    desde?: string | null
}

export default class EditarProveedorCobro extends DomainAction<
    EntradaEditarProveedorCobro,
    ProveedorCobroVista
> {
    readonly nombre = 'cobros.editar_proveedor'

    protected async handle(input: EntradaEditarProveedorCobro, t: Transaccion): Promise<ProveedorCobroVista> {
        t.fijarEntidad('proveedor_cobro', input.id)
        const actual = (await t.trx
            .from('ledger.proveedores_cobro')
            .where('id', input.id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'nombre',
                'cuenta_liquidacion_id',
                'activo',
                'version',
                t.trx.raw(`to_char(desde, 'YYYY-MM-DD') as desde`),
            )
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            cuenta_liquidacion_id: number
            activo: boolean
            version: number
            desde: string
        } | null
        if (!actual) throw new NoEncontrado(`El proveedor de cobro ${input.id} no existe`)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('proveedor_cobro', input.id)

        const desde = input.desde ? fechaValida(input.desde, 'desde') : actual.desde
        const activo = input.activo ?? actual.activo
        if (desde !== actual.desde || (actual.activo && !activo)) {
            const conPagos = await t.trx
                .from('billing.pagos')
                .where('proveedor_cobro_id', actual.id)
                .select('id')
                .first()
            if (conPagos) {
                throw new Conflicto(
                    `El proveedor ${actual.id} ya tiene pagos en su cuenta puente: su fecha de corte y su activación no cambian`,
                    'proveedor_con_pagos',
                    'Proveedor con pagos',
                )
            }
            if (desde !== actual.desde && desde < hoyGuatemala()) {
                throw new ValidacionFallida([
                    {
                        field: 'desde',
                        message: 'La fecha de corte no puede ser anterior a hoy',
                        rule: 'pasado',
                    },
                ])
            }
        }
        const nuevo = {
            nombre: input.nombre?.trim() || actual.nombre,
            cuenta_liquidacion_id: Number(actual.cuenta_liquidacion_id),
            activo,
            desde,
        }
        if (nuevo.nombre.length < 2) {
            throw new ValidacionFallida([
                { field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' },
            ])
        }
        const banco = await resolverCuentaBanco(t.trx, input, { empresaId, obligatoria: false })
        if (banco) nuevo.cuenta_liquidacion_id = banco.cuenta_id

        const antes = {
            nombre: actual.nombre,
            cuenta_liquidacion_id: Number(actual.cuenta_liquidacion_id),
            activo: actual.activo,
            desde: actual.desde,
        }
        await t.trx
            .from('ledger.proveedores_cobro')
            .where('id', input.id)
            .update({
                ...nuevo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'proveedor_cobro', id: input.id }, antes, nuevo)
        return verProveedorCobro(input.id, t.trx)
    }
}
