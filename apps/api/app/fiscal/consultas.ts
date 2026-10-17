import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { ULTIMO_PAQUETE } from '#fiscal/instalador'

/**
 * Consultas de solo lectura de la localización (`GET /fiscal/localizaciones`,
 * `GET /fiscal/empresas/:id/localizacion`).
 */

export interface LocalizacionVista {
    codigo: string
    pais: string
    version: string
    publicada_en: string
    checksum: string
    /** la versión más reciente del país (la que instala `actualizar-localizacion` sin `codigo`) */
    mas_reciente: boolean
}

export async function listarLocalizaciones(
    cliente: QueryClientContract = db.connection(),
): Promise<LocalizacionVista[]> {
    const filas = (await cliente
        .from('fiscal.localizaciones')
        .orderBy([
            { column: 'pais', order: 'asc' },
            { column: 'codigo', order: 'asc' },
        ])
        .select(
            'codigo',
            'pais',
            'version',
            db.raw(`to_char(publicada_en, 'YYYY-MM-DD') as publicada_en`),
            'checksum',
        )) as Array<Omit<LocalizacionVista, 'mas_reciente'>>
    return filas.map((f) => ({
        ...f,
        pais: f.pais.trim(),
        mas_reciente: ULTIMO_PAQUETE[f.pais.trim()]?.codigo === f.codigo,
    }))
}

export interface InstalacionVista {
    id: number
    localizacion_codigo: string
    de_codigo: string | null
    instalada_en: string
    instalada_por: number | null
    instalada_por_nombre: string | null
    resumen: Record<string, unknown>
}

export interface LocalizacionEmpresa {
    empresa_id: number
    /** false: la empresa no tiene localización (las operaciones fiscales responden 422) */
    instalada: boolean
    pais: string | null
    codigo: string | null
    version: string | null
    /** versión más reciente disponible para su país */
    disponible: string | null
    actualizacion_disponible: boolean
    instalaciones: InstalacionVista[]
}

export async function verLocalizacionEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<LocalizacionEmpresa> {
    const empresa = (await cliente
        .from('core.empresas')
        .where('id', empresaId)
        .select('id', 'pais')
        .first()) as {
        pais: string
    } | null
    if (!empresa) throw new NoEncontrado(`La empresa ${empresaId} no existe`)
    const paisEmpresa = empresa.pais.trim()
    const filas = (await cliente
        .from('fiscal.instalaciones as i')
        .join('fiscal.localizaciones as l', 'l.codigo', 'i.localizacion_codigo')
        .leftJoin('core.usuarios as u', 'u.id', 'i.instalada_por')
        .where('i.empresa_id', empresaId)
        .orderBy('i.id', 'desc')
        .select(
            'i.id',
            'i.localizacion_codigo',
            'i.de_codigo',
            'i.instalada_en',
            'i.instalada_por',
            'u.nombre as instalada_por_nombre',
            'i.resumen',
            'l.pais',
            'l.version',
        )) as Array<
        Omit<InstalacionVista, 'instalada_en'> & { instalada_en: Date; pais: string; version: string }
    >
    const vigente = filas[0]
    const pais = vigente?.pais.trim() ?? null
    // la versión disponible es la del país actual de la empresa (core.empresas.pais)
    const disponible = ULTIMO_PAQUETE[paisEmpresa]?.codigo ?? null
    return {
        empresa_id: empresaId,
        instalada: Boolean(vigente),
        pais,
        codigo: vigente?.localizacion_codigo ?? null,
        version: vigente?.version ?? null,
        disponible,
        actualizacion_disponible:
            disponible !== null && disponible !== (vigente?.localizacion_codigo ?? null),
        instalaciones: filas.map((f) => ({
            id: Number(f.id),
            localizacion_codigo: f.localizacion_codigo,
            de_codigo: f.de_codigo,
            instalada_en: new Date(f.instalada_en).toISOString(),
            instalada_por: f.instalada_por === null ? null : Number(f.instalada_por),
            instalada_por_nombre: f.instalada_por_nombre,
            resumen: f.resumen,
        })),
    }
}
