import { z } from '~/lib/zod'

/**
 * Formulario de un contacto (espejo de `agregarContactoValidator` en
 * `apps/api/app/portal/soporte/validators.ts` y de `validarTelefonos` de A1): de 1 a 5 números,
 * exactamente un principal. La API los normaliza a E.164 y responde 422 por posición.
 */
const NUMERO = /^\+?[\d\s()-]{8,25}$/

export const esquemaContacto = z.object({
    nombre: z.string().trim().min(2, 'Escribe el nombre').max(200, 'Hasta 200 caracteres'),
    relacion: z.enum(['familiar', 'inquilino', 'empleado', 'otro']),
    todos: z.boolean(),
    servicios: z.array(z.number().int().positive()),
    permisos: z.object({
        consultar: z.boolean(),
        reportar: z.boolean(),
        pagar: z.boolean(),
        avisos: z.boolean(),
    }),
    telefonos: z.array(z.object({
        numero: z.string().trim().regex(NUMERO, 'Número no válido: 8 dígitos o +código de país'),
        whatsapp: z.boolean(),
        principal: z.boolean(),
    })).min(1, 'Agrega al menos un número').max(5, 'Hasta 5 números')
        .refine(lista => lista.filter(t => t.principal).length === 1, 'Marca un número como principal'),
}).refine(datos => datos.todos || datos.servicios.length > 0, {
    message: 'Elige al menos un servicio',
    path: ['servicios'],
})
export type DatosContacto = z.output<typeof esquemaContacto>
