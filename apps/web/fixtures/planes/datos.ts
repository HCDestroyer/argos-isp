import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }
/** Lo que la API manda en cada plan sin velocidad avanzada (`VELOCIDAD_POR_DEFECTO` de A1). */
const velocidad = { garantizado_pct: null, rafaga_bajada_kbps: null, rafaga_subida_kbps: null, rafaga_umbral_pct: 75, rafaga_segundos: 16, prioridad: 8 }

export const planes: Schema<'Plan'>[] = [
    {
        id: 1,
        nombre: 'Hogar 10 Mbps',
        // Tipo de plan (A1): la API siempre lo manda (por defecto residencial).
        tipo: 'residencial',
        precio: '150.00',
        bajada_kbps: 10_000,
        subida_kbps: 5_000,
        bajada_limitada_kbps: 1_000,
        subida_limitada_kbps: 512,
        reuso: 1,
        ...velocidad,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
        activo: true,
        ...meta,
    },
    {
        id: 2,
        nombre: 'Hogar 20 Mbps',
        // Tipo de plan (A1): la API siempre lo manda (por defecto residencial).
        tipo: 'residencial',
        precio: '200.00',
        bajada_kbps: 20_000,
        subida_kbps: 10_000,
        bajada_limitada_kbps: 1_000,
        subida_limitada_kbps: 512,
        reuso: 1,
        ...velocidad,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 56,
        global: true,
        activo: true,
        ...meta,
    },
    {
        id: 3,
        nombre: 'Pyme 50 Mbps',
        // Tipo de plan (A1): la API siempre lo manda (por defecto residencial).
        tipo: 'empresarial',
        precio: '450.00',
        bajada_kbps: 50_000,
        subida_kbps: 25_000,
        bajada_limitada_kbps: 2_000,
        subida_limitada_kbps: 1_000,
        reuso: 1,
        ...velocidad,
        dual_stack: 'ambos',
        tamano_prefijo_delegado: 48,
        global: false,
        activo: true,
        ...meta,
    },
    {
        id: 4,
        nombre: 'Fibra Mixco 100 Mbps',
        // Tipo de plan (A1): la API siempre lo manda (por defecto residencial).
        tipo: 'residencial',
        precio: '349.99',
        bajada_kbps: 100_000,
        subida_kbps: 50_000,
        bajada_limitada_kbps: 2_000,
        subida_limitada_kbps: 1_000,
        reuso: 1,
        ...velocidad,
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
