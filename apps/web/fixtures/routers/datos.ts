import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }
// Conexión de la API REST de RouterOS (semana 3): los valores por defecto de la API.
const conexion = { api_url: null, api_tls_verificar: true, tiene_api_ca: false, dhcp_servidor: null, interfaz_clientes: null }
// Multiempresa (A1): sin empresa sugerida, como devuelve la API por defecto.
const empresa = { empresa_sugerida_id: null }
// Contacto (A1): sin fuente periódica que lo mida, como devuelve la API por defecto.
export const SIN_CONTACTO = { en_linea: null, ultimo_contacto: null }
// Duplicados (A1, `contratos/routers.md`): serial que leyó el sondeo y unión; la API siempre los envía.
export const SIN_UNION = { unido_a_id: null }

export const routers: Schema<'Router'>[] = [
    {
        id: 1,
        nombre: 'RB-Centro',
        serial: 'HE0812ABC9',
        ...SIN_UNION,
        host: '10.10.0.1',
        api_usuario: 'argos',
        tiene_api_password: true,
        tiene_radius_secret: true,
        nas_ip: '10.10.0.1',
        modo_seguridad: 'radius',
        control_velocidad: 'simple',
        capacidad_bajada_kbps: null,
        capacidad_subida_kbps: null,
        modo_velocidad: 'simple',
        activo: true,
        ...conexion,
        ...SIN_CONTACTO,
        ...empresa,
        zona_id: null,
        ...meta,
    },
    {
        id: 2,
        nombre: 'CCR-Mixco',
        serial: 'D4E2071F3B11',
        ...SIN_UNION,
        host: '10.20.0.1',
        api_usuario: 'argos',
        tiene_api_password: true,
        tiene_radius_secret: true,
        nas_ip: '10.20.0.1',
        modo_seguridad: 'radius',
        control_velocidad: 'arbol_pcq',
        capacidad_bajada_kbps: 1_000_000,
        capacidad_subida_kbps: 500_000,
        modo_velocidad: 'pcq',
        activo: true,
        ...conexion,
        ...SIN_CONTACTO,
        // Multiempresa: los servicios nuevos de este router se sugieren a Fibra del Sur.
        empresa_sugerida_id: 2,
        zona_id: 2,
        ...meta,
    },
    {
        id: 3,
        nombre: 'RB-Bodega (respaldo)',
        serial: null,
        ...SIN_UNION,
        host: '10.30.0.1',
        api_usuario: null,
        tiene_api_password: false,
        tiene_radius_secret: true,
        nas_ip: '10.30.0.1',
        modo_seguridad: 'radius',
        control_velocidad: 'simple',
        capacidad_bajada_kbps: null,
        capacidad_subida_kbps: null,
        modo_velocidad: 'simple',
        activo: false,
        ...conexion,
        ...SIN_CONTACTO,
        ...empresa,
        zona_id: null,
        ...meta,
    },
    {
        // El mismo MikroTik del RB-Centro registrado otra vez «para usar árbol PCQ» (reporte del PM):
        // misma API (10.10.0.1:443) y mismo serial. Lo detecta `GET /routers/duplicados`.
        id: 4,
        nombre: 'RB-Centro PCQ',
        serial: 'HE0812ABC9',
        ...SIN_UNION,
        host: '10.10.0.1',
        api_usuario: 'argos',
        tiene_api_password: true,
        tiene_radius_secret: true,
        nas_ip: '10.10.0.2',
        modo_seguridad: 'radius',
        control_velocidad: 'arbol_pcq',
        capacidad_bajada_kbps: null,
        capacidad_subida_kbps: null,
        modo_velocidad: 'pcq',
        activo: true,
        ...conexion,
        ...SIN_CONTACTO,
        ...empresa,
        zona_id: null,
        ...meta,
    },
]

/**
 * Secreto RADIUS en claro de cada router, solo para que los fixtures comparen como `routers.unir`
 * (422 `secreto_radius_distinto`). La API nunca lo devuelve (`tiene_radius_secret`).
 */
export const secretosRadius: Record<number, string | null> = { 1: 'lab-secreto', 2: 'mixco-secreto', 3: 'bodega-secreto', 4: 'lab-secreto' }

