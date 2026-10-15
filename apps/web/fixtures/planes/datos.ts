import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

export const planes: Schema<'Plan'>[] = [
    {
        id: 1,
        nombre: 'Hogar 10 Mbps',
        precio: '150.00',
        bajada_kbps: 10_000,
        subida_kbps: 5_000,
        bajada_limitada_kbps: 1_000,
        subida_limitada_kbps: 512,
        reuso: 1,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
        activo: true,
        ...meta,
    },
    {
        id: 2,
        nombre: 'Hogar 20 Mbps',
        precio: '200.00',
        bajada_kbps: 20_000,
        subida_kbps: 10_000,
        bajada_limitada_kbps: 1_000,
        subida_limitada_kbps: 512,
        reuso: 1,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
        activo: true,
        ...meta,
    },
    {
        id: 3,
        nombre: 'Pyme 50 Mbps',
        precio: '450.00',
        bajada_kbps: 50_000,
        subida_kbps: 25_000,
        bajada_limitada_kbps: 2_000,
        subida_limitada_kbps: 1_000,
        reuso: 1,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 48,
        global: false,
        activo: true,
        ...meta,
    },
    {
        id: 4,
        nombre: 'Fibra Mixco 100 Mbps',
        precio: '349.99',
        bajada_kbps: 100_000,
        subida_kbps: 50_000,
        bajada_limitada_kbps: 2_000,
        subida_limitada_kbps: 1_000,
        reuso: 1,
        dual_stack: 'v4',
        tamano_prefijo_delegado: 64,
        global: false,
        activo: true,
        ...meta,
    },
]

/** Planes implementados en cada router (`GET /routers/:id/planes`). */
export const planesPorRouter: Record<number, number[]> = {
    1: [1, 2, 3],
    2: [1, 2, 4],
    3: [1],
}
