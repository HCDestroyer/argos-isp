import type { Schema } from '@argosisp/contracts'

/** Un nodo en uso y uno revocado, como `GET /nodos-portal` (A5). */
export const nodosPortal: Schema<'NodoPortal'>[] = [
    { id: 1, nombre: 'portal-mixco', ultimo_uso: '2026-10-20T15:31:00.000Z', ultima_ip: '190.56.10.4', revocado_en: null, creado_por: 1, created_at: '2026-09-10T15:00:00.000Z' },
    { id: 2, nombre: 'portal-prueba', ultimo_uso: null, ultima_ip: null, revocado_en: '2026-09-12T15:00:00.000Z', creado_por: 1, created_at: '2026-09-11T15:00:00.000Z' },
]
