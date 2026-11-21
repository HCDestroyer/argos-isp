import type { HttpContext } from '@adonisjs/core/http'
import { EMAIL_USUARIO_IRIS } from '#core/alcance_usuario_tecnico'
import { MASCARA } from '#shared/enmascarar'
import { Problema } from '#shared/errores'
import type { OrigenIris } from '#shared/contexto'

/**
 * Piezas del contrato Iris 0.6.0 que aplican a cualquier ruta cuando el actor es el token del
 * usuario técnico Iris (`contratos/iris.md` §1.1, §7.1 y §9.2):
 *
 * - **Cabeceras de atención** (`X-Iris-Actor`, `X-Iris-Conversacion`): obligatorias en las rutas de
 *   §7 (las que declaran `cabecerasIris` en `definirRuta`). Sin ellas o mal formadas:
 *   `400 cabecera_iris_requerida`. Con `cabecerasIris: 'opcional'` (0.8.0) pueden faltar las dos;
 *   si viene alguna, se validan igual. Ya validadas quedan en `ctx.iris`, y de ahí en el
 *   `ContextoAccion` (canal `ia` con `asistente_ia`, `api` con `usuario:<id>`) y en
 *   `audit.acciones` (`iris_actor`, `iris_conversacion`). Otro actor (panel, otro token) no las
 *   necesita y, si las manda, se ignoran.
 * - **Documento oculto**: el usuario técnico Iris nunca recibe `nit_cui` (decisión del PM 3): toda
 *   respuesta JSON de una ruta lo lleva como `"***"` cuando el cliente tiene documento (null sigue
 *   null: sin documento, `metodo: documento` de §7.5 responde `422 metodo_no_disponible`). La
 *   búsqueda `q` tampoco compara contra el documento (si no, buscar probaría el NIT).
 *
 * Se reconoce al usuario técnico por el correo del usuario autenticado con un token `atk_` (guard
 * `tokens`): sin consulta a la base.
 */

export const CABECERA_IRIS_ACTOR = 'X-Iris-Actor'
export const CABECERA_IRIS_CONVERSACION = 'X-Iris-Conversacion'

/** `asistente_ia` o `usuario:<id en Iris>` (hasta 64 caracteres `A-Z a-z 0-9 _ -`). */
export const FORMATO_IRIS_ACTOR = /^(asistente_ia|usuario:[A-Za-z0-9_-]{1,64})$/
/** Id de la conversación en Iris: hasta 128 caracteres `A-Z a-z 0-9 . _ : -`. */
export const FORMATO_IRIS_CONVERSACION = /^[A-Za-z0-9._:-]{1,128}$/

/** Campos que el usuario técnico Iris recibe como `***`. */
const CAMPOS_OCULTOS_IRIS = new Set(['nit_cui'])

/** ¿La petición la hace el usuario técnico Iris con su token `atk_`? */
export function esTokenIris(ctx: HttpContext): boolean {
    if (!('auth' in ctx)) return false
    const usuario = ctx.auth.user as { email?: string } | undefined
    if (!usuario?.email) return false
    return ctx.auth.authenticatedViaGuard === 'tokens' && usuario.email.toLowerCase() === EMAIL_USUARIO_IRIS
}

export class CabeceraIrisRequerida extends Problema {
    constructor(detalle: string) {
        super(400, 'cabecera_iris_requerida', 'Faltan las cabeceras de Iris', detalle)
    }
}

/** Valida las dos cabeceras (sin mirar el actor). */
export function leerCabecerasIris(actor: string | undefined, conversacion: string | undefined): OrigenIris {
    const a = actor?.trim()
    const c = conversacion?.trim()
    if (!a || !FORMATO_IRIS_ACTOR.test(a)) {
        throw new CabeceraIrisRequerida(
            `${CABECERA_IRIS_ACTOR} es obligatoria: \`asistente_ia\` o \`usuario:<id en Iris>\` (id de hasta 64 caracteres A-Z a-z 0-9 _ -)`,
        )
    }
    if (!c || !FORMATO_IRIS_CONVERSACION.test(c)) {
        throw new CabeceraIrisRequerida(
            `${CABECERA_IRIS_CONVERSACION} es obligatoria: id de la conversación (hasta 128 caracteres A-Z a-z 0-9 . _ : -)`,
        )
    }
    return { actor: a, conversacion: c }
}

