import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'

export interface EntradaAsignarResponsablePago {
    /** cliente dependiente (el titular del servicio de la otra casa) */
    id: number
    /** cliente que paga por él */
    responsable_id: number
    /** queda en `audit.acciones.entrada` */
    motivo?: string
}

interface FilaRelacion {
    id: number
    responsable_pago_id: number | null
}

function invalido(message: string): ValidacionFallida {
    return new ValidacionFallida([{ field: 'responsable_id', message, rule: 'responsable_pago' }])
}

/**
 * Bloquea (FOR UPDATE, en orden de id para no cruzar bloqueos) las filas de los clientes dados.
 * Dos asignaciones concurrentes que compartan un cliente se serializan, así el chequeo de un
 * solo nivel no se salta por carrera.
 */
export async function bloquearRelacion(t: Transaccion, ids: number[]): Promise<Map<number, FilaRelacion>> {
    const filas = (await t.trx
        .from('core.clientes')
        .whereIn('id', ids)
        .orderBy('id')
        .forUpdate()
        .select('id', 'responsable_pago_id')) as FilaRelacion[]
    return new Map(filas.map((f) => [Number(f.id), f]))
}

/** Escribe la columna, sube `version` y deja el diff del campo en `audit.cambios`. */
export async function fijarResponsable(
    t: Transaccion,
    id: number,
    antes: number | null,
    despues: number | null,
): Promise<ClienteVista> {
    await t.trx
        .from('core.clientes')
        .where('id', id)
        .update({
            responsable_pago_id: despues,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    await t.registrarCambios(
        { tipo: 'cliente', id },
        { responsable_pago_id: antes },
        { responsable_pago_id: despues },
    )
    return verCliente(id, t.trx)
}

/**
 * `clientes.asignar_responsable_pago`: fija quién paga por este cliente. La relación solo sirve
 * para sugerir en el cobro (A4 muestra las facturas de los dependientes debajo del pagador);
 * cualquiera puede pagar cualquier factura sin ella.
 *
 * Reglas (422 en `responsable_id`): no puede ser él mismo, el responsable debe existir y hay un
 * solo nivel: el responsable no puede tener a su vez responsable y este cliente no puede ser
 * responsable de otros. Eso impide ciclos. Asignar el mismo responsable no cambia nada; otro
 * responsable reemplaza al anterior (un cliente tiene como máximo uno).
 */
export default class AsignarResponsablePago extends DomainAction<
    EntradaAsignarResponsablePago,
    ClienteVista
> {
    readonly nombre = 'clientes.asignar_responsable_pago'

    protected async handle(input: EntradaAsignarResponsablePago, t: Transaccion): Promise<ClienteVista> {
        const id = Number(input.id)
        const responsableId = Number(input.responsable_id)
        t.fijarEntidad('cliente', id)
        if (id === responsableId) throw invalido('Un cliente no puede ser su propio responsable de pago')

        const filas = await bloquearRelacion(t, [id, responsableId])
        const cliente = filas.get(id)
        if (!cliente) throw new NoEncontrado(`El cliente ${id} no existe`)
        const responsable = filas.get(responsableId)
        if (!responsable) throw invalido(`El cliente ${responsableId} no existe`)

        const actual = cliente.responsable_pago_id === null ? null : Number(cliente.responsable_pago_id)
        if (actual === responsableId) return verCliente(id, t.trx)

        if (responsable.responsable_pago_id !== null) {
            throw invalido(
                `El cliente ${responsableId} tiene a su vez un responsable de pago; solo se admite un nivel`,
            )
        }
        const dependiente = await t.trx
            .from('core.clientes')
            .where('responsable_pago_id', id)
            .select('id')
            .first()
        if (dependiente) {
            throw invalido(
                `El cliente ${id} es responsable de pago de otros clientes y no puede tener responsable`,
            )
        }

        return fijarResponsable(t, id, actual, responsableId)
    }
}
