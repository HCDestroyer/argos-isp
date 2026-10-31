import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { EventoEntrante } from '#shared/eventos_bus'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { usuarioIris } from '#core/integraciones_iris'
import { conectorAdmite, destinoWebhooksIris } from '#integraciones/iris/configuracion'
import {
    entregarPendientesDe,
    insertarEnvio,
    type CanalWebhooks,
    type ResultadoEntrega,
} from '#integraciones/webhooks_salientes'

/**
 * Webhooks firmados Argos → Iris (`contratos/iris.md` §1.3 y §2.3, A6). Mismo motor que Horus
 * (`#integraciones/webhooks_salientes`): `X-Webhook-Id`, `X-Webhook-Timestamp`,
 * `X-Webhook-Signature: v1=…` (HMAC-SHA256), cuerpo `{ id, evento, ocurrido_en, payload }` con
 * `id = argos-evt-<id del outbox>` (estable: Iris deduplica) y reintentos a 1 min, 5 min, 30 min,
 * 2 h y 12 h; después `fallido`. Tabla `integraciones.iris_envios`.
 *
 * - **Solo con destino**: `destinoWebhooksIris()` de A1 (conector activo con URL y secreto del
 *   receptor de Iris). Sin él el evento se ignora (Iris refresca al abrir la ficha, §2.2); un
 *   pendiente que encuentra el conector apagado queda `descartado`.
 * - **Alcance**: solo eventos de las empresas del usuario técnico «Iris» (`core.usuarios_empresas`
 *   o alcance global). Sin usuario técnico (nunca se generó su token) o desactivado, no se envía
 *   nada: Iris no podría leer esos datos con su token.
 * - **Sin secretos**: cada payload se arma con una lista cerrada de campos (ids, estados, IPs,
 *   fechas). Nunca `user_ppp`, contraseñas PPPoE, credenciales de adicionales ni tokens.
 * - **Eliminados** (`contratos/eliminar.md`): `servicio.eliminado` y `router.eliminado` se arman
 *   solo con el payload del evento (la fila ya no existe; nunca se busca). Un router sin empresa
 *   sugerida es infraestructura compartida: su `router.eliminado` llega a cualquier conector,
 *   como `GET /routers` se lo muestra a cualquier alcance.
 * - **Catálogos** (`catalogo.cambiado`, contrato 0.5.0, pedido A15): no trae servicio; con
 *   `empresa_id` null (zona o router compartido, o cualquier plan) es compartido y pasa con
 *   cualquier alcance, igual que `router.eliminado`; con empresa, solo si está en el alcance.
 * - **Traslados** (`inventario.traslado_enviado` / `_recibido` / `_cancelado`, contrato 0.5.0 §2.3 y
 *   §3.3): los campos de §2.3 tal cual los emite A3 (`payloadTraslado`), con la empresa de la
 *   orden para el alcance. No salen `numero`, `registrado_por` (usuario interno) ni `faltantes`:
 *   §2.3 no los lista; Iris lee la orden completa con `GET /inventario/traslados/:id`.
 * - **Versión del contrato**: los eventos de `EVENTOS_DESDE_050` solo se registran si el Iris
 *   conectado habla un contrato ≥ 0.5.0 (`conectorAdmite`, A1); a uno anterior (o sin contrato
 *   informado) no le llegan como desconocidos. Un pendiente ya registrado sale igual: el contrato
 *   solo sube.
 */

/** Eventos del bus que van a Iris (§2.3). */
export const EVENTOS_A_IRIS = [
    'cliente.actualizado',
    'servicio.creado',
    'servicio.config_cambiada',
    'asignacion.cambiada',
    'servicio.estado_cambiado',
    'inventario.equipo_por_recuperar',
    'servicio.caidas_repetidas',
    'servicio.eliminado',
    'router.eliminado',
    'servicio.datos_cambiados',
    'catalogo.cambiado',
    'inventario.traslado_enviado',
    'inventario.traslado_recibido',
    'inventario.traslado_cancelado',
] as const

