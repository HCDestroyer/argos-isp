import type { HttpContext } from '@adonisjs/core/http'
import { EMAIL_USUARIO_IRIS } from '#core/alcance_usuario_tecnico'
import type { Canal } from '#shared/contexto'
import { Problema } from '#shared/errores'
import type { CanalPromesa } from '#billing/reglas_promesa'

/**
 * Peticiones del usuario técnico Iris a cobros y promesas (contrato Iris 0.6.0 §7.1).
 *
 * - `X-Iris-Actor` = `asistente_ia` | `usuario:<id>` (id de hasta 64 `A-Z a-z 0-9 _ -`) y
 *   `X-Iris-Conversacion` (hasta 128 `A-Z a-z 0-9 . _ : -`) son obligatorias para el usuario Iris
 *   en las rutas de §7: sin ellas o mal formadas, 400 `cabecera_iris_requerida`. Las demás
 *   peticiones (panel, otros tokens) las ignoran.
 * - Canal de la auditoría: `ia` con `asistente_ia`, `api` con `usuario:<id>`. Canal de la promesa:
 *   `ia` u `operador` (cada uno con sus límites en la plantilla).
 * - `Idempotency-Key` obligatoria en las escrituras de §7 (400 `idempotency_key_requerida`).
 * - Las dos cabeceras viajan en la entrada de la acción (`iris.actor`, `iris.conversacion`), así
 *   quedan en `audit.acciones.entrada` y se pueden buscar (`entrada->'iris'->>'conversacion'`).
 */

const ACTOR = /^(asistente_ia|usuario:[A-Za-z0-9_-]{1,64})$/
const CONVERSACION = /^[A-Za-z0-9._:-]{1,128}$/

/** Lo que Argos guarda de las cabeceras de Iris. */
export interface CabecerasIris {
    actor: string
    conversacion: string
}

export interface PeticionIris extends CabecerasIris {
    canalPromesa: Extract<CanalPromesa, 'ia' | 'operador'>
    canalAuditoria: Extract<Canal, 'ia' | 'api'>
}

/** ¿La petición la hace el usuario técnico Iris? (por su correo, igual que el núcleo). */
export function esUsuarioIris(ctx: HttpContext): boolean {
    const usuario = 'auth' in ctx ? ctx.auth.user : undefined
    const email = (usuario as { email?: string } | undefined)?.email
    return typeof email === 'string' && email.toLowerCase() === EMAIL_USUARIO_IRIS
}

/** Valida las cabeceras de una petición de Iris (400 si faltan o están mal formadas). */
export function leerCabecerasIris(actor: unknown, conversacion: unknown): PeticionIris {
    const errores = []
    if (typeof actor !== 'string' || !ACTOR.test(actor)) {
        errores.push({
            field: 'X-Iris-Actor',
            message: 'Debe ser asistente_ia o usuario:<id> (id de 1 a 64 caracteres A-Z a-z 0-9 _ -)',
            rule: 'cabecera_iris',
        })
    }
    if (typeof conversacion !== 'string' || !CONVERSACION.test(conversacion)) {
        errores.push({
            field: 'X-Iris-Conversacion',
            message: 'Debe ser el id de la conversación (1 a 128 caracteres A-Z a-z 0-9 . _ : -)',
            rule: 'cabecera_iris',
        })
    }
    if (errores.length > 0) {
        throw new Problema(
            400,
            'cabecera_iris_requerida',
            'Faltan las cabeceras de Iris',
            'Las peticiones de Iris a pagos y promesas llevan X-Iris-Actor y X-Iris-Conversacion',
            errores,
        )
    }
    const ia = actor === 'asistente_ia'
    return {
        actor: actor as string,
        conversacion: conversacion as string,
        canalPromesa: ia ? 'ia' : 'operador',
        canalAuditoria: ia ? 'ia' : 'api',
    }
}

/**
 * Peticiones de Iris: las cabeceras validadas (400 si faltan); null si no es el usuario Iris.
 * Con `idempotencia`, además exige `Idempotency-Key` (400 `idempotency_key_requerida`).
 */
export function peticionIris(
    ctx: HttpContext,
    opciones: { idempotencia?: boolean } = {},
): PeticionIris | null {
    if (!esUsuarioIris(ctx)) return null
    const peticion = leerCabecerasIris(
        ctx.request.header('x-iris-actor'),
        ctx.request.header('x-iris-conversacion'),
    )
    if (opciones.idempotencia && !ctx.request.header('idempotency-key')) {
        throw new Problema(
            400,
            'idempotency_key_requerida',
            'Falta Idempotency-Key',
            'Las escrituras de Iris exigen el header Idempotency-Key',
        )
    }
    return peticion
}

/** Gancho `antes` de las rutas de §7: valida las cabeceras de Iris antes de validar el cuerpo. */
export function exigirCabecerasIris(opciones: { idempotencia?: boolean } = {}) {
    return async (ctx: HttpContext) => {
        peticionIris(ctx, opciones)
    }
}
