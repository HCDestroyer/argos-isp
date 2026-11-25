import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { CausaAprovisionamiento, TipoEquipoCliente } from '#shared/eventos'

/**
 * Filas de `integraciones.aprovisionamientos` (A32) y `integraciones.wifi_solicitudes` (A35): forma
 * pública del contrato (§12.2), pasos y política de reintentos. Lo usan las acciones, la ruta y el
 * worker; no hay lógica de negocio aquí.
 */

export type NombrePaso = 'ip' | 'equipo' | 'wifi' | 'activacion'
export type EstadoPaso = 'pendiente' | 'hecho' | 'fallido' | 'no_aplica'
export interface Paso {
    paso: NombrePaso
    estado: EstadoPaso
    en: string | null
}

export interface EquipoPedido {
    tipo: TipoEquipoCliente
    serie: string | null
    mac: string | null
    unidad_id: number | null
    modelo: string | null
    gestionado: boolean
    /**
     * Interno (no sale en la vista): el PPPoE va por el ACS, decidido al aceptar (§4.3). Ausente en
     * los pedidos anteriores al lote 2 de `contratos/equipos-olt-acs.md`.
     */
    pppoe_por_acs?: boolean
}

export interface FilaAprovisionamiento {
    id: number
    empresa_id: number
    servicio_id: number
    cliente_id: number
    /** `argos_panel` si lo inició el panel de Argos (0.14.3) */
    origen_tipo: 'iris_orden' | 'argos_panel' | null
    origen_id: string | null
    idempotency_key: string | null
    estado: 'en_proceso' | 'listo' | 'fallido'
    pasos: Paso[]
    causa: CausaAprovisionamiento | null
    reintentable: boolean
    detalle: string | null
    equipo: EquipoPedido
    planta: Record<string, unknown> | null
    wireless: Record<string, unknown> | null
    wifi_ssid_cifrado: string | null
    wifi_clave_cifrada: string | null
    tecnico_id_externo: string | null
    /** 0.14.3: bodega de la que sale el comodato (validada al aceptar); null = reglas anteriores */
    bodega_id: number | null
    iris_actor: string | null
    senal: { rx_dbm: number | null; tx_dbm: number | null } | null
    smartolt_external_id: string | null
    acs_device_id: string | null
    intentos: number
    proximo_intento_en: Date | null
    terminado_en: Date | null
    request_id: string
    created_at: Date
    updated_at: Date
}

/** Espera antes de cada reintento automático (fallos transitorios); después, `fallido` reintentable. */
export const ESPERAS_REINTENTO_S = [30, 60, 120, 240]
/** Cambio de Wi-Fi: la persona espera; dos reintentos cortos. */
export const ESPERAS_REINTENTO_WIFI_S = [20, 60]

export function pasosIniciales(opciones: { equipo: boolean; wifi: boolean }): Paso[] {
    return [
        { paso: 'ip', estado: 'pendiente', en: null },
        { paso: 'equipo', estado: opciones.equipo ? 'pendiente' : 'no_aplica', en: null },
        { paso: 'wifi', estado: opciones.wifi ? 'pendiente' : 'no_aplica', en: null },
        { paso: 'activacion', estado: 'pendiente', en: null },
    ]
}

export function marcarPaso(pasos: Paso[], paso: NombrePaso, estado: EstadoPaso, en = new Date()): Paso[] {
    return pasos.map((p) => (p.paso === paso ? { ...p, estado, en: en.toISOString() } : p))
}

export function estadoPaso(pasos: Paso[], paso: NombrePaso): EstadoPaso {
    return pasos.find((p) => p.paso === paso)?.estado ?? 'no_aplica'
}

export async function leerAprovisionamiento(
    id: number,
    cliente: QueryClientContract = db.connection(),
    opciones: { bloquear?: boolean } = {},
): Promise<FilaAprovisionamiento | null> {
    let q = cliente.from('integraciones.aprovisionamientos').where('id', id)
    if (opciones.bloquear) q = q.forUpdate()
    const fila = (await q.first()) as FilaAprovisionamiento | null
    if (!fila) return null
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        servicio_id: Number(fila.servicio_id),
        cliente_id: Number(fila.cliente_id),
        bodega_id: fila.bodega_id === null || fila.bodega_id === undefined ? null : Number(fila.bodega_id),
    }
}