/**
 * Exige las cabeceras de atención si el actor es el token de Iris y las deja en `ctx.iris`. Con otro
 * actor no hace nada (null). La llama `despachar` en las rutas con `cabecerasIris`; un handler
 * puede llamarla cuando solo una variante de la ruta es de §7 (`GET /clientes?telefono=`).
 *
 * `opcional` (rutas con `cabecerasIris: 'opcional'`, contrato Iris 0.8.0: lecturas que Iris también
 * hace sin conversación, como la primera sincronización): si no viene **ninguna** de las dos,
 * responde null sin error; si viene alguna, las dos se validan igual (400 `cabecera_iris_requerida`).
 */
export function exigirCabecerasIris(
    ctx: HttpContext,
    opciones: { opcional?: boolean } = {},
): OrigenIris | null {
    if (!esTokenIris(ctx)) return null
    if (ctx.iris) return ctx.iris
    if (
        opciones.opcional &&
        ctx.request.header(CABECERA_IRIS_ACTOR) === undefined &&
        ctx.request.header(CABECERA_IRIS_CONVERSACION) === undefined
    ) {
        return null
    }
    const origen = leerCabecerasIris(
        ctx.request.header(CABECERA_IRIS_ACTOR),
        ctx.request.header(CABECERA_IRIS_CONVERSACION),
    )
    ctx.iris = origen
    return origen
}

export class ActorIaNoPermitido extends Problema {
    constructor() {
        super(
            403,
            'actor_ia_no_permitido',
            'El asistente de IA no puede hacer esto',
            'Esta operación la pide una persona de Iris (`X-Iris-Actor: usuario:<id>`), nunca el asistente de IA',
        )
    }
}

/**
 * Contrato Iris 0.10.0 (§3.4 y §3.5): rutas que exigen solo `X-Iris-Actor` (contactos, identidad,
 * titular, plan y datos de la instalación). Con el token de Iris: `X-Iris-Actor` obligatoria y bien
 * formada (`400 cabecera_iris_requerida`); `X-Iris-Conversacion` opcional, validada si viene. Las
 * deja en `ctx.iris` (auditoría y canal). Con `sinAsistente`, `asistente_ia` responde
 * `403 actor_ia_no_permitido`. Otro actor (panel, otro token): null, sin exigir nada.
 */
export function exigirActorIris(
    ctx: HttpContext,
    opciones: { sinAsistente?: boolean } = {},
): OrigenIris | null {
    if (!esTokenIris(ctx)) return null
    const origen =
        ctx.iris ??
        (() => {
            const actor = ctx.request.header(CABECERA_IRIS_ACTOR)?.trim()
            if (!actor || !FORMATO_IRIS_ACTOR.test(actor)) {
                throw new CabeceraIrisRequerida(
                    `${CABECERA_IRIS_ACTOR} es obligatoria: \`asistente_ia\` o \`usuario:<id en Iris>\``,
                )
            }
            const conversacion = ctx.request.header(CABECERA_IRIS_CONVERSACION)?.trim()
            if (conversacion !== undefined && !FORMATO_IRIS_CONVERSACION.test(conversacion)) {
                throw new CabeceraIrisRequerida(
                    `${CABECERA_IRIS_CONVERSACION} mal formada (hasta 128 caracteres A-Z a-z 0-9 . _ : -)`,
                )
            }
            return { actor, conversacion: conversacion ?? null }
        })()
    ctx.iris = origen
    if (opciones.sinAsistente && origen.actor === 'asistente_ia') throw new ActorIaNoPermitido()
    return origen
}

/**
 * Copia de `valor` (JSON plano) con `nit_cui` como `***` donde no es null, a cualquier
 * profundidad. Para respuestas y payloads que van al usuario técnico Iris.
 */
export function ocultarDocumentoIris<T>(valor: T): T {
    if (valor === undefined || valor === null) return valor
    const plano: unknown = JSON.parse(JSON.stringify(valor) ?? 'null')
    return recorrer(plano) as T
}

function recorrer(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map(recorrer)
    if (valor !== null && typeof valor === 'object') {
        const salida: Record<string, unknown> = {}
        for (const [clave, interno] of Object.entries(valor)) {
            salida[clave] = CAMPOS_OCULTOS_IRIS.has(clave) && interno !== null ? MASCARA : recorrer(interno)
        }
        return salida
    }
    return valor
}

/** ¿Se puede pasar por `ocultarDocumentoIris`? (no binarios, streams ni texto). */
export function esRespuestaJson(valor: unknown): boolean {
    if (valor === null || typeof valor !== 'object') return false
    if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return false
    if (typeof (valor as { pipe?: unknown }).pipe === 'function') return false
    return true
}
