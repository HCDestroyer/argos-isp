import { randomUUID } from 'node:crypto'

/**
 * Contexto que recibe toda acción de dominio: quién la ejecuta, por qué canal y con qué request id.
 */

export type TipoActor = 'usuario' | 'token' | 'agente' | 'sistema'

export interface Actor {
    tipo: TipoActor
    /** id en `core.usuarios` (tokens y agentes también son usuarios); null para el sistema anónimo */
    id: number | null
}

/** Por dónde entró la acción. */
export const CANALES = [
    'panel',
    'portal',
    'api',
    'ia',
    'cron',
    'worker',
    'webhook',
    'interno',
    'consola',
] as const
export type Canal = (typeof CANALES)[number]

export interface ContextoAccion {
    actor: Actor
    canal: Canal
    requestId: string
}

/** Contexto para crons, workers y consola. */
export function contextoSistema(canal: Canal = 'worker', requestId: string = randomUUID()): ContextoAccion {
    return { actor: { tipo: 'sistema', id: null }, canal, requestId }
}

export function esCanal(valor: unknown): valor is Canal {
    return typeof valor === 'string' && (CANALES as readonly string[]).includes(valor)
}
