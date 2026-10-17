import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { periodoCerrado } from '#ledger/cierres'

/**
 * Piezas comunes de las acciones del importador (A6): `RegistrarSaldoInicial`,
 * `AnularSaldoInicial`, `RegistrarPagoHistorico` e `ImportarFacturaPendiente`.
 * Contrato en `.claude/integration/contratos/importacion.md`.
 */

/**
 * Id del registro en el sistema de origen. El contrato lo llama `id_externo`; `clave_externa`
 * (nombre anterior, ya usado por el importador) se acepta igual. Con los dos distintos → 422.
 */
export function idExterno(input: { id_externo?: string | null; clave_externa?: string | null }): string {
    const id = input.id_externo?.trim()
    const clave = input.clave_externa?.trim()
    if (id && clave && id !== clave) {
        throw new ValidacionFallida([
            { field: 'id_externo', message: 'id_externo y clave_externa no coinciden', rule: 'id_externo' },
        ])
    }
    const valor = id || clave
    if (!valor) {
        throw new ValidacionFallida([{ field: 'id_externo', message: 'Obligatorio', rule: 'required' }])
    }
    return valor
}

/** Formato de `origen` (igual que `core.ids_externos.sistema`). */
export const PATRON_ORIGEN = /^[a-z0-9_]{1,40}$/

export interface ClaveImportacion {
    /** sistema de origen (`mikrowisp`, `smartisp`, `csv`…) */
    origen: string
    /** id del registro en ese origen (opaco; único por origen) */
    id_externo: string
}

/**
 * Origen e id del registro importado. El id es único **por origen**: dos sistemas pueden tener
 * la misma factura 123. `origen` es texto libre en minúsculas (`^[a-z0-9_]{1,40}$`); se normaliza
 * con `trim` y minúsculas.
 *
 * Transición: sin `origen`, se toma el prefijo del id antes de `:` (`mikrowisp:pago:1` →
 * `mikrowisp`, como lo que ya se importó) y, si no tiene prefijo válido, `externo`. El id se
 * guarda siempre tal cual llega: quien importa no debe cambiar el formato de sus ids entre corridas.
 */
export function claveImportacion(input: {
    origen?: string | null
    id_externo?: string | null
    clave_externa?: string | null
}): ClaveImportacion {
    const id = idExterno(input)
    const dado = input.origen?.trim().toLowerCase()
    if (dado !== undefined && dado !== '') {
        if (!PATRON_ORIGEN.test(dado)) {
            throw new ValidacionFallida([
                {
                    field: 'origen',
                    message: 'Origen inválido: minúsculas, números y _ (máximo 40), p. ej. smartisp',
                    rule: 'origen',
                },
            ])
        }
        return { origen: dado, id_externo: id }
    }
    const prefijo = id.includes(':') ? id.slice(0, id.indexOf(':')) : ''
    return { origen: PATRON_ORIGEN.test(prefijo) ? prefijo : 'externo', id_externo: id }
}

/** `origen:id` para mensajes. */
export function textoClave(clave: ClaveImportacion): string {
    return clave.id_externo.startsWith(`${clave.origen}:`)
        ? clave.id_externo
        : `${clave.origen}:${clave.id_externo}`
}

/**
 * 422 `periodo_cerrado` con un mensaje para quien importa: qué registro, qué fecha y qué hacer.
 * Se comprueba antes de escribir nada (el trigger del libro lo rechazaría igual, con un mensaje
 * menos claro).
 */
export async function exigirPeriodoAbierto(
    cliente: QueryClientContract,
    fecha: string,
    que: string,
    empresaId: number,
): Promise<void> {
    if (await periodoCerrado(cliente, fecha, empresaId)) {
        throw new ReglaNegocio(
            `${que}: la fecha ${fecha} cae en el periodo ${fecha.slice(0, 7)}, que está cerrado en el libro. ` +
                'Use una fecha de un periodo abierto o pida a contabilidad reabrir ese mes ' +
                '(POST /libro/periodos/reabrir) y vuelva a cerrarlo al terminar la importación.',
            'periodo_cerrado',
        )
    }
}
