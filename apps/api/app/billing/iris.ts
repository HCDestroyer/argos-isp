import type { HttpContext } from '@adonisjs/core/http'
import { esAsistenteIris, type ContextoAccion } from '#shared/contexto'
import { Problema } from '#shared/errores'
import type { CanalPromesa } from '#billing/reglas_promesa'

/**
 * Peticiones del usuario técnico Iris a cobros y promesas (contrato Iris 0.6.0 §7.1).
 *
 * Las cabeceras `X-Iris-Actor` y `X-Iris-Conversacion` las valida el núcleo (`cabecerasIris: true`
 * en `definirRuta`, `#integraciones/iris/atencion`): con el token de Iris quedan en `ctx.iris`, el
 * canal de la auditoría es `ia` (`asistente_ia`) o `api` (`usuario:<id>`) y `audit.acciones`
 * guarda `iris_actor` e `iris_conversacion`. Aquí solo lo propio de billing:
 *
 * - el canal de la promesa: `ia` con el asistente, `operador` con una persona de Iris;
 * - `Idempotency-Key` obligatoria en las escrituras de Iris (`POST /promesas` la acepta opcional
 *   para el panel): 400 `idempotency_key_requerida`.
 */

/** Canal de la promesa pedida por Iris, o null si la petición no es de Iris. */
export function canalPromesaIris(
    ctx: Pick<ContextoAccion, 'iris'>,
): Extract<CanalPromesa, 'ia' | 'operador'> | null {
    if (!ctx.iris) return null
    return esAsistenteIris(ctx) ? 'ia' : 'operador'
}

/** Gancho `antes`: con el token de Iris (ya con `ctx.iris`), exige `Idempotency-Key`. */
export async function exigirIdempotenciaIris(ctx: HttpContext): Promise<void> {
    if (ctx.iris && !ctx.request.header('idempotency-key')) {
        throw new Problema(
            400,
            'idempotency_key_requerida',
            'Falta Idempotency-Key',
            'Las escrituras de Iris exigen el header Idempotency-Key',
        )
    }
}
