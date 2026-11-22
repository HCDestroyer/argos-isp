import { Decimal } from 'decimal.js'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { EventoEntrante } from '#shared/eventos_bus'
import { CAMPOS_CUENTA_BANCARIA_CAMBIADA } from '#shared/eventos'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { usuarioIris } from '#core/integraciones_iris'
import {
    CONTRATO_EVENTOS_060,
    EVENTOS_IRIS_DESDE_060,
    conectorAdmite,
    contratoMinimoEventoIris,
    destinoWebhooksIris,
} from '#integraciones/iris/configuracion'
import { ocultarDocumentoIris } from '#integraciones/iris/atencion'
import { pendienteDe, verFactura, type FacturaFila } from '#billing/facturas'
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
 * - **Pagos y atención** (contrato 0.6.0, §7.2 y §7.4): `comprobante.aprobado` / `.rechazado` y
 *   `promesa.creada` / `.cumplida` / `.incumplida` / `.cancelada`, de cualquier canal dentro del
 *   alcance, solo a conectores con contrato ≥ 0.6.0 (`EVENTOS_DESDE_060`). Lo que A3 no trae en el
 *   evento se completa con la fila (`billing.comprobantes`, `billing.promesas`); nunca la imagen del
 *   comprobante ni la referencia bancaria.
 * - **Cuentas bancarias** (contrato 0.8.0, §7.8): `cuenta_bancaria.cambiada` solo a conectores con
 *   contrato ≥ 0.8.0 (`EVENTOS_DESDE_080`), con la empresa de la cuenta como alcance. Solo nombres
 *   de campo (lista cerrada `CAMPOS_CUENTA_BANCARIA_CAMBIADA`), `activa` y `creada`: nunca el
 *   número, el alias ni el titular. Iris relee la cuenta con `GET /cuentas-bancarias/:id`.
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
    'comprobante.aprobado',
    'comprobante.rechazado',
    'promesa.creada',
    'promesa.cumplida',
    'promesa.incumplida',
    'promesa.cancelada',
    'cuenta_bancaria.cambiada',
    // 0.9.0 (A36): solo de facturas `iris_orden`
    'factura.emitida',
    'factura.anulada',
    'pago.registrado',
    'pago.anulado',
    // 0.10.0 (A42, A41 y A39)
    'cliente.contactos_cambiados',
    'cliente.identidad_registrada',
    'servicio.titular_cambiado',
    // 0.12.0 (A48)
    'inventario.equipo_cambiado',
    'inventario.unidad_estado_cambiado',
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

/**
 * Eventos de pagos y atención del contrato Iris 0.6.0 (§2.3, §7.2, §7.4): solo con contrato ≥ 0.6.0.
 * La lista y la versión son de A1 (`#integraciones/iris/configuracion`).
 */
export const EVENTOS_DESDE_060 = EVENTOS_IRIS_DESDE_060 satisfies ReadonlyArray<
    (typeof EVENTOS_A_IRIS)[number]
>

export { CONTRATO_EVENTOS_060 }

/** Eventos que nacieron con el contrato Iris 0.8.0 (§7.8): solo a conectores con contrato ≥ 0.8.0. */
export const EVENTOS_DESDE_080 = ['cuenta_bancaria.cambiada'] as const satisfies ReadonlyArray<
    (typeof EVENTOS_A_IRIS)[number]
>

/** Versión mínima del contrato para `EVENTOS_DESDE_080`. */
export const CONTRATO_EVENTOS_080 = '0.8.0'

/**
 * Cobro de las órdenes de Iris (contrato 0.9.0 §2.3, A36): `factura.*` y `pago.*` solo de facturas
 * con origen `iris_orden` y solo a conectores con contrato ≥ 0.9.0.
 */
export const EVENTOS_DESDE_090 = [
    'factura.emitida',
    'factura.anulada',
    'pago.registrado',
    'pago.anulado',
] as const satisfies ReadonlyArray<(typeof EVENTOS_A_IRIS)[number]>

export const CONTRATO_EVENTOS_090 = '0.9.0'

/**
 * Eventos que nacieron con el contrato Iris 0.10.0 (§3.4 y §3.5; contactos A42, identidad A41 y
 * titular A39): solo a conectores con contrato ≥ 0.10.0 (`CONTRATO_EVENTOS_0100`, más abajo).
 */
