import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'

export const zonas: Schema<'Zona'>[] = [
    { id: 1, nombre: 'Centro', empresa_sugerida_id: null, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 2, nombre: 'San Lucas', empresa_sugerida_id: null, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 3, nombre: 'Mixco Norte', empresa_sugerida_id: 2, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 4, nombre: 'Villa Nueva', empresa_sugerida_id: null, activo: true, version: 1, created_at: creado, updated_at: creado },
]
