// TEMPORAL: reemplazar por Schema<'ReconciliacionEstado'> cuando A1 regenere contracts
//
// `GET /api/v1/routers/:id/reconciliaciones/:job_id` (`routers.reconciliar`) aún no está en
// `packages/contracts` de esta rama. El tipo y la firma del GET se escriben a mano con el contrato
// fijo que dio A1; al integrar, `ReconciliacionEstado` pasa a `Schema<'ReconciliacionEstado'>` y
// `ClienteReconciliaciones` desaparece (`useRouters().estadoReconciliacion` llama `api.GET` directo).

/** Estado de un trabajo de «Reconciliar ahora» en la cola del worker. */
export type EstadoReconciliacion = 'en_espera' | 'en_curso' | 'completada' | 'fallida' | 'desconocida'

export interface ReconciliacionEstado {
    router_id: number
    job_id: string
    estado: EstadoReconciliacion
    encolado_en: string | null
    iniciado_en: string | null
    terminado_en: string | null
    /** Comandos aplicados en el router; `null` mientras no termina. */
    cambios: number | null
    /** Operaciones que fallaron en una reconciliación que sí terminó (lo demás se aplicó). */
    errores: { operacion: string, mensaje: string }[]
    /** Por qué falló todo el trabajo (`estado: 'fallida'`). */
    error: string | null
}

/** Ruta del contrato, con la forma de las rutas de openapi-fetch. */
export const RUTA_ESTADO_RECONCILIACION = '/api/v1/routers/{id}/reconciliaciones/{job_id}'

/** Lo que el cliente tipado (openapi-fetch) necesita para este GET, hasta que esté en `paths`. */
export interface ClienteReconciliaciones {
    GET(
        ruta: typeof RUTA_ESTADO_RECONCILIACION,
        opciones: { params: { path: { id: number, job_id: string } } },
    ): Promise<{ data?: ReconciliacionEstado, error?: unknown, response: Response }>
}
