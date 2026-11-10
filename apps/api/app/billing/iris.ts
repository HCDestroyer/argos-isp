import type { HttpContext } from '@adonisjs/core/http'
import { esAsistenteIris, type ContextoAccion } from '#shared/contexto'
import { tieneAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, Problema } from '#shared/errores'
import { ActorRechazado } from '#core/actuacion_vinculada'
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
 * - Aprobar y rechazar comprobantes desde la conversación (contrato Iris 0.7.0 §7.7, A23): con la
 *   actuación vinculada (`ctx.via`, `#core/actuacion_vinculada`) solo se resuelven comprobantes de
 *   una empresa del usuario vinculado (403 `actor_sin_empresa`) y con `canal = iris` (409
 *   `comprobante_no_es_de_iris`). Ver `exigirComprobanteParaIris`.
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

/** ¿La petición llegó por Iris como un operador vinculado (0.7.0, A23)? */
export function esActuacionIris(ctx: Pick<ContextoAccion, 'via'>): boolean {
    return ctx.via?.conector === 'iris'
}

/**
 * Comprobante que un operador de Iris quiere aprobar o rechazar (contrato Iris 0.7.0 §7.7). Sin
 * actuación vinculada no hace nada: el panel sigue igual. La llama `bloquearComprobante` con la
 * fila ya bloqueada (`FOR UPDATE`) y **antes** de mirar su estado, en este orden:
 *
 * 1. 403 `actor_sin_empresa`: la empresa del comprobante no está entre las del usuario vinculado ∩
 *    las del token Iris (en vez del `empresa_no_permitida` del panel);
 * 2. 409 `comprobante_no_es_de_iris`: el comprobante no llegó por Iris (`canal ≠ iris`). Va antes
 *    de `comprobante_revisado` para que Iris no averigüe nada de comprobantes que no son suyos.
 *
 * Después, `bloquearComprobante` sigue con el 409 `comprobante_revisado` de siempre.
 */
export function exigirComprobanteParaIris(
    ctx: ContextoAccion,
    comprobante: { id: number; empresa_id: number; canal: string },
): void {
    if (!esActuacionIris(ctx)) return
    if (!tieneAccesoEmpresa(ctx, comprobante.empresa_id)) {
        throw new ActorRechazado(
            'actor_sin_empresa',
            `El usuario de Argos vinculado no opera la empresa ${comprobante.empresa_id} del comprobante ${comprobante.id}`,
        )
    }
    if (comprobante.canal !== 'iris') {
        throw new Conflicto(
            `El comprobante ${comprobante.id} llegó por ${comprobante.canal}: desde Iris solo se resuelven los que llegaron por Iris`,
            'comprobante_no_es_de_iris',
            'El comprobante no es de Iris',
        )
    }
}

/**
 * Ruta de aprobar o rechazar con la actuación vinculada: la empresa del comprobante fuera del
 * alcance del usuario vinculado es 403 `actor_sin_empresa` (antes del `empresa_no_permitida` de
 * `exigirAcceso`). Con el panel no hace nada.
 */
export function exigirEmpresaActuacion(
    ctx: HttpContext,
    comprobanteId: number,
    empresaId: number | null | undefined,
): void {
    if (!ctx.actuacionVinculada || empresaId === null || empresaId === undefined) return
    const permitidas = ctx.empresa?.permitidas
    if (permitidas && !permitidas.includes(Number(empresaId))) {
        throw new ActorRechazado(
            'actor_sin_empresa',
            `El usuario de Argos vinculado no opera la empresa ${empresaId} del comprobante ${comprobanteId}`,
        )
    }
}
