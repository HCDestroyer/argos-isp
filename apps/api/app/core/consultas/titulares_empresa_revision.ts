import db from '@adonisjs/lucid/services/db'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Revisiones de cambios de titular a una empresa (contrato Iris 0.14.1 §3.4.4): las que quedaron en
 * `422 titular_empresa_en_revision`. La lista **no** lleva datos del representante (salvo el tipo de
 * documento): se ven en el detalle, con `clientes.ver_identidad` y cada vista auditada.
 */
export interface RevisionTitularEmpresaResumen {
    id: number
    empresa_id: number
    servicio_id: number
    de_cliente_id: number
    candidatos: number[]
    motivo_revision: 'representante_nuevo' | 'varios_candidatos'
    estado: 'pendiente' | 'aprobada' | 'rechazada' | 'reemplazada'
    razon_social: string
    nit: string
    representante_documento_tipo: 'dpi' | 'pasaporte'
    motivo_codigo: string
    origen_tipo: string | null
    origen_id: string | null
    cliente_asignado_id: number | null
    decidida_por: number | null
    decidida_en: string | null
    version: number
    created_at: string
}

export const COLUMNAS_REVISION = [
    'id',
    'empresa_id',
    'servicio_id',
    'de_cliente_id',
    'candidatos',
    'motivo_revision',
    'estado',
    'razon_social',
    'nit',
    'representante_documento_tipo',
    'motivo_codigo',
    'origen_tipo',
    'origen_id',
    'cliente_asignado_id',
    'decidida_por',
    'decidida_en',
    'version',
    'created_at',
] as const

export function normalizarRevision(fila: Record<string, any>): RevisionTitularEmpresaResumen {
    return {
        ...(fila as RevisionTitularEmpresaResumen),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        servicio_id: Number(fila.servicio_id),
        de_cliente_id: Number(fila.de_cliente_id),
        candidatos: (fila.candidatos as Array<string | number>).map(Number),
        cliente_asignado_id: fila.cliente_asignado_id === null ? null : Number(fila.cliente_asignado_id),
        decidida_por: fila.decidida_por === null ? null : Number(fila.decidida_por),
        decidida_en: fila.decidida_en ? new Date(fila.decidida_en).toISOString() : null,
        version: Number(fila.version),
        created_at: new Date(fila.created_at).toISOString(),
    }
}

export async function listarRevisionesTitularEmpresa(
    filtros: OpcionesPaginacion & { estado?: string },
    empresas: number[] | null,
): Promise<Pagina<RevisionTitularEmpresaResumen>> {
    const consulta = db
        .from('core.titulares_empresa_revision as r')
        .select(COLUMNAS_REVISION.map((c) => `r.${c}`))
    if (filtros.estado) consulta.where('r.estado', filtros.estado)
    if (empresas !== null) consulta.whereIn('r.empresa_id', empresas)
    const pagina = await paginar<Record<string, any>>(consulta, filtros, { columna: 'r.id' })
    return { ...pagina, data: pagina.data.map(normalizarRevision) }
}
