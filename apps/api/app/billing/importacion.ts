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

/**
 * 422 `periodo_cerrado` con un mensaje para quien importa: qué registro, qué fecha y qué hacer.
 * Se comprueba antes de escribir nada (el trigger del libro lo rechazaría igual, con un mensaje
 * menos claro).
 */
export async function exigirPeriodoAbierto(
    cliente: QueryClientContract,
    fecha: string,
    que: string,
): Promise<void> {
    if (await periodoCerrado(cliente, fecha)) {
        throw new ReglaNegocio(
            `${que}: la fecha ${fecha} cae en el periodo ${fecha.slice(0, 7)}, que está cerrado en el libro. ` +
                'Use una fecha de un periodo abierto o pida a contabilidad reabrir ese mes ' +
                '(POST /libro/periodos/reabrir) y vuelva a cerrarlo al terminar la importación.',
            'periodo_cerrado',
        )
    }
}
