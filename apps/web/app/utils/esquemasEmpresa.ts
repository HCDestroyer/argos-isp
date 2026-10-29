import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearEmpresaValidator` / `editarEmpresaValidator` (apps/api/app/core/validators.ts).
 * El formulario trabaja con strings (`''` = vacío → `null`). El dígito verificador del NIT lo
 * revisa la API (módulo 11); aquí solo la forma.
 */

/** NIT con dígito verificador (numérico o K) o CUI de 13 dígitos (una empresa no es CF). */
export const PATRON_NIT_EMPRESA = /^(\d{13}|\d{1,12}-?[0-9K])$/
export const PATRON_COLOR = /^#[0-9A-Fa-f]{6}$/

export const REGIMENES_ISR = {
    sujeto_pagos_trimestrales: 'Sujeto a pagos trimestrales',
    retencion_definitiva: 'Retención definitiva',
    pequeno_contribuyente: 'Pequeño contribuyente',
} as const satisfies Record<NonNullable<Schema<'EmpresaGrupo'>['regimen_isr']>, string>

export const SIN_REGIMEN = 'ninguno'

function textoOpcional(maximo: number) {
    return z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).transform(valor => valor || null)
}

export const esquemaEmpresaGrupo = z.object({
    nit: z.string()
        .trim()
        .toUpperCase()
        .refine(valor => PATRON_NIT_EMPRESA.test(valor), 'NIT con dígito verificador (1234567-8) o CUI de 13 dígitos'),
    razon_social: z.string().trim().min(1, 'Escribe la razón social, como aparece en el RTU').max(200, 'Máximo 200 caracteres'),
    nombre_comercial: z.string().trim().min(1, 'Escribe el nombre comercial').max(200, 'Máximo 200 caracteres'),
    direccion_fiscal: textoOpcional(300),
    municipio: textoOpcional(100),
    departamento: textoOpcional(100),
    telefono: textoOpcional(30),
    telefono_alterno: textoOpcional(30),
    whatsapp: textoOpcional(30),
    correo: z.string().trim()
        .refine(valor => valor === '' || z.email().safeParse(valor).success, 'Escribe un correo válido')
        .transform(valor => valor || null),
    sitio_web: z.string().trim()
        .refine(valor => valor === '' || /^https?:\/\/\S+$/.test(valor), 'Con http:// o https://')
        .transform(valor => valor || null),
    horario: textoOpcional(200),
    instrucciones_pago: textoOpcional(1000),
    color_marca: z.string().trim()
        .refine(valor => valor === '' || PATRON_COLOR.test(valor), 'Color #RRGGBB')
        .transform(valor => valor || null),
    regimen_isr: z.string().transform(valor => (valor === SIN_REGIMEN || valor === '' ? null : valor as keyof typeof REGIMENES_ISR)),
    codigo_establecimiento: z.string().trim()
        .refine(valor => valor === '' || (/^\d{1,6}$/.test(valor) && Number(valor) >= 1), 'Número de 1 a 999999')
        .transform(valor => (valor ? Number(valor) : null)),
})

export type EntradaEmpresaGrupo = z.input<typeof esquemaEmpresaGrupo>
export type SalidaEmpresaGrupo = z.output<typeof esquemaEmpresaGrupo>

/** Formulario vacío (alta) o con los datos de la empresa (edición). */
export function entradaEmpresaGrupo(empresa?: Schema<'EmpresaGrupo'> | null): EntradaEmpresaGrupo {
    return {
        nit: empresa?.nit ?? '',
        razon_social: empresa?.razon_social ?? '',
        nombre_comercial: empresa?.nombre_comercial ?? '',
        direccion_fiscal: empresa?.direccion_fiscal ?? '',
        municipio: empresa?.municipio ?? '',
        departamento: empresa?.departamento ?? '',
        telefono: empresa?.telefono ?? '',
        telefono_alterno: empresa?.telefono_alterno ?? '',
        whatsapp: empresa?.whatsapp ?? '',
        correo: empresa?.correo ?? '',
        sitio_web: empresa?.sitio_web ?? '',
        horario: empresa?.horario ?? '',
        instrucciones_pago: empresa?.instrucciones_pago ?? '',
        color_marca: empresa?.color_marca ?? '',
        regimen_isr: empresa?.regimen_isr ?? SIN_REGIMEN,
        codigo_establecimiento: empresa?.codigo_establecimiento ? String(empresa.codigo_establecimiento) : '',
    }
}
