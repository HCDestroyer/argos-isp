import type { Problem } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Revisión de titular empresa (contrato Iris 0.14.1, A1) y verificación del NIT: etiquetas,
 * esquemas espejo de los validadores y los textos de cada error de la API.
 */

type Estado = 'pendiente' | 'aprobada' | 'rechazada' | 'reemplazada'

export const ESTADOS_REVISION_TITULAR: Record<Estado, { etiqueta: string, plural: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    pendiente: { etiqueta: 'Pendiente', plural: 'Pendientes', color: 'warning', icono: 'i-lucide-hourglass' },
    aprobada: { etiqueta: 'Aprobada', plural: 'Aprobadas', color: 'success', icono: 'i-lucide-circle-check' },
    rechazada: { etiqueta: 'Rechazada', plural: 'Rechazadas', color: 'error', icono: 'i-lucide-circle-x' },
    reemplazada: { etiqueta: 'Reemplazada', plural: 'Reemplazadas', color: 'neutral', icono: 'i-lucide-replace' },
}

/** Las pestañas de la lista (la API también tiene `reemplazada`: se ve en la fila, no tiene pestaña). */
export const PESTANAS_REVISION_TITULAR = ['pendiente', 'aprobada', 'rechazada'] as const

export function esEstadoRevisionTitular(valor: unknown): valor is Estado {
    return typeof valor === 'string' && valor in ESTADOS_REVISION_TITULAR
}

export const MOTIVOS_REVISION_TITULAR: Record<'representante_nuevo' | 'varios_candidatos', { etiqueta: string, descripcion: string }> = {
    representante_nuevo: {
        etiqueta: 'Representante nuevo',
        descripcion: 'La empresa existe con su NIT verificado, pero esta persona no está registrada como su representante.',
    },
    varios_candidatos: {
        etiqueta: 'Varias empresas con ese NIT',
        descripcion: 'Hay más de un cliente empresa con este NIT verificado: elige a cuál pasa el servicio.',
    },
}

export const DOCUMENTOS_REPRESENTANTE: Record<'dpi' | 'pasaporte', string> = {
    dpi: 'DPI',
    pasaporte: 'Pasaporte',
}

/** NIT normalizado (`33445567`) con el guion del dígito verificador: `3344556-7`. */
export function formatearNitNormalizado(nit: string): string {
    return nit.length > 1 ? `${nit.slice(0, -1)}-${nit.slice(-1)}` : nit
}

/** Espejo de `aprobarTitularEmpresaValidator` y `rechazarTitularEmpresaValidator` (A1): motivo 10–500. */
export const esquemaMotivoRevision = z.string().trim()
    .min(10, 'Escribe el motivo (al menos 10 caracteres)')
    .max(500, 'Máximo 500 caracteres')

export const esquemaRechazarTitular = z.object({ motivo: esquemaMotivoRevision })

/** Con varios candidatos el cliente es obligatorio (la API responde 422 en `cliente_id`). */
export function esquemaAprobarTitular(variosCandidatos: boolean) {
    return z.object({
        cliente_id: variosCandidatos
            ? z.number({ error: 'Elige la empresa a la que pasa el servicio' }).int().positive('Elige la empresa a la que pasa el servicio')
            : z.number().int().positive().optional(),
        motivo: esquemaMotivoRevision,
    })
}

export type EntradaAprobarTitular = { cliente_id: number | undefined, motivo: string }

export const METODOS_VERIFICAR_NIT: Record<'documento' | 'consulta_sat', { etiqueta: string, descripcion: string }> = {
    documento: { etiqueta: 'Documento a la vista', descripcion: 'Viste el RTU o la patente de comercio con este NIT.' },
    consulta_sat: { etiqueta: 'Consulta en la SAT', descripcion: 'Consultaste el NIT en la SAT y el nombre coincide.' },
}

/** El código del Problem (`urn:argosisp:problema:<codigo>`), o `null`. */
function codigoDe(problema: Problem): string | null {
    const prefijo = 'urn:argosisp:problema:'
    return problema.type.startsWith(prefijo) ? problema.type.slice(prefijo.length) : null
}

/** 409: otra persona cambió la revisión o el titular; hay que volver a leerla. */
export function esConflictoRevision(problema: Problem | null): boolean {
    return problema?.status === 409
}

/** El texto para la persona de cada error de aprobar o rechazar (con el `detail` de la API si no se conoce). */
export function mensajeErrorRevision(problema: Problem): string {
    switch (codigoDe(problema)) {
        case 'conflicto_version':
            return 'Otra persona cambió esta revisión mientras la veías. Vuelve a cargarla y revisa antes de decidir.'
        case 'titular_ya_cambiado':
            return 'El titular del servicio ya cambió desde que se pidió la revisión. Vuelve a cargarla.'
        case 'revision_no_pendiente':
            return 'Esta revisión ya se decidió. Vuelve a cargarla para ver cómo quedó.'
        case 'servicio_no_pendiente':
            return 'El servicio ya no está pendiente de instalación: el titular solo se cambia antes de instalar.'
        case 'candidato_no_valido':
            return 'Esa empresa ya no tiene ese NIT verificado. Revisa su ficha o elige otra.'
        default:
            return problema.detail ?? problema.title
    }
}

/** Texto de un error al verificar el NIT. */
export function mensajeErrorVerificarNit(problema: Problem): string {
    switch (codigoDe(problema)) {
        case 'conflicto_version':
            return 'Alguien editó este cliente mientras lo veías. Vuelve a cargar la ficha y verifica de nuevo.'
        case 'nit_no_verificable':
            return 'El cliente no tiene un NIT válido para verificar. Corrígelo en «Editar» primero.'
        default:
            return problema.detail ?? problema.title
    }
}