/** Eventos que nacieron con el contrato Iris 0.5.0: solo a conectores con contrato ≥ 0.5.0. */
export const EVENTOS_DESDE_050 = [
    'servicio.datos_cambiados',
    'catalogo.cambiado',
    'inventario.traslado_enviado',
    'inventario.traslado_recibido',
    'inventario.traslado_cancelado',
] as const satisfies ReadonlyArray<(typeof EVENTOS_A_IRIS)[number]>

/** Versión mínima del contrato para `EVENTOS_DESDE_050`. */
export const CONTRATO_EVENTOS_050 = '0.5.0'

/** Catálogos de `catalogo.cambiado` (contrato Iris 0.5.0, pedido A15). */
const CATALOGOS = ['zona', 'plan', 'router'] as const

export const TABLA_ENVIOS_IRIS = 'integraciones.iris_envios'

type Payload = Record<string, unknown>

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

function enteroONulo(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isInteger(n) && n >= 0 ? n : null
}

function textos(valor: unknown): string[] {
    return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : []
}

// ── Alcance del conector ─────────────────────────────────────────────────────────────────────

export interface AlcanceConectorIris {
    global: boolean
    /** empresas activas del usuario técnico (con `global`, todas las activas) */
    empresas: number[]
}

/** Empresas del usuario técnico «Iris»; null si no existe o está desactivado (no se envía nada). */
export async function alcanceConectorIris(): Promise<AlcanceConectorIris | null> {
    const usuarioId = await usuarioIris()
    if (usuarioId === null) return null
    const fila = (await db.from('core.usuarios').where('id', usuarioId).select('activo').first()) as {
        activo: boolean
    } | null
    if (!fila?.activo) return null
    const alcance = await alcanceEmpresasDeUsuario(usuarioId)
    return { global: alcance.alcanceGlobal, empresas: alcance.empresas }
}

// ── Payloads ─────────────────────────────────────────────────────────────────────────────────

interface DatosServicio {
    empresa_id: number | null
    cliente_id: number | null
}

async function datosServicio(servicioId: number): Promise<DatosServicio> {
    const fila = (await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id', 'cliente_id')
        .first()) as { empresa_id: number | null; cliente_id: number | null } | null
    return { empresa_id: entero(fila?.empresa_id), cliente_id: entero(fila?.cliente_id) }
}

/** Empresas de los servicios del cliente (sin los retirados), en orden de id. */
async function empresasDelCliente(clienteId: number): Promise<number[]> {
    const filas = (await db
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')
        .orderBy('empresa_id')) as Array<{ empresa_id: number }>
    return filas.map((f) => Number(f.empresa_id))
}

export interface WebhookIris {
    payload: Payload
    /** empresas a las que toca el evento (para el alcance); `empresa_id` del payload es la primera */
    empresas: number[]
    /** infraestructura compartida (router sin empresa sugerida): pasa con cualquier alcance */
    compartido?: boolean
}

/**
 * Payload que recibe Iris (§2.3) a partir del evento de Argos, con `empresa_id`; null si el evento
 * no sirve a Iris. Lista cerrada de campos: lo que no está aquí no sale de Argos.
 */
