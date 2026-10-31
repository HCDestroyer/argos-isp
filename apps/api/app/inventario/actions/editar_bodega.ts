import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirBodegaNoTransito, verBodega, type BodegaVista, type TipoBodega } from '#inventario/bodegas'
import { validarDatosBodega, type DatosBodega } from '#inventario/actions/crear_bodega'

/**
 * `bodegas.editar` (`POST /bodegas/:id/editar`): nombre, usuario (bodega de técnico), zona y router,
 * con `version` (409 si cambió) y `audit.cambios`. El tipo no se edita. Cambiar el técnico de una
 * bodega con existencias: 409 `bodega_con_existencias` (el técnico responde por lo que lleva; se
 * traslada antes).
 */

export interface EntradaEditarBodega extends DatosBodega {
    id: number
    version: number
}

export default class EditarBodega extends DomainAction<EntradaEditarBodega, BodegaVista> {
    readonly nombre = 'bodegas.editar'

    protected async handle(input: EntradaEditarBodega, t: Transaccion): Promise<BodegaVista> {
        t.fijarEntidad('bodega', input.id)
        const actual = (await t.trx.from('inventario.bodegas').where('id', input.id).forUpdate().first()) as {
            id: number
            empresa_id: number
            nombre: string
            tipo: TipoBodega | 'transito'
            usuario_id: number | null
            zona_id: number | null
            router_id: number | null
            activo: boolean
            version: number
        } | null
        if (!actual) throw new NoEncontrado(`La bodega ${input.id} no existe`)
        exigirBodegaNoTransito(actual)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('bodega', input.id)
        const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
        const antes = {
            nombre: actual.nombre,
            usuario_id: n(actual.usuario_id),
            zona_id: n(actual.zona_id),
            router_id: n(actual.router_id),
        }
        const nuevo = {
            nombre: input.nombre?.trim() || antes.nombre,
            usuario_id:
                actual.tipo === 'bodega'
                    ? (input.usuario_id ?? null)
                    : (input.usuario_id ?? antes.usuario_id),
            zona_id: input.zona_id === undefined ? antes.zona_id : input.zona_id,
            router_id: input.router_id === undefined ? antes.router_id : input.router_id,
        }
        await validarDatosBodega(t, empresaId, { ...nuevo, tipo: actual.tipo as TipoBodega }, input.id)
        if (nuevo.usuario_id !== antes.usuario_id) {
            const existencia = await t.trx
                .from('inventario.saldos')
                .where('bodega_id', input.id)
                .where('cantidad', '>', 0)
                .select('producto_id')
                .first()
            if (existencia) {
                throw new Conflicto(
                    `La bodega ${actual.nombre} tiene existencias: trasládalas antes de cambiar su técnico`,
                    'bodega_con_existencias',
                    'Bodega con existencias',
                )
            }
        }
        await t.trx
            .from('inventario.bodegas')
            .where('id', input.id)
            .update({
                ...nuevo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'bodega', id: input.id }, antes, nuevo)
        return verBodega(input.id, t.trx)
    }
}
