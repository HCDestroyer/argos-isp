import type { Schema, paths } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearClienteValidator` / `editarClienteValidator` (apps/api/app/core/validators.ts)
 * y de `validarDocumentoFiscal` (`apps/api/app/core/nit_cui.ts`, localización fiscal fase 1).
 *
 * El formulario trabaja con strings (`''` = vacío) y el esquema los transforma a lo que espera
 * la API (`null` para vaciar un campo). Si cambia el validador del backend, cambia esto.
 */

/** Forma de NIT con dígito verificador (numérico o K), CUI de 13 dígitos o CF; el verificador se revisa aparte. */
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

/**
 * Esquema del formulario con los campos personalizados activos del catálogo (`campos`): cada
 * valor se valida con la misma regla que la API (tipo, opción de la lista, obligatorio) y el
 * error va en `campos_personalizados.<clave>`, el mismo nombre que el 422 de la API.
 */
export function esquemaClienteCon(campos: Schema<'CampoPersonalizado'>[]) {
    return z.object({
        nombre: z.string('Escribe el nombre')
            .trim()
            .min(2, 'Escribe al menos 2 caracteres')
            .max(200, 'Máximo 200 caracteres'),
        tipo: z.enum(['persona', 'empresa']),
        tipo_documento_fiscal: z.enum(['nit', 'cui', 'pasaporte', 'cf']),
        /** Se guarda sin guiones ni espacios, como la API; consumidor final va sin número. */
        nit_cui: z.string()
            .trim()
            .toUpperCase(),
        pais_fiscal: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Código de país de 2 letras (GT)'),
        agente_retencion_iva: z.boolean(),
        sector_publico: z.boolean(),
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
        campos_personalizados: valoresCamposFormulario.superRefine((valores, ctx) => {
            for (const campo of campos) {
                const error = errorValorCampo(campo, valores[campo.clave])
                if (error) {
                    ctx.addIssue({ code: 'custom', path: [campo.clave], message: error })
                }
            }
        }),
    }).superRefine((datos, ctx) => {
        const error = errorDocumentoFiscal(datos.tipo_documento_fiscal, datos.nit_cui, datos.pais_fiscal)
        if (error) {
            ctx.addIssue({ code: 'custom', path: [error.campo], message: error.mensaje })
        }
    }).transform(datos => ({
        ...datos,
        nit_cui: datos.tipo_documento_fiscal === 'cf' ? null : limpiarDocumento(datos.nit_cui),
    }))
}

/** Sin catálogo (o mientras carga): ningún campo personalizado que validar. */
export const esquemaCliente = esquemaClienteCon([])

/** Lo que el formulario edita (strings). */
export type EntradaCliente = z.input<typeof esquemaCliente>
/** Lo que sale validado del formulario. */
export type SalidaCliente = z.output<typeof esquemaCliente>

type CuerpoCrearCliente = paths['/api/v1/clientes']['post']['requestBody']['content']['application/json']

/** Convierte la salida del formulario al cuerpo de `POST /clientes` (y de `PUT`, más `version`). */
export function cuerpoCliente(salida: SalidaCliente, campos?: { catalogo: Schema<'CampoPersonalizado'>[], guardados?: Record<string, unknown> }): CuerpoCrearCliente {
    const { zona, campos_personalizados: valores, ...resto } = salida
    // Sin catálogo leído no se manda: al editar, la API reemplazaría los valores guardados.
    return campos
        ? { ...resto, zona_id: zona, campos_personalizados: cuerpoCampos(campos.catalogo, valores, campos.guardados) }
        : { ...resto, zona_id: zona }
}

/** Estado inicial del formulario: vacío para un alta o con los datos del cliente para editar. */
export function entradaDesdeCliente(cliente?: Schema<'Cliente'>, campos: Schema<'CampoPersonalizado'>[] = []): EntradaCliente {
    return {
        nombre: cliente?.nombre ?? '',
        tipo: cliente?.tipo ?? 'persona',
        // Clientes de antes de la localización: el tipo se deduce del número, como la API.
        tipo_documento_fiscal: cliente?.tipo_documento_fiscal ?? deducirTipoDocumento(cliente?.nit_cui) ?? 'nit',
        nit_cui: cliente?.nit_cui && cliente.nit_cui.toUpperCase() !== 'CF' ? cliente.nit_cui : '',
        pais_fiscal: cliente?.pais_fiscal ?? 'GT',
        agente_retencion_iva: cliente?.agente_retencion_iva ?? false,
        sector_publico: cliente?.sector_publico ?? false,
        nombre_fiscal: cliente?.nombre_fiscal ?? '',
        direccion_fiscal: cliente?.direccion_fiscal ?? '',
        email: cliente?.email ?? '',
        telefono: cliente?.telefono ?? '',
        movil: cliente?.movil ?? '',
        direccion: cliente?.direccion ?? '',
        coordenadas: cliente?.coordenadas ?? '',
        zona: cliente?.zona_id ? String(cliente.zona_id) : SIN_ZONA,
        canal_preferido: cliente?.canal_preferido ?? 'correo',
        campos_personalizados: entradaCampos(campos, cliente?.campos_personalizados),
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