export async function payloadParaIris(evento: string, p: Payload): Promise<WebhookIris | null> {
    if (evento === 'cliente.actualizado') {
        const clienteId = entero(p.cliente_id)
        if (!clienteId) return null
        // El cliente no es de una empresa: se toma la de sus servicios (§2.3 pide `empresa_id`).
        const empresas = await empresasDelCliente(clienteId)
        return {
            payload: {
                cliente_id: clienteId,
                empresa_id: empresas[0] ?? null,
                empresas,
                campos: textos(p.campos),
            },
            empresas,
        }
    }

    if (evento === 'inventario.equipo_por_recuperar') {
        const unidadId = entero(p.unidad_id)
        const servicioId = entero(p.servicio_id)
        if (!unidadId || !servicioId) return null
        const servicio = await datosServicio(servicioId)
        const empresaId = entero(p.empresa_id) ?? servicio.empresa_id
        return {
            payload: {
                unidad_id: unidadId,
                empresa_id: empresaId,
                servicio_id: servicioId,
                cliente_id: entero(p.cliente_id) ?? servicio.cliente_id,
                producto_id: entero(p.producto_id),
                serie: texto(p.serie),
                mac: texto(p.mac),
            },
            empresas: empresaId ? [empresaId] : [],
        }
    }

    if (evento === 'router.eliminado') {
        const routerId = entero(p.router_id)
        if (!routerId) return null
        const empresaId = entero(p.empresa_id)
        return {
            payload: { router_id: routerId, empresa_id: empresaId },
            empresas: empresaId ? [empresaId] : [],
            compartido: empresaId === null,
        }
    }

    if (evento === 'catalogo.cambiado') {
        const catalogo = texto(p.catalogo)
        const id = entero(p.id)
        if (!id || !catalogo || !(CATALOGOS as readonly string[]).includes(catalogo)) return null
        const empresaId = entero(p.empresa_id)
        return {
            payload: { catalogo, id, empresa_id: empresaId, campos: textos(p.campos) },
            empresas: empresaId ? [empresaId] : [],
            compartido: empresaId === null,
        }
    }

    if (TRASLADOS.has(evento)) return payloadTraslado(evento, p)

    const servicioId = entero(p.servicio_id)
    if (!servicioId) return null

    if (evento === 'servicio.eliminado') {
        // La fila ya no existe: todo sale del payload del evento (A1 lo manda completo)
        const empresaId = entero(p.empresa_id)
        return {
            payload: {
                servicio_id: servicioId,
                empresa_id: empresaId,
                cliente_id: entero(p.cliente_id),
                router_id: entero(p.router_id),
            },
            empresas: empresaId ? [empresaId] : [],
        }
    }

    const servicio = await datosServicio(servicioId)
    const empresaId = entero(p.empresa_id) ?? servicio.empresa_id
    const clienteId = entero(p.cliente_id) ?? servicio.cliente_id
    const base = { servicio_id: servicioId, empresa_id: empresaId, cliente_id: clienteId }
    const empresas = empresaId ? [empresaId] : []

    switch (evento) {
        case 'servicio.creado':
            return {
                payload: { ...base, router_id: entero(p.router_id), plan_id: entero(p.plan_id) },
                empresas,
            }
        case 'servicio.estado_cambiado':
            return {
                payload: {
                    ...base,
                    de: texto(p.de),
                    a: texto(p.a),
                    motivo: texto(p.motivo),
                    ...(texto(p.origen_tipo) ? { origen_tipo: texto(p.origen_tipo) } : {}),
                    ...(texto(p.origen_id) ? { origen_id: texto(p.origen_id) } : {}),
                },
                empresas,
            }
        case 'servicio.config_cambiada': {
            const anterior = entero(p.empresa_anterior_id)
            return {
                payload: {
                    ...base,
                    campos: textos(p.campos),
                    ...(anterior ? { empresa_anterior_id: anterior } : {}),
                    ...(texto(p.motivo) ? { motivo: texto(p.motivo) } : {}),
                    ...(entero(p.plan_temporal_id) ? { plan_temporal_id: entero(p.plan_temporal_id) } : {}),
                },
                // Un cambio de empresa le interesa a quien tenía el servicio y a quien lo recibe
                empresas: anterior && anterior !== empresaId ? [...empresas, anterior] : empresas,
            }
        }
        case 'servicio.datos_cambiados':
            // Solo nombres de campo (dirección, coordenadas, referencia, contacto): Iris relee el servicio.
            // `empresas` = [empresa_id], la forma de `cliente.actualizado` (§2.3)
            return { payload: { ...base, empresas, campos: textos(p.campos) }, empresas }
        case 'asignacion.cambiada':
            return {
                payload: {
                    ...base,
                    ipv4: textos(p.ipv4),
                    prefijo_enlace_v6: texto(p.prefijo_enlace_v6),
                    prefijo_delegado_v6: texto(p.prefijo_delegado_v6),
                    inicio: texto(p.inicio),
                    fin: texto(p.fin),
                },
                empresas,
            }
        case 'servicio.caidas_repetidas': {
            const causas: Record<string, number> = {}
            if (p.causas && typeof p.causas === 'object' && !Array.isArray(p.causas)) {
                for (const [causa, cantidad] of Object.entries(p.causas as Record<string, unknown>)) {
                    const n = enteroONulo(cantidad)
                    if (n !== null) causas[causa] = n
                }
            }
            return {
                payload: {
                    ...base,
                    router_id: entero(p.router_id),
                    sesion_id: entero(p.sesion_id),
                    sesiones: enteroONulo(p.sesiones),
                    desde: texto(p.desde),
                    hasta: texto(p.hasta),
                    umbral: enteroONulo(p.umbral),
                    ventana_minutos: enteroONulo(p.ventana_minutos),
                    causas,
                },
                empresas,
            }
        }
        default:
            return null
    }
}

