import type { Schema } from '@argosisp/contracts'

export type TareaProgramada = Schema<'TareaProgramada'>
export type CorridaCron = Schema<'CorridaCron'>
export type TareasProgramadas = Schema<'TareasProgramadas'>

/**
 * Tareas programadas (crons) del sistema (A6, `app/monitoreo/crons` de la API): estado de cada una,
 * su historial de corridas y «Ejecutar ahora». Ver necesita `sistema.ver_crons`; ejecutar,
 * `sistema.ejecutar_cron` y los permisos propios de la tarea (`permisos`).
 */
export function useTareasProgramadas() {
    const api = useApi()

    /** `GET /sistema/crons`: todas las tareas con su última y próxima corrida. */
    function listar(): Promise<Resultado<TareasProgramadas>> {
        return resolver(api.GET('/api/v1/sistema/crons'))
    }

    /** `GET /sistema/crons/:clave/corridas`, de la más nueva a la más vieja. */
    function corridas(clave: string, cursor?: string): Promise<Resultado<Pagina<CorridaCron>>> {
        return resolver(api.GET('/api/v1/sistema/crons/{clave}/corridas', {
            params: { path: { clave }, query: { limit: 20, ...(cursor ? { cursor } : {}) } },
        }))
    }

    /** `POST /sistema/crons/:clave/ejecutar`: 202 encolada; 409 `en_curso` si ya corre. */
    function ejecutar(clave: string, claveIdempotencia: string): Promise<Resultado<Schema<'EjecucionCron'>>> {
        return resolver(api.POST('/api/v1/sistema/crons/{clave}/ejecutar', {
            params: { path: { clave }, header: { 'Idempotency-Key': claveIdempotencia } },
        }))
    }

    return { listar, corridas, ejecutar }
}
