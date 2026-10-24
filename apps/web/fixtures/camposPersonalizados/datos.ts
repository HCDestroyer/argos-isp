import type { Schema } from '@argosisp/contracts'

const creado = '2026-10-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

/**
 * Catálogo de campos personalizados del cliente (`GET /campos-personalizados`, A1): uno de cada
 * tipo y uno inactivo, en el orden de la API (`orden`, luego `etiqueta`). La instalación nueva
 * no trae ninguno; `mikrowisp_id` del importador queda fuera del catálogo, como en la API.
 */
export const camposPersonalizados: Schema<'CampoPersonalizado'>[] = [
    { id: 1, clave: 'referencia_casa', etiqueta: 'Referencia de la casa', tipo: 'texto', opciones: [], requerido: false, orden: 10, activo: true, ...meta },
    { id: 2, clave: 'medio_contacto', etiqueta: 'Cómo nos conoció', tipo: 'opcion', opciones: ['Vecino', 'Redes sociales', 'Volante'], requerido: false, orden: 20, activo: true, ...meta },
    { id: 3, clave: 'fecha_visita', etiqueta: 'Fecha de visita técnica', tipo: 'fecha', opciones: [], requerido: false, orden: 30, activo: true, ...meta },
    { id: 4, clave: 'acepta_publicidad', etiqueta: 'Acepta publicidad', tipo: 'booleano', opciones: [], requerido: false, orden: 40, activo: true, ...meta },
    { id: 5, clave: 'numero_poste', etiqueta: 'Número de poste', tipo: 'numero', opciones: [], requerido: false, orden: 50, activo: false, ...meta },
]