const TRASLADOS = new Set<string>([
    'inventario.traslado_enviado',
    'inventario.traslado_recibido',
    'inventario.traslado_cancelado',
])

const METODOS_RECEPCION = ['firma_digital', 'firma_papel', 'aceptacion_sistema'] as const
const ORIGENES_RECEPCION = ['iris', 'panel'] as const

/** `{ id_externo, correo }` del técnico o de quien recibió; null si no viene completo. */
function persona(valor: unknown): { id_externo: string; correo: string } | null {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null
    const v = valor as Record<string, unknown>
    const idExterno = texto(v.id_externo)
    const correo = texto(v.correo)
    return idExterno && correo ? { id_externo: idExterno, correo } : null
}

/** Líneas `{ producto_id, cantidad, series[] }`: la cantidad es texto (3 decimales), tal cual. */
function lineasTraslado(valor: unknown): Array<{ producto_id: number; cantidad: string; series: string[] }> {
    if (!Array.isArray(valor)) return []
    return valor.flatMap((l) => {
        if (!l || typeof l !== 'object') return []
        const linea = l as Record<string, unknown>
        const productoId = entero(linea.producto_id)
        const cantidad = typeof linea.cantidad === 'number' ? String(linea.cantidad) : texto(linea.cantidad)
        if (!productoId || cantidad === null) return []
        return [{ producto_id: productoId, cantidad, series: textos(linea.series) }]
    })
}

function unoDe<T extends string>(valor: unknown, permitidos: readonly T[]): T | null {
    return typeof valor === 'string' && (permitidos as readonly string[]).includes(valor)
        ? (valor as T)
        : null
}

/**
 * `inventario.traslado_*` (0.5.0, §2.3): lista cerrada de los campos del contrato, con los valores
 * tal cual los emite A3. La empresa de la orden decide el alcance.
 */
function payloadTraslado(evento: string, p: Payload): WebhookIris | null {
    const trasladoId = entero(p.traslado_id)
    const empresaId = entero(p.empresa_id)
    if (!trasladoId || !empresaId) return null
    const comun = {
        traslado_id: trasladoId,
        empresa_id: empresaId,
        bodega_destino_id: entero(p.bodega_destino_id),
        tecnico: persona(p.tecnico),
        estado: texto(p.estado),
        lineas: lineasTraslado(p.lineas),
        enviado_en: texto(p.enviado_en),
    }
    const empresas = [empresaId]
    if (evento === 'inventario.traslado_recibido') {
        return {
            payload: {
                ...comun,
                recibido_en: texto(p.recibido_en),
                recibido_por: persona(p.recibido_por),
                metodo_recepcion: unoDe(p.metodo_recepcion, METODOS_RECEPCION),
                origen: unoDe(p.origen, ORIGENES_RECEPCION),
            },
            empresas,
        }
    }
    if (evento === 'inventario.traslado_cancelado') {
        return {
            payload: { ...comun, cancelado_en: texto(p.cancelado_en), motivo: texto(p.motivo) },
            empresas,
        }
    }
    return { payload: comun, empresas }
}

