import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirDefinicion, serializarVista, type VistaReporte } from '#billing/reportes/catalogo'

export interface EntradaGuardarVista {
    /** el usuario de la sesión (nunca otro) */
    usuario_id: number
    /** sin id: vista nueva; con id: editar una propia */
    id?: number
    reporte: string
    nombre: string
    filtros: Record<string, unknown>
    columnas?: string[] | null
    version?: number
}

/**
 * `reportes.guardar_vista`: el propio usuario guarda una vista de un reporte (filtros y columnas
 * con nombre). Los filtros se validan con los del reporte (422 en `filtros.<campo>`); `formato` y
 * `empresas` no se guardan (los decide cada consulta). Nombre único por usuario y reporte (409
 * `vista_repetida`). Preferencia propia: sin permiso propio del ACL; la ruta pide `reportes.ver`.
 */
export default class GuardarVistaReporte extends DomainAction<EntradaGuardarVista, VistaReporte> {
    readonly nombre = 'reportes.guardar_vista'

    protected async handle(input: EntradaGuardarVista, t: Transaccion): Promise<VistaReporte> {
        const def = exigirDefinicion(input.reporte)
        const filtros = await def.validar(input.filtros)
        t.fijarEmpresa(null)
        const repetida = (await t.trx
            .from('billing.reportes_vistas')
            .where({ usuario_id: input.usuario_id, reporte: input.reporte })
            .whereRaw('lower(btrim(nombre)) = lower(btrim(?))', [input.nombre])
            .if(input.id, (q) => q.whereNot('id', input.id!))
            .select('id')
            .first()) as { id: number } | null
        if (repetida) {
            throw new Conflicto(`Ya tiene una vista «${input.nombre}» en este reporte`, 'vista_repetida')
        }

        let id: number
        if (input.id) {
            const antes = (await t.trx
                .from('billing.reportes_vistas')
                .where({ id: input.id, usuario_id: input.usuario_id })
                .forUpdate()
                .first()) as Record<string, unknown> | null
            if (!antes) throw new NoEncontrado(`La vista ${input.id} no existe`)
            if (input.version !== undefined && Number(antes.version) !== input.version) {
                throw new ConflictoVersion('vista_reporte', input.id)
            }
            await t.trx
                .from('billing.reportes_vistas')
                .where('id', input.id)
                .update({
                    reporte: input.reporte,
                    nombre: input.nombre,
                    filtros: JSON.stringify(filtros),
                    columnas: input.columnas ?? null,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            id = input.id
        } else {
            const [fila] = (await t.trx
                .table('billing.reportes_vistas')
                .insert({
                    usuario_id: input.usuario_id,
                    reporte: input.reporte,
                    nombre: input.nombre,
                    filtros: JSON.stringify(filtros),
                    columnas: input.columnas ?? null,
                })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        }
        t.fijarEntidad('vista_reporte', id)
        await t.emit('reportes.preferencias_cambiadas', {
            usuario_id: input.usuario_id,
            tipo: 'vista',
            accion: 'guardada',
            reporte: input.reporte,
            vista_id: id,
        })
        return serializarVista(
            (await t.trx.from('billing.reportes_vistas').where('id', id).first()) as Record<string, unknown>,
        )
    }
}
