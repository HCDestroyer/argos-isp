import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { LIBROS_HABILITABLES, type LibroHabilitable } from '#fiscal/libros_legales'
import { LOCK_LIBROS, verHabilitacion, type HabilitacionVista } from '#fiscal/libros_emisiones'

/**
 * `libros.habilitar` (`POST /libros/habilitaciones`): registra un rango de folios habilitado de un
 * libro legal de la empresa (autorización SAT-7121 y Registro Mercantil; contrato §3.7). Solo
 * inserción: una habilitación no se edita ni se borra.
 *
 * - Rangos correlativos por (empresa, libro): el primero empieza donde diga la autorización; cada
 *   uno nuevo, en el folio siguiente al último habilitado (422 `habilitacion_no_correlativa`; el
 *   trigger lo repite). Así los folios del libro nunca saltan ni se repiten.
 * - `fecha` (de la autorización) no puede ser futura.
 * - Sin evento: no cambia el estado de ningún documento; queda en `audit.acciones`.
 */

export interface EntradaHabilitarLibro {
    empresa_id?: number | null
    libro: LibroHabilitable
    autorizacion: string
    folio_desde: number
    folio_hasta: number
    fecha: string
    nota?: string | null
}

export default class HabilitarLibro extends DomainAction<EntradaHabilitarLibro, HabilitacionVista> {
    readonly nombre = 'libros.habilitar'

    protected async handle(input: EntradaHabilitarLibro, t: Transaccion): Promise<HabilitacionVista> {
        const errores: ErrorCampo[] = []
        if (!(LIBROS_HABILITABLES as readonly string[]).includes(input.libro)) {
            errores.push({ field: 'libro', message: 'Libro desconocido', rule: 'enum' })
        }
        const autorizacion = input.autorizacion?.trim() ?? ''
        if (autorizacion.length < 3) {
            errores.push({ field: 'autorizacion', message: 'Número de la autorización', rule: 'required' })
        }
        if (!Number.isInteger(input.folio_desde) || input.folio_desde < 1) {
            errores.push({ field: 'folio_desde', message: 'Folio inicial positivo', rule: 'min' })
        }
        if (!Number.isInteger(input.folio_hasta) || input.folio_hasta < input.folio_desde) {
            errores.push({
                field: 'folio_hasta',
                message: 'Debe ser igual o mayor que folio_desde',
                rule: 'rango',
            })
        }
        const fecha = fechaValida(input.fecha, 'fecha')
        if (fecha > hoyGuatemala()) {
            errores.push({
                field: 'fecha',
                message: 'La fecha de la autorización no puede ser futura',
                rule: 'fecha',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_LIBROS, empresaId])

        const previo = (await t.trx
            .from('fiscal.libros_habilitados')
            .where({ empresa_id: empresaId, libro: input.libro })
            .max('folio_hasta as ultimo')
            .first()) as { ultimo: number | null } | null
        const ultimo = previo?.ultimo === null || previo?.ultimo === undefined ? null : Number(previo.ultimo)
        if (ultimo !== null && input.folio_desde !== ultimo + 1) {
            throw new Problema(
                422,
                'habilitacion_no_correlativa',
                'Habilitación no correlativa',
                `El último folio habilitado del libro ${input.libro} es ${ultimo}: la habilitación nueva empieza en ${ultimo + 1}`,
                [
                    {
                        field: 'folio_desde',
                        message: `Debe ser ${ultimo + 1}`,
                        rule: 'habilitacion_no_correlativa',
                    },
                ],
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.libros_habilitados')
            .insert({
                empresa_id: empresaId,
                libro: input.libro,
                tipo: 'computarizado',
                autorizacion,
                folio_desde: input.folio_desde,
                folio_hasta: input.folio_hasta,
                fecha,
                nota: input.nota?.trim() || null,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('libro_habilitacion', id)
        return verHabilitacion(id, t.trx)
    }
}
