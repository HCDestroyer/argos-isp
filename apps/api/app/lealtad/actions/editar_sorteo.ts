import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import { detalleSorteo, exigirEstado, verSorteo } from '#lealtad/sorteos'
import { criteriosDe, fechaHora, filasPremios, type EntradaSorteo } from '#lealtad/actions/crear_sorteo'

/**
 * `sorteos.editar` (`PUT /lealtad/sorteos/:id`, permiso `sorteos.gestionar`, con `version`): solo en
 * `borrador` (409 `estado_sorteo`). Con `premios` reemplaza la lista entera. `audit.cambios`.
 */

export interface EntradaEditarSorteo extends Omit<EntradaSorteo, 'empresa_id' | 'nombre'> {
    id: number
    version: number
    nombre?: string
}

export default class EditarSorteo extends DomainAction<
    EntradaEditarSorteo,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.editar'

    protected async handle(input: EntradaEditarSorteo, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const actual = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, actual.empresa_id)
        t.fijarEmpresa(actual.empresa_id)
        if (actual.version !== input.version) throw new ConflictoVersion('El sorteo', input.id)
        exigirEstado(actual, ['borrador'], 'edición')
        const o = <T>(nuevo: T | undefined, previo: T): T => (nuevo === undefined ? previo : nuevo)
        const despues = {
            nombre: input.nombre?.trim() || actual.nombre,
            descripcion: o(input.descripcion, actual.descripcion),
            bases: input.bases ?? actual.bases,
            criterios: criteriosDe(input.criterios, actual.criterios),
            inscripcion_desde:
                input.inscripcion_desde === undefined
                    ? actual.inscripcion_desde
                    : input.inscripcion_desde
                      ? fechaValida(input.inscripcion_desde)
                      : null,
            corte_en: input.corte_en === undefined ? actual.corte_en : fechaHora(input.corte_en),
            fecha_sorteo:
                input.fecha_sorteo === undefined ? actual.fecha_sorteo : fechaHora(input.fecha_sorteo),
            lugar: o(input.lugar, actual.lugar),
            suplentes: input.suplentes ?? actual.suplentes,
        }
        if (input.premios) {
            const filas = await filasPremios(t.trx, actual.empresa_id, input.premios)
            await t.trx.from('lealtad.sorteos_premios').where('sorteo_id', actual.id).delete()
            if (filas.length > 0) {
                await t.trx
                    .insertQuery()
                    .table('lealtad.sorteos_premios')
                    .multiInsert(filas.map((p) => ({ ...p, sorteo_id: actual.id })))
            }
        }
        await t.trx
            .from('lealtad.sorteos')
            .where('id', actual.id)
            .update({
                ...despues,
                bases: JSON.stringify(despues.bases),
                criterios: JSON.stringify(despues.criterios),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: actual.id },
            {
                nombre: actual.nombre,
                descripcion: actual.descripcion,
                bases: actual.bases,
                criterios: actual.criterios,
                lugar: actual.lugar,
                suplentes: actual.suplentes,
                premios: actual.premios.length,
            },
            {
                nombre: despues.nombre,
                descripcion: despues.descripcion,
                bases: despues.bases,
                criterios: despues.criterios,
                lugar: despues.lugar,
                suplentes: despues.suplentes,
                premios: input.premios ? input.premios.length : actual.premios.length,
            },
        )
        return detalleSorteo(actual.id, t.trx)
    }
}
