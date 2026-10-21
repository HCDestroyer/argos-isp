import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { BloqueoCorrida } from '#billing/bloqueos_corrida'

/**
 * Deja en `audit.acciones` el resumen de una corrida de un proceso por lotes (`generarFacturas`,
 * `vencerFacturas`, corte). Cada factura o servicio procesado ya tiene su propia acción
 * auditada; esta fila registra quién disparó la corrida, con qué parámetros y qué resultó.
 *
 * Con `bloqueos` (documentos que no se contabilizaron por un bloqueo del libro, fase 6) emite, en
 * la misma transacción, un `libro.proceso_bloqueado` por empresa y tipo para avisar al equipo.
 */
export interface EntradaCorrida {
    parametros: Record<string, unknown>
    resultado: Record<string, unknown>
    bloqueos?: BloqueoCorrida[]
}

export default class RegistrarCorrida extends DomainAction<EntradaCorrida, void> {
    constructor(readonly nombre: string) {
        super()
    }

    protected async handle(input: EntradaCorrida, t: Transaccion): Promise<void> {
        for (const b of input.bloqueos ?? []) {
            await t.emit('libro.proceso_bloqueado', {
                empresa_id: b.empresa_id,
                proceso: this.nombre,
                tipo: b.tipo,
                hasta: b.hasta,
                fecha: b.fecha,
                documentos: b.documentos,
                ejemplos: b.ejemplos,
            })
        }
    }
}
