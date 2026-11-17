import type { Schema } from '@argosisp/contracts'

/**
 * Páginas públicas de políticas (revisión de apps de Meta / WhatsApp Business). Rutas fijas: Meta
 * pide URLs estables para «Política de privacidad», «Condiciones del servicio» e «Instrucciones
 * para la eliminación de datos».
 */
export interface EnlacePolitica {
    to: '/privacidad' | '/terminos' | '/eliminar-datos'
    label: string
}

export const POLITICAS: EnlacePolitica[] = [
    { to: '/privacidad', label: 'Privacidad' },
    { to: '/terminos', label: 'Términos' },
    { to: '/eliminar-datos', label: 'Eliminar mis datos' },
]

/** Versión y vigencia del texto: al cambiarlo, sube la versión y la fecha. */
export const VERSION_POLITICAS = '1.0'
export const VIGENCIA_POLITICAS = '17 de noviembre de 2026'

/** Plazo máximo para responder una solicitud de eliminación o de acceso a los datos. */
export const PLAZO_RESPUESTA_DIAS = 30

/** Cómo se nombra a la empresa en el texto si no se pudo leer su configuración. */
export const EMPRESA_GENERICA = 'la empresa que te presta el servicio de Internet'

type EmpresaPolitica = Pick<Schema<'EmpresaPublica'>, 'nombre' | 'razon_social'>

/** Nombre legal (razón social) si está configurado; si no, el comercial. */
export function nombreLegal(empresa: EmpresaPolitica | null): string {
    if (!empresa) {
        return EMPRESA_GENERICA
    }
    return empresa.razon_social?.trim() || empresa.nombre
}

/** «Red Altiplano, S.A. (Red Altiplano)»: el legal y, si es otro, el comercial entre paréntesis. */
export function nombreCompleto(empresa: EmpresaPolitica | null): string {
    const legal = nombreLegal(empresa)
    return empresa && legal !== empresa.nombre ? `${legal} (${empresa.nombre})` : legal
}
