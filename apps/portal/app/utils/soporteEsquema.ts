import { z } from '~/lib/zod'

/**
 * Esquemas de los formularios de soporte (aparte de `soporte.ts` para que zod solo baje con las
 * pantallas que los usan). Espejo de `apps/api/app/portal/soporte/validators.ts`, que a su vez
 * espeja las reglas de Iris (contrato 0.9.0 §11.4, §11.5 y §11.7).
 */

export const esquemaTicket = z.object({
    asunto: z.string().trim().min(3, 'Escribe al menos 3 letras').max(200, 'Hasta 200 caracteres'),
    descripcion: z.string().trim().min(1, 'Cuéntanos qué pasa').max(20_000, 'Hasta 20 000 caracteres'),
    categoria_id: z.number().int().positive().optional(),
    servicio_id: z.number().int().positive().optional(),
})
export type DatosTicket = z.output<typeof esquemaTicket>

export const esquemaRespuesta = z.object({
    cuerpo: z.string().trim().min(1, 'Escribe tu mensaje').max(20_000, 'Hasta 20 000 caracteres'),
})
export type DatosRespuesta = z.output<typeof esquemaRespuesta>

const COORDENADAS = /^-?\d{1,2}(\.\d+)?,\s?-?\d{1,3}(\.\d+)?$/
const TELEFONO = /^\+?[\d\s()-]{8,25}$/

/** Según el tipo: servicio obligatorio en cambio de plan y traslado; dirección en alta y traslado. */
export function esquemaSolicitud(tipo: TipoSolicitud) {
    const servicio = pideServicio(tipo)
    return z.object({
        servicio_id: servicio === 'obligatorio'
            ? z.number({ error: 'Elige el servicio' }).int().positive()
            : z.number().int().positive().optional(),
        direccion: pideDireccion(tipo)
            ? z.string().trim().min(1, 'Escribe la dirección').max(300, 'Hasta 300 caracteres')
            : z.string().optional(),
        coordenadas: z.string().trim()
            .refine(v => v === '' || COORDENADAS.test(v), 'Escribe latitud y longitud: 14.6349,-90.5069')
            .optional(),
        plan_interes_id: z.number().int().positive().optional(),
        comentario: z.string().trim().max(2000, 'Hasta 2000 caracteres').optional(),
        telefono_contacto: z.string().trim()
            .refine(v => v === '' || TELEFONO.test(v), 'Escribe solo números, espacios o guiones')
            .optional(),
    })
}
export type DatosSolicitud = z.output<ReturnType<typeof esquemaSolicitud>>