export const EVENTOS_DESDE_0100 = [
    'cliente.contactos_cambiados',
    'cliente.identidad_registrada',
    'servicio.titular_cambiado',
] as const satisfies ReadonlyArray<(typeof EVENTOS_A_IRIS)[number]>

/** `persona_cliente_id` en `cliente.contactos_cambiados` (A46): solo con contrato ≥ 0.10.1. */
export const CONTRATO_PERSONA_CLIENTE = '0.10.1'

/** Equipos del cliente (A48), contrato 0.12.0 §2.3 y §3.10: solo con contrato ≥ 0.12.0. */
export const EVENTOS_DESDE_0120 = [
    'inventario.equipo_cambiado',
    'inventario.unidad_estado_cambiado',
] as const satisfies ReadonlyArray<(typeof EVENTOS_A_IRIS)[number]>

export const CONTRATO_EVENTOS_0120 = '0.12.0'

/** Contrato 0.14.1 (§3.4.4): `tipo_titular` en `servicio.titular_cambiado`; a un conector anterior no sale. */
export const CONTRATO_TITULAR_EMPRESA = '0.14.1'

/** Versión mínima propia de este módulo (0.5.0, 0.8.0, 0.9.0, 0.10.0, 0.12.0); la de 0.6.0 la decide A1. */
function contratoMinimoEnvio(evento: string): string | null {
    if ((EVENTOS_DESDE_050 as readonly string[]).includes(evento)) return CONTRATO_EVENTOS_050
    if ((EVENTOS_DESDE_080 as readonly string[]).includes(evento)) return CONTRATO_EVENTOS_080
    if ((EVENTOS_DESDE_090 as readonly string[]).includes(evento)) return CONTRATO_EVENTOS_090
    if ((EVENTOS_DESDE_0100 as readonly string[]).includes(evento)) return CONTRATO_EVENTOS_0100
    if ((EVENTOS_DESDE_0120 as readonly string[]).includes(evento)) return CONTRATO_EVENTOS_0120
    return contratoMinimoEventoIris(evento)
}

const CANALES_COMPROBANTE = ['portal', 'panel', 'iris'] as const
const CAUSAS_RECHAZO = [
    'no_aparece',
    'monto_distinto',
    'ilegible',
    'falta_dato',
    'duplicado',
    'otro',
] as const
const TIPOS_PROMESA = ['promesa', 'reconexion_temporal'] as const
const MOTIVOS_RECONEXION = ['fuera_de_horario', 'sin_personal'] as const
const CANALES_PROMESA = ['portal', 'ia', 'operador', 'supervisor'] as const
const ESTADOS_SERVICIO = ['pendiente_instalacion', 'activo', 'limitado', 'suspendido', 'retirado'] as const

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
/** Versión del contrato desde la que los payloads llevan `servicio_codigo`/`servicio_nombre` (A45). */
export const CONTRATO_EVENTOS_0100 = '0.10.0'

/**
 * Contrato Iris 0.10.0 §3.7 (A45): todo payload hacia Iris que lleva `servicio_id` suma
 * `servicio_codigo` y `servicio_nombre` del servicio (o null si ya no existe: `servicio.eliminado`).
 * Solo a conectores con contrato ≥ 0.10.0 (`registrarEnvioIris`). `servicio_nombre` es texto del
 * cliente: va en el cuerpo firmado, nunca a logs.
 */
