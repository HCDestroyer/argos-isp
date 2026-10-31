import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import type { Seguimiento } from '#inventario/productos'
import {
    problemaModalidad,
    verTipoProducto,
    type Modalidad,
    type TipoProductoVista,
} from '#inventario/tipos_producto'

/**
 * `tipos_producto.crear` (`POST /inventario/tipos-producto`, fase D, `contratos/inventario.md` D.2): un
 * tipo de la empresa activa o, con `global: true` (solo con alcance global de empresas, lo revisa la
 * ruta con `alcance_global`), global. El código es único entre los de la empresa y los globales (409
 * `tipo_duplicado`). La modalidad por defecto va con el seguimiento por defecto (422
 * `modalidad_defecto`).
 */

export interface EntradaCrearTipoProducto {
    empresa_id?: number | null
    global?: boolean | null
    codigo: string
    nombre: string
    seguimiento_defecto: Seguimiento
    modalidad_defecto: Modalidad
    /** el actor tiene alcance global de empresas (la pone la ruta) */
    alcance_global?: boolean
}

/** 409 `tipo_duplicado` si el código ya existe en la empresa o entre los globales (con lock). */
export async function exigirCodigoTipoLibre(t: Transaccion, empresaId: number | null, codigo: string) {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [3074, codigo])
    const repetido = await t.trx
        .from('inventario.tipos_producto')
        .where('codigo', codigo)
        .if(empresaId !== null, (q) =>
            q.where((w) => w.whereNull('empresa_id').orWhere('empresa_id', empresaId!)),
        )
        .select('id', 'empresa_id')
        .first()
    if (repetido) {
        throw new Conflicto(
            `El código ${codigo} ya es del tipo ${repetido.id}${repetido.empresa_id === null ? ' (global)' : ''}`,
            'tipo_duplicado',
            'Tipo duplicado',
        )
    }
}

export default class CrearTipoProducto extends DomainAction<EntradaCrearTipoProducto, TipoProductoVista> {
    readonly nombre = 'tipos_producto.crear'

    protected async handle(input: EntradaCrearTipoProducto, t: Transaccion): Promise<TipoProductoVista> {
        let empresaId: number | null = null
        if (input.global) {
            if (input.alcance_global === false) {
                throw new Prohibido(
                    'Un tipo de producto global lo crea un usuario con alcance global de empresas',
                )
            }
        } else {
            empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
            exigirAccesoEmpresa(t.ctx, empresaId)
            t.fijarEmpresa(empresaId)
        }
        const codigo = input.codigo.trim().toLowerCase()
        const problema = problemaModalidad(
            input.modalidad_defecto,
            input.seguimiento_defecto,
            'modalidad_defecto',
        )
        if (problema) throw new ValidacionFallida([problema])
        await exigirCodigoTipoLibre(t, empresaId, codigo)
        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.tipos_producto')
            .insert({
                empresa_id: empresaId,
                codigo,
                nombre: input.nombre.trim(),
                seguimiento_defecto: input.seguimiento_defecto,
                modalidad_defecto: input.modalidad_defecto,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('tipo_producto', id)
        const tipo = await verTipoProducto(id, t.trx)
        await t.registrarCambios({ tipo: 'tipo_producto', id }, null, {
            empresa_id: tipo.empresa_id,
            codigo: tipo.codigo,
            nombre: tipo.nombre,
            seguimiento_defecto: tipo.seguimiento_defecto,
            modalidad_defecto: tipo.modalidad_defecto,
            activo: tipo.activo,
        })
        return tipo
    }
}
