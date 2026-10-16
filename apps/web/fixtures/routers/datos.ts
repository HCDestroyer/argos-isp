import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

export const routers: Schema<'Router'>[] = [
    {
        id: 1,
        nombre: 'RB-Centro',
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
        ...meta,
    },
    {
        id: 2,
        nombre: 'CCR-Mixco',
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
        ...meta,
    },
    {
        id: 3,
        nombre: 'RB-Bodega (respaldo)',
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
        ...meta,
    },
]

export const redesIpv4: Schema<'RedIpv4'>[] = [
    { id: 1, router_id: 1, cidr: '100.64.10.0/24', gateway: '100.64.10.1', tipo: 'estatico', ...meta },
    { id: 2, router_id: 1, cidr: '100.64.11.0/24', gateway: null, tipo: 'pool', ...meta },
    { id: 3, router_id: 2, cidr: '100.64.20.0/23', gateway: '100.64.20.1', tipo: 'estatico', ...meta },
    { id: 4, router_id: 3, cidr: '100.64.30.0/24', gateway: '100.64.30.1', tipo: 'estatico', ...meta },
]

export const ipv6Bloques: Schema<'Ipv6Bloque'>[] = [
    { id: 1, router_id: 1, prefijo: '2803:d100:1000::/40', ...meta },
    { id: 2, router_id: 2, prefijo: '2803:d100:2000::/40', ...meta },
]