/** Quién lo inició (0.14.3): `argos` si lo pidió el panel de Argos, `iris` si el token de Iris. */
export function iniciadoPor(origenTipo: string | null): 'argos' | 'iris' {
    return origenTipo === 'argos_panel' ? 'argos' : 'iris'
}

/** `GET /aprovisionamientos/:id` (§12.2). Nunca la clave ni el SSID del Wi-Fi inicial. */
export interface VistaAprovisionamiento {
    aprovisionamiento_id: number
    servicio_id: number
    empresa_id: number
    origen_tipo: string | null
    origen_id: string | null
    iniciado_por: 'argos' | 'iris'
    estado: 'en_proceso' | 'listo' | 'fallido'
    pasos: Paso[]
    causa: CausaAprovisionamiento | null
    reintentable: boolean
    detalle: string | null
    servicio_estado: string
    equipo: EquipoPedido
    senal: { rx_dbm: number | null; tx_dbm: number | null } | null
    creado_en: string
    actualizado_en: string
}

export async function vistaAprovisionamiento(
    fila: FilaAprovisionamiento,
    cliente: QueryClientContract = db.connection(),
): Promise<VistaAprovisionamiento> {
    const servicio = (await cliente
        .from('core.servicios')
        .where('id', fila.servicio_id)
        .select('estado')
        .first()) as {
        estado: string
    } | null
    return {
        aprovisionamiento_id: fila.id,
        servicio_id: fila.servicio_id,
        empresa_id: fila.empresa_id,
        origen_tipo: fila.origen_tipo,
        origen_id: fila.origen_id,
        iniciado_por: iniciadoPor(fila.origen_tipo),
        estado: fila.estado,
        pasos: fila.pasos,
        causa: fila.causa,
        reintentable: fila.reintentable,
        detalle: fila.detalle,
        servicio_estado: servicio?.estado ?? 'retirado',
        equipo: {
            tipo: fila.equipo.tipo,
            serie: fila.equipo.serie,
            mac: fila.equipo.mac,
            unidad_id: fila.equipo.unidad_id,
            modelo: fila.equipo.modelo,
            gestionado: fila.equipo.gestionado,
        },
        senal: fila.senal,
        creado_en: new Date(fila.created_at).toISOString(),
        actualizado_en: new Date(fila.updated_at).toISOString(),
    }
}

/**
 * Lo que ve un conector de un aprovisionamiento que no inició él (0.14.3 §12.2, ajeno): solo esto, sin
 * `equipo`, `pasos`, `detalle`, `senal` ni `reintentable`, y `origen_id` siempre null.
 */
export interface VistaAprovisionamientoAjeno {
    aprovisionamiento_id: number
    servicio_id: number
    empresa_id: number
    origen_tipo: string | null
    origen_id: null
    iniciado_por: 'argos' | 'iris'
    estado: 'en_proceso' | 'listo' | 'fallido'
    causa: CausaAprovisionamiento | null
    actualizado_en: string
}

export function vistaAprovisionamientoAjeno(fila: FilaAprovisionamiento): VistaAprovisionamientoAjeno {
    return {
        aprovisionamiento_id: fila.id,
        servicio_id: fila.servicio_id,
        empresa_id: fila.empresa_id,
        origen_tipo: fila.origen_tipo,
        origen_id: null,
        iniciado_por: iniciadoPor(fila.origen_tipo),
        estado: fila.estado,
        causa: fila.causa,
        actualizado_en: new Date(fila.updated_at).toISOString(),
    }
}

export interface FilaWifi {
    id: number
    empresa_id: number
    servicio_id: number
    cliente_id: number
    origen_tipo: 'iris_orden' | 'iris_ticket' | 'iris_conversacion'
    origen_id: string
    idempotency_key: string | null
    estado: 'en_proceso' | 'aplicado' | 'fallido'
    causa: string | null
    cambia_ssid: boolean
    cambia_clave: boolean
    ssid_cifrado: string | null
    clave_cifrada: string | null
    intentos: number
    request_id: string
}
