import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verBodega, type BodegaVista } from '#inventario/bodegas'
import { LOCK_PRODUCTO } from '#inventario/kardex'

/**
 * `bodegas.desactivar` (`POST /bodegas/:id/desactivar`): la bodega deja de recibir; no se borra.
 * Solo sin existencias (409 `bodega_con_existencias`) y con `version`. Ya inactiva: 409
 * `bodega_inactiva`.
 */

export interface EntradaDesactivarBodega {
    id: number
    version: number
    motivo?: string | null
}

export default class DesactivarBodega extends DomainAction<EntradaDesactivarBodega, BodegaVista> {
    readonly nombre = 'bodegas.desactivar'

    protected async handle(input: EntradaDesactivarBodega, t: Transaccion): Promise<BodegaVista> {
        t.fijarEntidad('bodega', input.id)
        const actual = (await t.trx
            .from('inventario.bodegas')
            .where('id', input.id)
            .forUpdate()
            .select('id', 'empresa_id', 'nombre', 'activo', 'version')
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            activo: boolean
            version: number
        } | null
        if (!actual) throw new NoEncontrado(`La bodega ${input.id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(actual.empresa_id))
        t.fijarEmpresa(Number(actual.empresa_id))
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('bodega', input.id)
        if (!actual.activo) {
            throw new Conflicto(
                `La bodega ${actual.nombre} ya está desactivada`,
                'bodega_inactiva',
                'Bodega inactiva',
            )
        }
        // los movimientos de sus productos toman el lock del producto: el FOR UPDATE de la bodega no
        // los detiene; se revisa el saldo con los locks de los productos que tiene
        const productos = (await t.trx
            .from('inventario.saldos')
            .where('bodega_id', input.id)
            .orderBy('producto_id')
            .select('producto_id')) as Array<{ producto_id: number }>
        for (const p of productos) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_PRODUCTO, Number(p.producto_id)])
        }
        const existencia = await t.trx
            .from('inventario.saldos')
            .where('bodega_id', input.id)
            .where('cantidad', '>', 0)
            .select('producto_id')
            .first()
        if (existencia) {
            throw new Conflicto(
                `La bodega ${actual.nombre} tiene existencias: trasládalas o dalas de baja antes de desactivarla`,
                'bodega_con_existencias',
                'Bodega con existencias',
            )
        }
        await t.trx
            .from('inventario.bodegas')
            .where('id', input.id)
            .update({
                activo: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'bodega', id: input.id }, { activo: true }, { activo: false })
        return verBodega(input.id, t.trx)
    }
}
