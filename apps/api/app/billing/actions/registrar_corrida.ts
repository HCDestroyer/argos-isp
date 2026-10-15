import { DomainAction, type Transaccion } from '#shared/domain_action'

/**
 * Deja en `audit.acciones` el resumen de una corrida de un proceso por lotes (`generarFacturas`,
 * `vencerFacturas`, corte). Cada factura o servicio procesado ya tiene su propia acción
 * auditada; esta fila registra quién disparó la corrida, con qué parámetros y qué resultó.
 */
export interface EntradaCorrida {
    parametros: Record<string, unknown>
    resultado: Record<string, unknown>
}

export default class RegistrarCorrida extends DomainAction<EntradaCorrida, void> {
    constructor(readonly nombre: string) {
        super()
    }

    protected async handle(_input: EntradaCorrida, _t: Transaccion): Promise<void> {}
}
