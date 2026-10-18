import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { verProveedorCobro, type ProveedorCobroVista } from '#ledger/cobros_liquidar'

/**
 * `cobros.editar_proveedor` (`PUT /cobros/proveedores/:id`, permiso `cobros.configurar`): nombre,
 * cuenta de liquidación y `activo`, con `version` (409 si cambió) y `audit.cambios`.
 *
 * La fecha de corte, el método y el código no se editan (422 `campo_solo_lectura`): cambiarlos
 * movería pagos ya registrados de un lado al otro del corte. Desactivado, sus pagos nuevos vuelven
 * al banco; los pendientes se siguen liquidando.
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
            .select('id', 'empresa_id', 'nombre', 'cuenta_liquidacion_id', 'activo', 'version')
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            cuenta_liquidacion_id: number
            activo: boolean
            version: number
        } | null
        if (!actual) throw new NoEncontrado(`El proveedor de cobro ${input.id} no existe`)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (input.desde !== undefined && input.desde !== null) {
            throw new ValidacionFallida([
                {
                    field: 'desde',
                    message: 'La fecha de corte no se edita: crea otro proveedor si cambia',
                    rule: 'campo_solo_lectura',
                },
            ])
        }
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('proveedor_cobro', input.id)

        const nuevo = {
            nombre: input.nombre?.trim() || actual.nombre,
            cuenta_liquidacion_id: Number(actual.cuenta_liquidacion_id),
            activo: input.activo ?? actual.activo,
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
