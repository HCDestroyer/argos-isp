import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { listarContactosCliente, verContacto, type ContactoVista } from '#core/contactos'
import { NoEncontrado } from '#shared/errores'

/**
 * Contactos del cliente para notify (contrato Iris 0.10.0 §3.5, A42). Los contactos son de A1
 * (`core.contactos_cliente`): notify los lee **solo por esta interfaz**; el proveedor por defecto es
 * el del núcleo (`#core/contactos`, `PROVEEDOR_CONTACTOS_NUCLEO`).
 *
 * Para qué los usa notify:
 * - **Avisos de cobro** (`factura.vencida`, `recordatorio.*` y el corte por falta de pago): también
 *   a los contactos con `permisos.avisos` cuyo `servicios[]` incluye el servicio del aviso (o
 *   `null` = todos). Por correo o Telegram si el contacto tiene ese destino; por WhatsApp **no**:
 *   Iris lo reparte desde su caché de contactos respetando el permiso de cada número (§3.5, §6.4).
 * - **Avisos al titular** de un contacto agregado o de un número nuevo (con el número enmascarado).
 */

export interface TelefonoContacto {
    /** E.164 */
    numero: string
    whatsapp: boolean
    principal: boolean
}

export interface ContactoAviso {
    contacto_id: number
    cliente_id: number
    nombre: string
    relacion: string
    es_titular: boolean
    /** servicios del cliente a los que aplica; null = todos */
    servicios: number[] | null
    permisos: { consultar: boolean; reportar: boolean; pagar: boolean; avisos: boolean }
    telefonos: TelefonoContacto[]
    /** destinos propios del contacto, si A1 los guarda (el contrato no los exige) */
    email?: string | null
    telegram_chat_id?: string | null
}

export interface ProveedorContactos {
    /** Contactos no titulares del cliente (activos). */
    contactosDe(cliente: QueryClientContract, clienteId: number): Promise<ContactoAviso[]>
    /** Un contacto por id (también uno quitado, si A1 lo conserva), o null. */
    contacto(cliente: QueryClientContract, contactoId: number): Promise<ContactoAviso | null>
}

/** `ContactoVista` del núcleo → lo que notify necesita. Los números adicionales del titular no cuentan. */
function deNucleo(c: ContactoVista): ContactoAviso {
    return {
        contacto_id: c.contacto_id,
        cliente_id: c.cliente_id,
        nombre: c.nombre,
        relacion: c.relacion,
        es_titular: c.es_titular,
        servicios: c.servicios,
        permisos: c.permisos,
        telefonos: c.telefonos
            .filter((t) => !t.adicional)
            .map((t) => ({ numero: t.numero, whatsapp: t.whatsapp, principal: t.principal })),
        // el contrato (§3.5) no da correo ni Telegram a los contactos: hoy solo WhatsApp, por Iris
        email: null,
        telegram_chat_id: null,
    }
}

/**
 * Lectura de los contactos del núcleo (A1, `#core/contactos`): solo contactos vigentes (uno quitado
 * no avisa). Lee con la conexión de la transacción del aviso, así ve el contacto recién creado.
 */
export const PROVEEDOR_CONTACTOS_NUCLEO: ProveedorContactos = {
    contactosDe: async (cliente, clienteId) => {
        const contactos = await listarContactosCliente(clienteId, cliente)
        return contactos.map(deNucleo)
    },
    contacto: async (cliente, contactoId) => {
        try {
            return deNucleo(await verContacto(contactoId, cliente))
        } catch (error) {
            if (error instanceof NoEncontrado) return null
            throw error
        }
    },
}

let proveedor: ProveedorContactos = PROVEEDOR_CONTACTOS_NUCLEO

/**
 * Cambia el proveedor de contactos (las pruebas usan uno en memoria); sin argumento vuelve al del
 * núcleo (`PROVEEDOR_CONTACTOS_NUCLEO`), que es el registrado por defecto.
 */
export function fijarProveedorContactos(p?: ProveedorContactos) {
    proveedor = p ?? PROVEEDOR_CONTACTOS_NUCLEO
}

export function proveedorContactos(): ProveedorContactos {
    return proveedor
}

/** Contactos con `avisos` encendido para el servicio del aviso (o todos los del cliente sin servicio). */
export async function contactosConAvisos(
    cliente: QueryClientContract,
    clienteId: number,
    servicioId: number | null,
): Promise<ContactoAviso[]> {
    const todos = await proveedor.contactosDe(cliente, clienteId)
    return todos.filter(
        (c) =>
            !c.es_titular &&
            c.permisos.avisos &&
            (c.servicios === null || servicioId === null || c.servicios.includes(servicioId)),
    )
}

/** `+502 ****-3344`: código de país y los últimos 4 dígitos (§3.5, «Avisos al titular»). */
export function enmascararTelefono(numero: string): string {
    const digitos = numero.replace(/\D/g, '')
    const ultimos = digitos.slice(-4)
    const pais = numero.startsWith('+502')
        ? '+502'
        : numero.startsWith('+')
          ? `+${digitos.slice(0, digitos.length - 8)}`
          : ''
    return `${pais ? `${pais} ` : ''}****-${ultimos}`
}

/** `…1A2B`: los últimos 4 caracteres de la serie (§3.10, intento de recuperación). */
export function enmascararSerie(serie: string | null | undefined): string {
    const limpia = (serie ?? '').replace(/\s+/g, '')
    return limpia ? `…${limpia.slice(-4)}` : ''
}

