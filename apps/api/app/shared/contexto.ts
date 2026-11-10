import { randomUUID } from 'node:crypto'

/**
 * Contexto que recibe toda acción de dominio: quién la ejecuta, por qué canal y con qué request id.
 */

/**
 * - `usuario`, `token`, `agente`: `id` en `core.usuarios` (tokens y agentes también son usuarios).
 * - `sistema`: `id` null (crons, workers, consola, peticiones anónimas).
 * - `cliente` (semana 3): el cliente autenticado en el portal; `id` en **`core.clientes`**.
 */
export const TIPOS_ACTOR = ['usuario', 'token', 'agente', 'sistema', 'cliente'] as const
export type TipoActor = (typeof TIPOS_ACTOR)[number]

export interface Actor {
    tipo: TipoActor
    /** `core.usuarios.id`, o `core.clientes.id` si `tipo = cliente`; null para el sistema */
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
    /**
     * Empresa activa de la petición (`contratos/multiempresa.md`): la cabecera `X-Empresa-Id` o la
     * única empresa del usuario. null/ausente = sin empresa activa (crons, workers, consola o un
     * usuario con varias empresas que no eligió). Las acciones que la necesitan y no la pueden
     * deducir del servicio responden 422 `empresa_requerida` (`exigirEmpresaActivaDelContexto`).
     */
    empresaId?: number | null
    /**
     * Empresas a las que el actor tiene acceso. null/ausente = todas (alcance global, sistema).
     * Las acciones lo revisan con `exigirAccesoEmpresa` (`#shared/empresa_activa`).
     */
    empresasPermitidas?: number[] | null
    /**
     * Cabeceras del usuario técnico Iris en las rutas de pagos y atención (contrato Iris 0.6.0
     * §7.1): quién habla en Iris (`asistente_ia` | `usuario:<id en Iris>`) y en qué conversación. Se
     * guardan en `audit.acciones` (`iris_actor`, `iris_conversacion`). Con `asistente_ia` el canal
     * es `ia`; con `usuario:<id>`, `api`. Ausente fuera de esas rutas o con otro actor.
     */
    iris?: OrigenIris | null
    /**
     * Actuación vinculada (Iris 0.7.0, A23; `#core/actuacion_vinculada`): `actor` es el usuario de
     * Argos vinculado al operador de Iris y esto es la vía por la que llegó (el token del usuario
     * técnico Iris). Se guarda en `audit.acciones.via_token_id`. Solo lo pone el middleware
     * `actuarComoVinculado` en las rutas que lo declaran; ausente en todo lo demás.
     */
    via?: ViaActuacion | null
}

/** Vía de una actuación vinculada: con qué token y para qué permiso (= acción de nivel superior). */
export interface ViaActuacion {
    conector: 'iris'
    /** `core.tokens_api.id` del token Iris de la petición */
    tokenApiId: number
    /** `core.usuarios.id` del usuario técnico Iris (dueño del token) */
    usuarioTecnicoId: number
    /** única acción de nivel superior que puede correr con esta vía */
    permiso: string
}

/** Actor de Iris de `X-Iris-Actor` y conversación de `X-Iris-Conversacion` (contrato Iris 0.6.0 §7.1). */
export interface OrigenIris {
    /** `asistente_ia` o `usuario:<id en Iris>` */
    actor: string
    /** id de la conversación en Iris */
    conversacion: string
}

/** ¿La acción la pidió el asistente de IA de Iris? (canal de la promesa `ia`; `operador` si no). */
export function esAsistenteIris(ctx: Pick<ContextoAccion, 'iris'>): boolean {
    return ctx.iris?.actor === 'asistente_ia'
}

/** Contexto para crons, workers y consola. */
export function contextoSistema(canal: Canal = 'worker', requestId: string = randomUUID()): ContextoAccion {
    return { actor: { tipo: 'sistema', id: null }, canal, requestId }
}

/**
 * Contexto de una acción hecha por un cliente en el portal (sesión ya verificada): actor `cliente`
 * con su `core.clientes.id`, canal `portal` por defecto.
 */
export function contextoCliente(
    clienteId: number,
    requestId: string = randomUUID(),
    canal: Canal = 'portal',
): ContextoAccion {
    return { actor: { tipo: 'cliente', id: clienteId }, canal, requestId }
}

/**
 * Id de `core.usuarios` del actor, o null si el actor no es un usuario (sistema o cliente). Usar
 * en columnas `*_por` / `created_by` que apuntan a usuarios: con actor `cliente`, `actor.id` es un
 * id de cliente y no debe guardarse ahí.
 */
export function usuarioDelActor(actor: Actor): number | null {
    return actor.tipo === 'usuario' || actor.tipo === 'token' || actor.tipo === 'agente' ? actor.id : null
}

export function esCanal(valor: unknown): valor is Canal {
    return typeof valor === 'string' && (CANALES as readonly string[]).includes(valor)
}
