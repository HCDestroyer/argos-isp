import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import RegistrarAsiento, {
    type AsientoRegistrado,
    type OrigenAsiento,
} from '#ledger/actions/registrar_asiento'

/**
 * `revertirAsiento`: la única forma de corregir el libro. Crea un asiento espejo (debe ↔ haber,
 * mismas cuentas y clientes, mismo origen) que apunta al original con `reversa_de`.
 *
 * - Un asiento se revierte una sola vez; un reverso no se revierte.
 * - La fecha del reverso es hoy (Guatemala) salvo que se indique; si cae en un periodo cerrado se
 *   rechaza. Un asiento de un mes cerrado se revierte con fecha de un mes abierto.
 */

export interface EntradaReverso {
    asiento_id: number
    motivo: string
    fecha?: string
}

export default class RevertirAsiento extends DomainAction<EntradaReverso, AsientoRegistrado> {
    readonly nombre = 'libro.revertir_asiento'

    protected async handle(input: EntradaReverso, t: Transaccion): Promise<AsientoRegistrado> {
        const original = (await t.trx
            .from('ledger.asientos')
            .where('id', input.asiento_id)
            // Sin FOR UPDATE: el rol de la app no tiene UPDATE sobre el libro. Dos reversos
            // simultáneos los resuelve el índice único `asientos_reversa_unica` (→ 409).
            .select('id', 'origen_tipo', 'origen_id', 'reversa_de', 'descripcion')
            .first()) as {
            id: number
            origen_tipo: OrigenAsiento
            origen_id: number | null
            reversa_de: number | null
            descripcion: string
        } | null
        if (!original) throw new NoEncontrado(`El asiento ${input.asiento_id} no existe`)
        t.fijarEntidad('asiento', original.id)

        if (original.reversa_de !== null) {
            throw new ReglaNegocio(
                `El asiento ${original.id} ya es un reverso (de ${original.reversa_de}); no se revierte`,
                'asiento_es_reverso',
            )
        }
        const yaRevertido = await t.trx.from('ledger.asientos').where('reversa_de', original.id).first()
        if (yaRevertido) {
            throw new ReglaNegocio(
                `El asiento ${original.id} ya fue revertido por el asiento ${yaRevertido.id}`,
                'asiento_revertido',
            )
        }

        const movimientos = (await t.trx
            .from('ledger.movimientos')
            .where('asiento_id', original.id)
            .orderBy('id', 'asc')
            .select('cuenta_id', 'debe', 'haber', 'cliente_id')) as Array<{
            cuenta_id: number
            debe: string
            haber: string
            cliente_id: number | null
        }>

        return new RegistrarAsiento().execute(
            {
                fecha: input.fecha,
                descripcion: `Reverso del asiento ${original.id}: ${input.motivo.trim()}`,
                origen_tipo: original.origen_tipo,
                origen_id: original.origen_id,
                reversa_de: original.id,
                movimientos: movimientos.map((m) => ({
                    cuenta: m.cuenta_id,
                    debe: m.haber,
                    haber: m.debe,
                    cliente_id: m.cliente_id,
                })),
            },
            t.ctx,
            { trx: t.trx },
        )
    }
}