/**
 * Si el alcance del conector cubre el evento. Un evento sin empresa solo pasa con alcance global,
 * salvo el de infraestructura compartida (`compartido`), que pasa siempre.
 */
export function enAlcance(alcance: AlcanceConectorIris, empresas: number[], compartido = false): boolean {
    if (alcance.global || compartido) return true
    return empresas.some((e) => alcance.empresas.includes(e))
}

// ── Registro y entrega ───────────────────────────────────────────────────────────────────────

/**
 * Registra el webhook de un evento del bus (lo llama `ConsumidorIris`). Idempotente por id del
 * outbox. Devuelve el id del envío o null si no aplica (otro evento, conector sin destino, evento
 * de 0.5.0 con un conector anterior, fuera del alcance) o ya existía.
 */
export async function registrarEnvioIris(evento: EventoEntrante): Promise<number | null> {
    if (!(EVENTOS_A_IRIS as readonly string[]).includes(evento.evento)) return null
    if (!(await destinoWebhooksIris())) return null
    if (
        (EVENTOS_DESDE_050 as readonly string[]).includes(evento.evento) &&
        !(await conectorAdmite(CONTRATO_EVENTOS_050))
    ) {
        logger.debug(
            { outboxId: evento.id, evento: evento.evento },
            'iris: el conector habla un contrato anterior a 0.5.0; webhook no enviado',
        )
        return null
    }
    const alcance = await alcanceConectorIris()
    if (!alcance) {
        logger.debug({ outboxId: evento.id }, 'iris: sin usuario técnico activo; webhook no enviado')
        return null
    }
    const webhook = await payloadParaIris(evento.evento, evento.payload ?? {})
    if (!webhook || !enAlcance(alcance, webhook.empresas, webhook.compartido)) return null

    const payload = { ...webhook.payload }
    if (evento.evento === 'cliente.actualizado' && !alcance.global) {
        // Iris solo ve las empresas de su alcance
        const visibles = webhook.empresas.filter((e) => alcance.empresas.includes(e))
        payload.empresas = visibles
        payload.empresa_id = visibles[0] ?? null
    }
    return insertarEnvio(TABLA_ENVIOS_IRIS, {
        outboxId: evento.id,
        evento: evento.evento,
        empresaId: entero(payload.empresa_id),
        payload,
    })
}

/** `fetch` para los envíos (las pruebas lo reemplazan). */
let fetchEnvios: typeof fetch = (...args) => fetch(...args)

export function fijarFetchEnviosIris(fn?: typeof fetch) {
    fetchEnvios = fn ?? ((...args) => fetch(...args))
}

const CANAL_IRIS: CanalWebhooks = {
    sistema: 'iris',
    tabla: TABLA_ENVIOS_IRIS,
    destino: async () => {
        const destino = await destinoWebhooksIris()
        return destino ? { url: destino.url, secreto: destino.secreto } : null
    },
    motivoDescarte: 'Conector Iris apagado o sin receptor configurado',
    fetch: () => fetchEnvios,
}

/** Entrega los webhooks pendientes a Iris (bucle de `node ace iris:worker`). */
export function entregarPendientesIris(
    opciones: { limite?: number; ahora?: Date; soloId?: number } = {},
): Promise<ResultadoEntrega> {
    return entregarPendientesDe(CANAL_IRIS, opciones)
}