/** Ocupación antes de calcularla: las rutas devuelven siempre la real (`vistaRed`, `vistaPool`). */
export const OCUPACION_SIN_CALCULAR: Schema<'OcupacionPool'> = { total: 0, asignadas: 0, libres: 0, reservadas: 0, porcentaje: 0 }
const SIN_RANGO = { rango_inicio: null, rango_fin: null, dns_primario: null, dns_secundario: null, ocupacion: OCUPACION_SIN_CALCULAR }

export const redesIpv4: Schema<'RedIpv4'>[] = [
    { id: 1, router_id: 1, nombre: 'Fijas del centro', cidr: '100.64.10.0/24', gateway: '100.64.10.1', tipo: 'estatico', ...SIN_RANGO, dns_primario: '1.1.1.1', dns_secundario: '8.8.8.8', ...meta },
    { id: 2, router_id: 1, nombre: null, cidr: '100.64.11.0/24', gateway: null, tipo: 'pool', ...SIN_RANGO, ...meta },
    { id: 3, router_id: 2, nombre: null, cidr: '100.64.20.0/23', gateway: '100.64.20.1', tipo: 'estatico', ...SIN_RANGO, ...meta },
    { id: 4, router_id: 3, nombre: null, cidr: '100.64.30.0/24', gateway: '100.64.30.1', tipo: 'estatico', ...SIN_RANGO, ...meta },
    { id: 5, router_id: 4, nombre: null, cidr: '100.64.12.0/24', gateway: null, tipo: 'pool', ...SIN_RANGO, ...meta },
]

const SIN_ESPACIO = { espacio: { pools: 0, porcentaje_en_pools: 0 } }

export const ipv6Bloques: Schema<'Ipv6Bloque'>[] = [
    { id: 1, router_id: 1, nombre: 'Principal', proveedor: 'Tigo Business', prefijo: '2803:d100:1000::/40', ...SIN_ESPACIO, ...meta },
    { id: 2, router_id: 2, nombre: null, proveedor: null, prefijo: '2803:d100:2000::/40', ...SIN_ESPACIO, ...meta },
]

/** Entrega antes de calcularla (la ruta la recalcula con `entregaPool`). */
export const ENTREGA_SIN_CALCULAR: Schema<'EntregaPoolIpv6'> = { atributo_radius: 'Delegated-IPv6-Prefix', redes_lan_por_cliente: 1, clientes_maximos: 0, primer_prefijo: '', segundo_prefijo: null, ultimo_prefijo: '' }

/** Pools del bloque del RB-Centro: enlace /64 por servicio y delegación /56, como en el laboratorio. */
export const ipv6Pools: Schema<'Ipv6Pool'>[] = [
    { id: 1, bloque_id: 1, router_id: 1, nombre: null, prefijo: '2803:d100:1000::/44', tipo: 'enlace', tamano_entrega: 64, nombre_en_router: 'v6-enlace', ocupacion: OCUPACION_SIN_CALCULAR, entrega: ENTREGA_SIN_CALCULAR, ...meta },
    { id: 2, bloque_id: 1, router_id: 1, nombre: null, prefijo: '2803:d100:1080::/41', tipo: 'delegacion', tamano_entrega: 56, nombre_en_router: 'v6-pd', ocupacion: OCUPACION_SIN_CALCULAR, entrega: ENTREGA_SIN_CALCULAR, ...meta },
]

/** Conexión WireGuard de cada router (`GET /routers/:id/conexion`): uno conectado, uno a medias y uno sin configurar. */
export const conexionesRouter: Schema<'ConexionRouter'>[] = [
    { router_id: 1, estado: 'conectado', ip_tunel: '10.255.0.2', public_key: 'kH3sZ0pR1m9bQyU5wT8xVv2cLgN4dJf6aE7iO0rS1tA=', ultimo_handshake: '2026-10-29T15:58:30.000Z', handshake_reciente: true, registrado_en: '2026-10-20T16:00:00.000Z', routeros_version: '7.24.5 (stable)', token_vence: null, version: 3 },
    { router_id: 2, estado: 'pendiente', ip_tunel: '10.255.0.3', public_key: null, ultimo_handshake: null, handshake_reciente: false, registrado_en: null, routeros_version: null, token_vence: '2026-10-30T16:00:00.000Z', version: 1 },
    { router_id: 3, estado: 'sin_configurar', ip_tunel: null, public_key: null, ultimo_handshake: null, handshake_reciente: false, registrado_en: null, routeros_version: null, token_vence: null, version: 0 },
]
