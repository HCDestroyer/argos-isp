import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    LOCK_SUBCUENTAS,
    resolverCuentaBanco,
    siguienteSubcuenta,
    type PedidoCuentaBanco,
} from '#ledger/cuentas_banco'
import {
    codigoProveedor,
    esMetodoPorLiquidar,
    verProveedorCobro,
    type MetodoPorLiquidar,
    type ProveedorCobroVista,
} from '#ledger/cobros_liquidar'

/**
 * `cobros.crear_proveedor` (`POST /cobros/proveedores`, permiso `cobros.configurar`): da de alta
 * una pasarela, agente o débito automático de la empresa (contrato §10.3).
 *
 * - Crea su subcuenta `1.1.10.NN Cobros por liquidar · <nombre>` marcada con la empresa.
 * - `cuenta_liquidacion` (cuenta_bancaria_id, banco_id o cuenta_id): el banco donde el proveedor
 *   deposita el neto de sus liquidaciones (por defecto de `cobros.liquidar`).
 * - `desde` (por defecto hoy; no anterior a hoy): **fecha de corte**. Los pagos de ese proveedor
 *   desde ese día van a su `1.1.10.NN` por el bruto; los anteriores quedaron contra el banco y no
 *   se reescriben (§12.11).
 * - Único por (empresa, método, código): 409 `proveedor_cobro_duplicado`.
 */

export interface EntradaCrearProveedorCobro extends PedidoCuentaBanco {
    empresa_id?: number | null
    metodo: MetodoPorLiquidar
    /** solo pasarela: el nombre del proveedor que trae el pago (`falsa`, `recurrente`) */
    pasarela?: string | null
    nombre: string
    desde?: string | null
}

export default class CrearProveedorCobro extends DomainAction<
    EntradaCrearProveedorCobro,
    ProveedorCobroVista
> {
    readonly nombre = 'cobros.crear_proveedor'

    protected async handle(input: EntradaCrearProveedorCobro, t: Transaccion): Promise<ProveedorCobroVista> {
        const nombre = input.nombre?.trim() ?? ''
        const errores = []
        if (!esMetodoPorLiquidar(input.metodo)) {
            errores.push({
                field: 'metodo',
                message: 'Método inválido (pasarela, agente, debito)',
                rule: 'enum',
            })
        }
        if (nombre.length < 2) {
            errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
        }
        if (input.metodo !== 'pasarela' && input.pasarela) {
            errores.push({ field: 'pasarela', message: 'Solo aplica a pasarelas', rule: 'no_aplica' })
        }
        const hoy = hoyGuatemala()
        const desde = input.desde ? fechaValida(input.desde, 'desde') : hoy
        if (desde < hoy) {
            errores.push({
                field: 'desde',
                message:
                    'La fecha de corte no puede ser anterior a hoy: los pagos ya registrados contra el banco no se reescriben',
                rule: 'pasado',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const codigo = codigoProveedor(input.metodo, input.pasarela)
        const repetido = await t.trx
            .from('ledger.proveedores_cobro')
            .where({ empresa_id: empresaId, metodo: input.metodo, codigo })
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `La empresa ${empresaId} ya tiene el proveedor ${input.metodo} ${codigo} (${repetido.id})`,
                'proveedor_cobro_duplicado',
                'Proveedor de cobro duplicado',
            )
        }
        const banco = (await resolverCuentaBanco(t.trx, input, { empresaId }))!

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [LOCK_SUBCUENTAS])
        const sub = await siguienteSubcuenta(t.trx, CUENTAS_GT.COBROS_POR_LIQUIDAR)
        const [cuenta] = (await t.trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({
                codigo: sub.codigo,
                nombre: `Cobros por liquidar · ${nombre}`,
                tipo: 'activo',
                padre_id: sub.padreId,
                imputable: true,
                auxiliar_cliente: false,
                empresa_id: empresaId,
                categoria_flujo: 'operacion',
            })
            .returning('id')) as Array<{ id: number }>

        const datos = {
            empresa_id: empresaId,
            metodo: input.metodo,
            codigo,
            nombre,
            cuenta_id: cuenta!.id,
            cuenta_liquidacion_id: banco.cuenta_id,
            desde,
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.proveedores_cobro')
            .insert(datos)
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('proveedor_cobro', fila!.id)
        await t.registrarCambios({ tipo: 'proveedor_cobro', id: fila!.id }, null, { ...datos, activo: true })
        return verProveedorCobro(fila!.id, t.trx)
    }
}