// ── Eventos que avisan al titular ─────────────────────────────────────────────────────────────

/** Plantillas de notify de los avisos al titular (correo y Telegram; WhatsApp no tiene código en Iris). */
export const EVENTO_CONTACTO_AGREGADO = 'contacto.agregado'
export const EVENTO_CONTACTO_TELEFONO = 'contacto.telefono_agregado'
export const EVENTO_SERVICIO_A_TU_NOMBRE = 'servicio.asignado_a_tu_nombre'
export const EVENTO_INTENTO_RECUPERACION = 'equipo.intento_recuperacion'
/** Contrato Iris 0.9.0 §12.4 (A35): se cambió el Wi-Fi del servicio (aviso al titular). */
export const EVENTO_WIFI_CAMBIADO = 'equipo.wifi_cambiado'

/**
 * Evento de recuperación que esperamos de A1/A3 (A48, contrato Iris §3.10): uno por intento
 * registrado con `POST /servicios/:id/equipos/:unidad_id/no-recuperado`. Payload: intento_id,
 * unidad_id, empresa_id, servicio_id, cliente_id, serie, intento_n, motivo.
 */
export const EVENTO_RECUPERACION_INTENTADA = 'inventario.recuperacion_intentada'

export const EVENTOS_AVISO_TITULAR = [
    'cliente.contactos_cambiados',
    'servicio.titular_cambiado',
    EVENTO_RECUPERACION_INTENTADA,
    'equipo.wifi_resuelto',
] as const

type Payload = Record<string, unknown>

function entero(v: unknown): number | null {
    const n = Number(v)
    return v !== null && v !== undefined && v !== '' && Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Convierte un evento del bus en el aviso al titular: la plantilla de notify y el payload con el que
 * se arman sus variables (`contacto.*`, `equipo.*`). null si el evento no avisa (un contacto
 * quitado, un cambio sin números, un titular nuevo que no era cliente o un contacto que ya no está).
 */
export async function avisoAlTitular(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
): Promise<{ evento: string; payload: Payload } | null> {
    if (evento === 'cliente.contactos_cambiados') {
        const accion = payload.accion
        const campos = Array.isArray(payload.campos) ? payload.campos : []
        const contactoId = entero(payload.contacto_id)
        if (!contactoId) return null
        const numerosNuevos = Number(payload.numeros_agregados ?? 0) > 0
        const plantilla =
            accion === 'creado'
                ? EVENTO_CONTACTO_AGREGADO
                : accion === 'editado' && (numerosNuevos || campos.includes('telefonos'))
                  ? EVENTO_CONTACTO_TELEFONO
                  : null
        if (!plantilla) return null
        const contacto = await proveedor.contacto(cliente, contactoId)
        if (!contacto || contacto.es_titular) return null
        const principal = contacto.telefonos.find((t) => t.principal) ?? contacto.telefonos[0]
        return {
            evento: plantilla,
            payload: {
                ...payload,
                cliente_id: contacto.cliente_id,
                contacto: {
                    id: contacto.contacto_id,
                    nombre: contacto.nombre,
                    relacion: contacto.relacion,
                    telefono: principal ? enmascararTelefono(principal.numero) : '',
                    telefonos: contacto.telefonos.map((t) => enmascararTelefono(t.numero)).join(', '),
                },
            },
        }
    }
    if (evento === 'servicio.titular_cambiado') {
        // Decisión 9 del PM (§3.4.4): aviso informativo solo cuando cae en un cliente existente
        const a = entero(payload.a_cliente_id)
        if (!a || payload.existente !== true) return null
        return { evento: EVENTO_SERVICIO_A_TU_NOMBRE, payload: { ...payload, cliente_id: a } }
    }
    if (evento === 'equipo.wifi_resuelto') {
        // §12.4: después de `aplicado`, «si no fuiste tú, comunícate». Nunca el SSID ni la clave.
        if (payload.estado !== 'aplicado' || !entero(payload.cliente_id)) return null
        return { evento: EVENTO_WIFI_CAMBIADO, payload }
    }
    if (evento === EVENTO_RECUPERACION_INTENTADA) {
        if (!entero(payload.cliente_id) && !entero(payload.servicio_id)) return null
        return {
            evento: EVENTO_INTENTO_RECUPERACION,
            payload: {
                ...payload,
                equipo: {
                    serie: enmascararSerie(typeof payload.serie === 'string' ? payload.serie : null),
                    intento: entero(payload.intento_n) ?? '',
                },
            },
        }
    }
    return null
}

// ── Avisos de cobro ──────────────────────────────────────────────────────────────────────────

const POR_FACTURAS_VENCIDAS = /\d+ facturas? vencidas? \(se (corta|limita) con/

/** ¿Es un aviso de cobro (§6.3: factura por vencer, vencida o corte por falta de pago)? */
export function esAvisoDeCobro(evento: string, payload: Payload): boolean {
    if (evento === 'factura.vencida' || /^recordatorio\.\d+$/.test(evento)) return true
    if (evento === 'servicio.estado_cambiado') {
        const a = payload.a
        return (
            (a === 'suspendido' || a === 'limitado') &&
            typeof payload.motivo === 'string' &&
            POR_FACTURAS_VENCIDAS.test(payload.motivo)
        )
    }
    return false
}
