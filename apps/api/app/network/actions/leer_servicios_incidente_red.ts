import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import type { Pagina } from '#shared/paginacion'
import { paginaServiciosIncidente } from '#network/incidentes_red'

export interface EntradaLeerServiciosIncidenteRed {
    incidente_id: number
    /** `empresa_id` de la query (opcional) */
    empresa_id?: number
    /** empresas del alcance de quien lee (null = todas) */
    permitidas: number[] | null
    cursor?: string
    limit: number
}

/**
 * `incidentes_red.leer` en `GET /incidentes-red/:id/servicios` (contrato Iris 0.13.0 §3.11, ajuste e):
 * los ids de los servicios afectados de las empresas visibles, por páginas. Iris la llama con su token
 * (sin `X-Iris-Actor`) cuando el evento trae más de 5000 ids; cada lectura queda en `audit.acciones` con
 * el actor de la petición (el token de Iris: actor `token`), también el `404` de un incidente o una
 * empresa fuera del alcance. Solo lectura: no emite eventos.
 */
export default class LeerServiciosIncidenteRed extends DomainAction<
    EntradaLeerServiciosIncidenteRed,
    Pagina<number>
> {
    readonly nombre = 'incidentes_red.leer'

    protected async handle(input: EntradaLeerServiciosIncidenteRed, t: Transaccion): Promise<Pagina<number>> {
        t.fijarEntidad('incidente_red', input.incidente_id)
        let empresas = input.permitidas
        if (input.empresa_id !== undefined) {
            if (empresas !== null && !empresas.includes(input.empresa_id)) {
                throw new NoEncontrado('El incidente no existe')
            }
            empresas = [input.empresa_id]
            t.fijarEmpresa(input.empresa_id)
        }
        return paginaServiciosIncidente(
            input.incidente_id,
            { empresas, cursor: input.cursor, limit: input.limit },
            t.trx,
        )
    }
}