export async function conCodigoServicio(payload: Payload): Promise<Payload> {
    const servicioId = entero(payload.servicio_id)
    if (!servicioId) return payload
    const fila = (await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('codigo', 'nombre')
        .first()) as {
        codigo: string
        nombre: string | null
    } | null
    return { ...payload, servicio_codigo: fila?.codigo ?? null, servicio_nombre: fila?.nombre ?? null }
}

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

    if (evento === 'cliente.contactos_cambiados' || evento === 'cliente.identidad_registrada') {
        return payloadClienteIris(evento, p)
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
    if (evento === 'comprobante.aprobado' || evento === 'comprobante.rechazado') {
        return payloadComprobante(evento, p)
    }
    if (evento.startsWith('promesa.')) return payloadPromesa(evento, p)
    if (evento === 'cuenta_bancaria.cambiada') return payloadCuentaBancaria(p)
    if (evento === 'factura.emitida' || evento === 'factura.anulada') return payloadFacturaIris(evento, p)
    if (evento === 'pago.registrado' || evento === 'pago.anulado') return payloadPagoIris(p)
    if (evento === 'inventario.unidad_estado_cambiado') return payloadUnidadEstado(p)

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
                    // 0.10.0 §3.4.5: el cambio de plan de un pendiente lo pidió una orden de Iris
                    ...(texto(p.origen_tipo) ? { origen_tipo: texto(p.origen_tipo) } : {}),
                    ...(texto(p.origen_id) ? { origen_id: texto(p.origen_id) } : {}),
                },
                // Un cambio de empresa le interesa a quien tenía el servicio y a quien lo recibe
                empresas: anterior && anterior !== empresaId ? [...empresas, anterior] : empresas,
            }
        }
        case 'servicio.datos_cambiados':
            // Solo nombres de campo (dirección, coordenadas, referencia, contacto): Iris relee el servicio.
            // `empresas` = [empresa_id], la forma de `cliente.actualizado` (§2.3)
            return {
                payload: {
                    ...base,
                    empresas,
                    campos: textos(p.campos),
                    ...(texto(p.origen_tipo) ? { origen_tipo: texto(p.origen_tipo) } : {}),
                    ...(texto(p.origen_id) ? { origen_id: texto(p.origen_id) } : {}),
                },
                empresas,
            }
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
        case 'servicio.titular_cambiado': {
            const de = entero(p.de_cliente_id)
            const a = entero(p.a_cliente_id) ?? clienteId
            return {
                payload: {
                    servicio_id: servicioId,
                    empresa_id: empresaId,
                    de_cliente_id: de,
                    a_cliente_id: a,
                    existente: p.existente === true,
                    posible_duplicado: p.posible_duplicado === true,
                    de_cliente_eliminado: p.de_cliente_eliminado === true,
                    // nunca documento ni identidad; el texto del motivo queda solo en la auditoría de Argos
                    motivo_codigo: unoDe(p.motivo_codigo, MOTIVOS_TITULAR) ?? 'otro',
                    origen_tipo: unoDe(p.origen_tipo, ORIGENES_EXTERNOS),
                    origen_id: unoDe(p.origen_tipo, ORIGENES_EXTERNOS) ? texto(p.origen_id) : null,
                    // contrato 0.14.1 (aditivo): titular persona o empresa; nunca el representante
                    tipo_titular: p.tipo_titular === 'empresa' ? 'empresa' : 'persona',
                },
                empresas,
            }
        }
        case 'inventario.equipo_cambiado': {
            const origenTipo = unoDe(p.origen, ORIGENES_EXTERNOS) ?? unoDe(p.origen_tipo, ORIGENES_EXTERNOS)
            return {
                payload: {
                    ...base,
                    sale_unidad_id: entero(p.sale_unidad_id),
                    entra_unidad_id: entero(p.entra_unidad_id),
                    motivo: unoDe(p.motivo, MOTIVOS_CAMBIO_EQUIPO),
                    destino_sale: unoDe(p.destino_sale, DESTINOS_SALE),
                    // nunca la nota ni el cobro propuesto (§3.10, «Textos libres»)
                    origen: origenTipo,
                    origen_id: origenTipo ? texto(p.origen_id) : null,
                },
                empresas,
            }
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

const CAMPOS_CONTACTO_IRIS = [
    'nombre',
    'relacion',
    'servicios',
    'permisos',
    'telefonos',
    'persona_cliente_id',
]

/**
 * `cliente.contactos_cambiados` y `cliente.identidad_registrada` (0.10.0, §2.3): lista cerrada, sin
 * números, documentos ni fotos. El alcance es la empresa del evento (o las de los servicios del
 * cliente si viene null).
 */
async function payloadClienteIris(evento: string, p: Payload): Promise<WebhookIris | null> {
    const clienteId = entero(p.cliente_id)
    if (!clienteId) return null
    const empresaEvento = entero(p.empresa_id)
    const empresas = empresaEvento ? [empresaEvento] : await empresasDelCliente(clienteId)
    const empresaId = empresas[0] ?? null
    if (evento === 'cliente.identidad_registrada') {
        return {
            payload: {
                cliente_id: clienteId,
                empresa_id: empresaId,
                documento_tipo: unoDe(p.documento_tipo, ['dpi', 'pasaporte'] as const),
                metodo: unoDe(p.metodo, ['foto_documento', 'revision_panel'] as const),
            },
            empresas,
        }
    }
    return {
        payload: {
            cliente_id: clienteId,
            empresa_id: empresaId,
            contacto_id: entero(p.contacto_id),
            accion: unoDe(p.accion, ['creado', 'editado', 'quitado'] as const),
            campos: [...new Set(textos(p.campos))].filter((c) => CAMPOS_CONTACTO_IRIS.includes(c)),
            persona_cliente_id: entero(p.persona_cliente_id),
        },
        // un cliente sin servicios lo ve cualquier empresa (como `GET /clientes`)
        empresas,
        compartido: empresas.length === 0,
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

/** Monto como string con 2 decimales (`decimal.js`, nunca `number`); null si no es un número. */
function decimal(valor: unknown): string | null {
    if (valor === null || valor === undefined || valor === '') return null
    const t = String(valor)
    return /^-?\d+(\.\d+)?$/.test(t) ? new Decimal(t).toFixed(2) : null
}

function instanteIso(valor: unknown): string | null {
    if (valor instanceof Date) return valor.toISOString()
    const t = texto(valor)
    return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null
}

/**
 * `comprobante.aprobado` / `comprobante.rechazado` (0.6.0, §7.2): comprobante_id, empresa_id,
 * cliente_id, servicio_id, canal, monto, pago_id, motivo, causa, servicio_estado y, desde 0.7.1
 * (A24, §7.2 y §7.7), verificado_iris_actor: el `X-Iris-Actor` de quien decidió desde Iris, o null
 * si decidió caja en el panel. Es aditivo: va a todo conector ≥ 0.6.0, sin condición de versión
 * (el contrato no lo condiciona; un Iris 0.6/0.7.0 ignora el campo). Lo que A3 no trae en el
 * evento sale de `billing.comprobantes` (y el estado, de `core.servicios`). Para comprobantes de
 * cualquier canal dentro del alcance.
 */
async function payloadComprobante(evento: string, p: Payload): Promise<WebhookIris | null> {
    const comprobanteId = entero(p.comprobante_id)
    if (!comprobanteId) return null
    const fila = (await db
        .from('billing.comprobantes')
        .where('id', comprobanteId)
        .select(
            'empresa_id',
            'cliente_id',
            'servicio_id',
            'canal',
            'monto',
            'pago_id',
            'motivo_rechazo',
            'verificado_iris_actor',
        )
        .first()) as {
        empresa_id: number
        cliente_id: number
        servicio_id: number | null
        canal: string
        monto: string
        pago_id: number | null
        motivo_rechazo: string | null
        verificado_iris_actor: string | null
    } | null
    const empresaId = entero(p.empresa_id) ?? entero(fila?.empresa_id)
    if (!empresaId) return null
    const servicioId = entero(p.servicio_id) ?? entero(fila?.servicio_id)
    const aprobado = evento === 'comprobante.aprobado'
    let servicioEstado = unoDe(p.servicio_estado, ESTADOS_SERVICIO)
    if (!servicioEstado && servicioId && aprobado) {
        const servicio = (await db
            .from('core.servicios')
            .where('id', servicioId)
            .select('estado')
            .first()) as {
            estado: string
        } | null
        servicioEstado = unoDe(servicio?.estado, ESTADOS_SERVICIO)
    }
    return {
        payload: {
            comprobante_id: comprobanteId,
            empresa_id: empresaId,
            cliente_id: entero(p.cliente_id) ?? entero(fila?.cliente_id),
            servicio_id: servicioId,
            canal: unoDe(p.canal, CANALES_COMPROBANTE) ?? unoDe(fila?.canal, CANALES_COMPROBANTE),
            monto: decimal(p.monto) ?? decimal(fila?.monto),
            pago_id: aprobado ? (entero(p.pago_id) ?? entero(fila?.pago_id)) : null,
            motivo: aprobado ? null : (texto(p.motivo) ?? texto(fila?.motivo_rechazo)),
            // Sin causa en el evento (A3 anterior a 0.6.0), el rechazo cuenta como `otro`
            causa: aprobado ? null : (unoDe(p.causa, CAUSAS_RECHAZO) ?? 'otro'),
            servicio_estado: servicioId ? servicioEstado : null,
            // 0.7.1 (A24): quién decidió desde Iris; null si decidió caja en el panel. Un evento
            // anterior a 0.7.1 (sin la clave) lo toma de la fila
            verificado_iris_actor:
                'verificado_iris_actor' in p
                    ? texto(p.verificado_iris_actor)
                    : texto(fila?.verificado_iris_actor),
        },
        empresas: [empresaId],
    }
}

/**
 * `promesa.*` (0.6.0, §7.4): promesa_id, empresa_id, cliente_id, servicio_id, tipo, canal,
 * comprobante_id, vence, monto y, en `promesa.cancelada`, motivo. Lo que no trae el evento sale de
 * `billing.promesas`. `tipo` y `comprobante_id` llegan de A3 (reconexión temporal); sin ellos, una
 * promesa común (`promesa`, null). `motivo_reconexion` (`fuera_de_horario` | `sin_personal`, null
 * fuera de una reconexión; desde el 17 nov 2026): aditivo, sin condición de versión; un evento
 * anterior (sin la clave) lo toma de `billing.promesas.motivo_reconexion`.
 */
async function payloadPromesa(evento: string, p: Payload): Promise<WebhookIris | null> {
    const promesaId = entero(p.promesa_id)
    if (!promesaId) return null
    const fila = (await db
        .from('billing.promesas')
        .where('id', promesaId)
        .select('empresa_id', 'cliente_id', 'servicio_id', 'canal', 'monto', 'vence_en', 'motivo_reconexion')
        .first()) as {
        empresa_id: number
        cliente_id: number
        servicio_id: number
        canal: string
        monto: string
        vence_en: Date
        motivo_reconexion: string | null
    } | null
    const empresaId = entero(p.empresa_id) ?? entero(fila?.empresa_id)
    if (!empresaId) return null
    return {
        payload: {
            promesa_id: promesaId,
            empresa_id: empresaId,
            cliente_id: entero(p.cliente_id) ?? entero(fila?.cliente_id),
            servicio_id: entero(p.servicio_id) ?? entero(fila?.servicio_id),
            tipo: unoDe(p.tipo, TIPOS_PROMESA) ?? 'promesa',
            canal: unoDe(p.canal, CANALES_PROMESA) ?? unoDe(fila?.canal, CANALES_PROMESA),
            comprobante_id: entero(p.comprobante_id),
            // Un evento anterior al 17 nov 2026 (sin la clave) lo toma de la fila
            motivo_reconexion:
                'motivo_reconexion' in p
                    ? unoDe(p.motivo_reconexion, MOTIVOS_RECONEXION)
                    : unoDe(fila?.motivo_reconexion, MOTIVOS_RECONEXION),
            vence: instanteIso(p.vence) ?? instanteIso(fila?.vence_en),
            monto: decimal(p.monto) ?? decimal(fila?.monto),
            ...(evento === 'promesa.cancelada' ? { motivo: texto(p.motivo) } : {}),
        },
        empresas: [empresaId],
    }
}

/**
 * `cuenta_bancaria.cambiada` (0.8.0, §7.8): cuenta_bancaria_id, empresa_id, campos[] (solo los
 * nombres de la lista cerrada, sin repetir), activa (después del cambio) y creada. Lo que A3 no
 * trae en el evento sale de `billing.cuentas_bancarias` (solo `empresa_id` y `activa`). Nunca
 * valores: ni `numero`, ni `alias`, ni `titular`.
 */
async function payloadCuentaBancaria(p: Payload): Promise<WebhookIris | null> {
    const cuentaId = entero(p.cuenta_bancaria_id)
    if (!cuentaId) return null
    let empresaId = entero(p.empresa_id)
    let activa = typeof p.activa === 'boolean' ? p.activa : null
    if (!empresaId || activa === null) {
        const fila = (await db
            .from('billing.cuentas_bancarias')
            .where('id', cuentaId)
            .select('empresa_id', 'activa')
            .first()) as { empresa_id: number; activa: boolean } | null
        empresaId = empresaId ?? entero(fila?.empresa_id)
        activa = activa ?? (typeof fila?.activa === 'boolean' ? fila.activa : null)
    }
    if (!empresaId || activa === null) return null
    const permitidos = CAMPOS_CUENTA_BANCARIA_CAMBIADA as readonly string[]
    const campos = [...new Set(textos(p.campos))].filter((c) => permitidos.includes(c))
    return {
        payload: {
            cuenta_bancaria_id: cuentaId,
            empresa_id: empresaId,
            campos,
            activa,
            creada: p.creada === true,
        },
        empresas: [empresaId],
    }
}

// ── 0.9.0 (A36): cobro de las órdenes de Iris ─────────────────────────────────────────────────

const ORIGENES_EXTERNOS = ['iris_orden'] as const

interface FacturaIris {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    estado: string
    total: string
    saldo: string
    origen_externo_id: string
    numero: string
}

/**
 * Factura con origen `iris_orden` (null si no existe o no es de una orden de Iris). Total, cubierto
 * y estado salen de `verFactura` de A3 (pagos, saldos a favor y notas de crédito vigentes).
 */
async function facturaIris(facturaId: number): Promise<FacturaIris | null> {
    const existe = (await db
        .from('billing.facturas')
        .where('id', facturaId)
        .where('origen_externo_tipo', 'iris_orden')
        .select('origen_externo_id')
        .first()) as { origen_externo_id: string } | null
    if (!existe) return null
    const f = (await verFactura(facturaId)) as unknown as FacturaFila
    const pendiente = pendienteDe(f)
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cliente_id: Number(f.cliente_id),
        servicio_id: entero(f.servicio_id),
        estado: f.estado,
        total: new Decimal(f.total).toFixed(2),
        saldo: f.estado === 'anulada' || pendiente.isNegative() ? '0.00' : pendiente.toFixed(2),
        origen_externo_id: existe.origen_externo_id,
        numero: f.fel_serie && f.fel_numero ? `${f.fel_serie}-${f.fel_numero}` : String(f.id),
    }
}

/**
 * `factura.emitida` / `factura.anulada` (0.9.0, A36): factura_id, numero (serie-número del DTE o el
 * id), empresa_id, cliente_id, servicio_id, origen_tipo, origen_id, estado, total, saldo y moneda.
 * Solo facturas `iris_orden`; las demás no salen (null).
 */
async function payloadFacturaIris(evento: string, p: Payload): Promise<WebhookIris | null> {
    const facturaId = entero(p.factura_id)
    if (!facturaId) return null
    const f = await facturaIris(facturaId)
    if (!f) return null
    return {
        payload: {
            factura_id: f.id,
            numero: f.numero,
            empresa_id: f.empresa_id,
            cliente_id: f.cliente_id,
            servicio_id: f.servicio_id,
            origen_tipo: 'iris_orden',
            origen_id: f.origen_externo_id,
            estado: evento === 'factura.anulada' ? 'anulada' : f.estado,
            total: f.total,
            saldo: evento === 'factura.anulada' ? '0.00' : f.saldo,
            moneda: 'GTQ',
        },
        empresas: [f.empresa_id],
    }
}

/**
 * `pago.registrado` / `pago.anulado` (0.9.0, A36): pago_id, factura_id, origen_tipo, origen_id,
 * empresa_id, monto (lo aplicado a esa factura) y fecha (instante del pago). Solo si el pago se
 * aplicó a una factura `iris_orden`; si cubre varias, la primera (un webhook por evento).
 */
async function payloadPagoIris(p: Payload): Promise<WebhookIris | null> {
    const pagoId = entero(p.pago_id)
    if (!pagoId) return null
    const facturas = Array.isArray(p.facturas) ? p.facturas.map(entero).filter((x): x is number => !!x) : []
    const aplicaciones = (await db
        .from('billing.pagos_aplicaciones as a')
        .join('billing.facturas as f', 'f.id', 'a.factura_id')
        .join('billing.pagos as p', 'p.id', 'a.pago_id')
        .where('a.pago_id', pagoId)
        .where('f.origen_externo_tipo', 'iris_orden')
        .if(facturas.length > 0, (q) => q.whereIn('a.factura_id', facturas))
        .groupBy('a.factura_id', 'f.empresa_id', 'f.origen_externo_id', 'p.created_at')
        .orderBy('a.factura_id')
        .select(
            'a.factura_id',
            'f.empresa_id',
            'f.origen_externo_id',
            'p.created_at',
            db.raw('sum(a.monto) AS monto'),
        )) as Array<{
        factura_id: number
        empresa_id: number
        origen_externo_id: string
        created_at: Date
        monto: string
    }>
    const a = aplicaciones[0]
    if (!a) return null
    const empresaId = entero(p.empresa_id) ?? Number(a.empresa_id)
    return {
        payload: {
            pago_id: pagoId,
            factura_id: Number(a.factura_id),
            origen_tipo: 'iris_orden',
            origen_id: a.origen_externo_id,
            empresa_id: empresaId,
            monto: decimal(a.monto),
            fecha: instanteIso(a.created_at),
        },
        empresas: [empresaId],
    }
}

// ── 0.10.0 (A42, A39) y 0.12.0 (A48) ─────────────────────────────────────────────────────────

const MOTIVOS_TITULAR = ['menor_de_edad', 'otro'] as const
const MOTIVOS_CAMBIO_EQUIPO = ['danado', 'actualizacion', 'garantia', 'otro'] as const
const DESTINOS_SALE = ['funciona', 'revision', 'garantia', 'danado'] as const
const ESTADOS_UNIDAD = [
    'disponible',
    'en_comodato',
    'por_recuperar',
    'revision',
    'garantia',
    'dada_de_baja',
    'no_recuperada',
] as const

/**
 * `inventario.unidad_estado_cambiado` (0.12.0 §3.10): unidad_id, empresa_id, servicio_id (o null),
 * de, a y motivo. Sin costos, proveedor ni RMA (lista cerrada).
 */
function payloadUnidadEstado(p: Payload): WebhookIris | null {
    const unidadId = entero(p.unidad_id)
    const empresaId = entero(p.empresa_id)
    const a = unoDe(p.a, ESTADOS_UNIDAD)
    if (!unidadId || !empresaId || !a) return null
    return {
        payload: {
            unidad_id: unidadId,
            empresa_id: empresaId,
            servicio_id: entero(p.servicio_id),
            de: unoDe(p.de, ESTADOS_UNIDAD),
            a,
            motivo: texto(p.motivo),
        },
        empresas: [empresaId],
    }
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
 * de 0.5.0, 0.6.0 u 0.8.0 con un conector anterior, fuera del alcance) o ya existía.
 */
export async function registrarEnvioIris(evento: EventoEntrante): Promise<number | null> {
    if (!(EVENTOS_A_IRIS as readonly string[]).includes(evento.evento)) return null
    if (!(await destinoWebhooksIris())) return null
    const minimo = contratoMinimoEnvio(evento.evento)
    if (minimo && !(await conectorAdmite(minimo))) {
        logger.debug(
            { outboxId: evento.id, evento: evento.evento, minimo },
            'iris: el conector habla un contrato anterior al del evento; webhook no enviado',
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

    // Seguro extra (A1, 0.6.0): `nit_cui` nunca sale hacia el usuario técnico Iris
    const conCodigo = (await conectorAdmite(CONTRATO_EVENTOS_0100))
        ? await conCodigoServicio(webhook.payload)
        : webhook.payload
    const payload = ocultarDocumentoIris({ ...conCodigo })
    // A46: el valor de `persona_cliente_id` solo a conectores ≥ 0.10.1; a un 0.10.0 la clave va en null
    // (la forma de A1: siempre presente)
    if (
        evento.evento === 'cliente.contactos_cambiados' &&
        !(await conectorAdmite(CONTRATO_PERSONA_CLIENTE))
    ) {
        payload.persona_cliente_id = null
    }
    if (evento.evento === 'servicio.titular_cambiado' && !(await conectorAdmite(CONTRATO_TITULAR_EMPRESA))) {
        delete payload.tipo_titular
    }
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
