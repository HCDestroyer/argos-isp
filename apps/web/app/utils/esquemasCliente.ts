import type { Schema, paths } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearClienteValidator` / `editarClienteValidator` (apps/api/app/core/validators.ts).
 *
 * El formulario trabaja con strings (`''` = vacío) y el esquema los transforma a lo que espera
 * la API (`null` para vaciar un campo). Si cambia el validador del backend, cambia esto.
 */

/** NIT con dígito verificador (numérico o K), CUI de 13 dígitos o CF. Igual que `nitCui()` del backend. */
export const PATRON_NIT_CUI = /^(CF|\d{13}|\d{1,12}-?[0-9K])$/
/** "lat,lng", igual que `coordenadas()` del backend. */
export const PATRON_COORDENADAS = /^-?\d+(\.\d+)?, ?-?\d+(\.\d+)?$/

/** Valor de `zona` en el formulario cuando el cliente no tiene zona. */
export const SIN_ZONA = 'ninguna'

function textoOpcional(maximo: number) {
    return z.string()
        .trim()
        .max(maximo, `Máximo ${maximo} caracteres`)
        .transform(valor => valor || null)
}

export const esquemaCliente = z.object({
    nombre: z.string('El nombre es obligatorio')
        .trim()
        .min(2, 'Escribe al menos 2 caracteres')
        .max(200, 'Máximo 200 caracteres'),
    tipo: z.enum(['persona', 'empresa']),
    nit_cui: z.string()
        .trim()
        .toUpperCase()
        .refine(valor => valor === '' || PATRON_NIT_CUI.test(valor), 'NIT con dígito verificador (1234567-8), CUI de 13 dígitos o CF')
        .transform(valor => valor || null),
    nombre_fiscal: textoOpcional(200),
    direccion_fiscal: textoOpcional(300),
    email: z.string()
        .trim()
        .refine(valor => valor === '' || z.email().safeParse(valor).success, 'Escribe un correo válido')
        .transform(valor => valor || null),
    telefono: textoOpcional(30),
    movil: textoOpcional(30),
    direccion: textoOpcional(300),
    coordenadas: z.string()
        .trim()
        .refine(valor => valor === '' || PATRON_COORDENADAS.test(valor), 'Latitud y longitud: 14.6349,-90.5069')
        .transform(valor => valor || null),
    zona: z.string().transform(valor => (valor === SIN_ZONA || valor === '' ? null : Number(valor))),
    canal_preferido: z.enum(['correo', 'telegram', 'whatsapp']),
})

/** Lo que el formulario edita (strings). */
export type EntradaCliente = z.input<typeof esquemaCliente>
/** Lo que sale validado del formulario. */
export type SalidaCliente = z.output<typeof esquemaCliente>

type CuerpoCrearCliente = paths['/api/v1/clientes']['post']['requestBody']['content']['application/json']

/** Convierte la salida del formulario al cuerpo de `POST /clientes` (y de `PUT`, más `version`). */
export function cuerpoCliente(salida: SalidaCliente): CuerpoCrearCliente {
    const { zona, ...resto } = salida
    return { ...resto, zona_id: zona }
}

/** Estado inicial del formulario: vacío para un alta o con los datos del cliente para editar. */
export function entradaDesdeCliente(cliente?: Schema<'Cliente'>): EntradaCliente {
    return {
        nombre: cliente?.nombre ?? '',
        tipo: cliente?.tipo ?? 'persona',
        nit_cui: cliente?.nit_cui ?? '',
        nombre_fiscal: cliente?.nombre_fiscal ?? '',
        direccion_fiscal: cliente?.direccion_fiscal ?? '',
        email: cliente?.email ?? '',
        telefono: cliente?.telefono ?? '',
        movil: cliente?.movil ?? '',
        direccion: cliente?.direccion ?? '',
        coordenadas: cliente?.coordenadas ?? '',
        zona: cliente?.zona_id ? String(cliente.zona_id) : SIN_ZONA,
        canal_preferido: cliente?.canal_preferido ?? 'correo',
    }
}

/**
 * Espejo de `POST /clientes/:id/responsable-pago`: `responsable_id` obligatorio y motivo de 3 a
 * 500 caracteres (la API lo acepta opcional; el panel lo pide para la bitácora).
 */
export const esquemaResponsable = z.object({
    responsable_id: z.number().int().positive('Elige el cliente que paga'),
    motivo: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(500, 'Máximo 500 caracteres'),
})

export type EntradaResponsable = z.input<typeof esquemaResponsable>
export type SalidaResponsable = z.output<typeof esquemaResponsable>
