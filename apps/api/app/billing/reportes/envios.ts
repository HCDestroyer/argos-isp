import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { NoEncontrado } from '#shared/errores'
import { ZONA_NEGOCIO } from '#ledger/fechas'

/**
 * Envíos programados de reportes (decisión 6 del PM; `contratos/reportes.md` §5): lecturas y el
 * cálculo de la próxima hora. Las escrituras son acciones (`reportes.programar_envio`,
 * `reportes.editar_envio`, `reportes.ejecutar_envio`, `reportes.aprobar_correo_externo`,
 * `reportes.retirar_correo_externo`).
 */

export type Frecuencia = 'diaria' | 'semanal' | 'mensual'

/**
 * Siguiente hora programada estrictamente después de `desde` (hora de Guatemala): diaria a la
 * `hora`; semanal el `dia` (1 lunes … 7 domingo); mensual el `dia` (1 a 28) del mes.
 */
export function proximoEnvio(frecuencia: Frecuencia, dia: number | null, hora: number, desde: Date): Date {
    const base = DateTime.fromJSDate(desde).setZone(ZONA_NEGOCIO)
    let candidato = base.set({ hour: hora, minute: 0, second: 0, millisecond: 0 })
    const despues = (c: DateTime) => c.toMillis() > base.toMillis()
    if (frecuencia === 'diaria') {
        if (!despues(candidato)) candidato = candidato.plus({ days: 1 })
    } else if (frecuencia === 'semanal') {
        const objetivo = dia ?? 1
        candidato = candidato.plus({ days: (objetivo - candidato.weekday + 7) % 7 })
        if (!despues(candidato)) candidato = candidato.plus({ weeks: 1 })
    } else {
        candidato = candidato.set({ day: dia ?? 1 })
        if (!despues(candidato)) candidato = candidato.plus({ months: 1 }).set({ day: dia ?? 1 })
    }
    return candidato.toUTC().toJSDate()
}

export interface DestinatarioEnvio {
    id: number
    tipo: 'usuario' | 'correo_externo'
    usuario_id: number | null
    correo_externo_id: number | null
    /** nombre del usuario o del contacto externo */
    nombre: string | null
    /** correo del usuario o el aprobado */
    correo: string | null
    /** el correo externo fue retirado de la lista (no recibe) */
    retirado: boolean
}

export interface EnvioReporte {
    id: number
    empresa_id: number | null
    nombre: string
    reporte: string
    filtros: Record<string, unknown>
    formato: 'pdf' | 'xlsx' | 'csv'
    frecuencia: Frecuencia
    dia: number | null
    hora: number
    activo: boolean
    proximo_en: string
    ultimo_envio_en: string | null
    creado_por: number | null
    destinatarios: DestinatarioEnvio[]
    version: number
    created_at: string
    updated_at: string
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

async function destinatarios(c: QueryClientContract, envioIds: number[]) {
    if (envioIds.length === 0) return new Map<number, DestinatarioEnvio[]>()
    const filas = (await c
        .from('billing.reportes_envios_destinatarios as d')
        .leftJoin('core.usuarios as u', 'u.id', 'd.usuario_id')
        .leftJoin('billing.reportes_correos_externos as x', 'x.id', 'd.correo_externo_id')
        .whereIn('d.envio_id', envioIds)
        .orderBy('d.id', 'asc')
        .select(
            'd.id',
            'd.envio_id',
            'd.usuario_id',
            'd.correo_externo_id',
            c.raw('coalesce(u.nombre, x.nombre) as nombre'),
            c.raw('coalesce(u.email, x.correo) as correo'),
            c.raw('coalesce(x.activo, true) as vigente'),
        )) as Array<Record<string, unknown>>
    const mapa = new Map<number, DestinatarioEnvio[]>()
    for (const f of filas) {
        const lista = mapa.get(Number(f.envio_id)) ?? []
        lista.push({
            id: Number(f.id),
            tipo: f.usuario_id ? 'usuario' : 'correo_externo',
            usuario_id: f.usuario_id ? Number(f.usuario_id) : null,
            correo_externo_id: f.correo_externo_id ? Number(f.correo_externo_id) : null,
            nombre: (f.nombre as string | null) ?? null,
            correo: (f.correo as string | null) ?? null,
            retirado: !f.vigente,
        })
        mapa.set(Number(f.envio_id), lista)
    }
    return mapa
}

function serializar(f: Record<string, unknown>, dest: DestinatarioEnvio[]): EnvioReporte {
    return {
        id: Number(f.id),
        empresa_id: f.empresa_id === null ? null : Number(f.empresa_id),
        nombre: String(f.nombre),
        reporte: String(f.reporte),
        filtros: (f.filtros as Record<string, unknown>) ?? {},
        formato: f.formato as EnvioReporte['formato'],
        frecuencia: f.frecuencia as Frecuencia,
        dia: f.dia === null ? null : Number(f.dia),
        hora: Number(f.hora),
        activo: Boolean(f.activo),
        proximo_en: iso(f.proximo_en)!,
        ultimo_envio_en: iso(f.ultimo_envio_en),
        creado_por: f.creado_por === null ? null : Number(f.creado_por),
        destinatarios: dest,
        version: Number(f.version),
        created_at: iso(f.created_at)!,
        updated_at: iso(f.updated_at)!,
    }
}

export async function verEnvio(id: number, c: QueryClientContract = db.connection()): Promise<EnvioReporte> {
    const fila = (await c.from('billing.reportes_envios').where('id', id).first()) as Record<
        string,
        unknown
    > | null
    if (!fila) throw new NoEncontrado(`El envío programado ${id} no existe`)
    const mapa = await destinatarios(c, [id])
    return serializar(fila, mapa.get(id) ?? [])
}

/**
 * Envíos de las empresas pedidas (null = todas). Los consolidados (`empresa_id` null) solo con
 * `consolidados` (alcance global).
 */
export async function listarEnvios(
    filtros: { activo?: boolean; reporte?: string },
    empresas: number[] | null,
    consolidados: boolean,
): Promise<{ data: EnvioReporte[] }> {
    const filas = (await db
        .from('billing.reportes_envios')
        .if(filtros.activo !== undefined, (q) => q.where('activo', filtros.activo!))
        .if(filtros.reporte, (q) => q.where('reporte', filtros.reporte!))
        .where((w) => {
            if (empresas === null) w.whereNotNull('empresa_id')
            else w.whereIn('empresa_id', empresas)
            if (consolidados) w.orWhereNull('empresa_id')
        })
        .orderBy('id', 'asc')
        .select('*')) as Array<Record<string, unknown>>
    const dest = await destinatarios(
        db.connection(),
        filas.map((f) => Number(f.id)),
    )
    return { data: filas.map((f) => serializar(f, dest.get(Number(f.id)) ?? [])) }
}

/** Ids de los envíos activos cuya hora ya llegó (todo lo pendiente hasta `ahora`). */
export async function enviosPendientes(ahora: Date, limite = 500): Promise<number[]> {
    const filas = (await db
        .from('billing.reportes_envios')
        .where('activo', true)
        .where('proximo_en', '<=', ahora)
        .orderBy('proximo_en', 'asc')
        .limit(limite)
        .select('id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

export interface CorridaEnvio {
    id: number
    envio_id: number
    programado_para: string
    enviados: number
    omitidos: number
    fallidos: number
    resultados: ResultadoDestinatario[]
    created_at: string
}

export interface ResultadoDestinatario {
    destinatario_id: number
    tipo: 'usuario' | 'correo_externo'
    usuario_id: number | null
    correo_externo_id: number | null
    estado: 'enviado' | 'omitido' | 'fallido'
    /** código: sin_permiso, alcance_parcial, sin_acceso_empresa, usuario_inactivo, sin_correo, correo_retirado, no_compartible, sin_responsable, filtros_invalidos, sin_smtp, error_envio */
    motivo: string | null
    detalle: string | null
}

export async function corridasDeEnvio(envioId: number, limite = 20): Promise<{ data: CorridaEnvio[] }> {
    const filas = (await db
        .from('billing.reportes_envios_corridas')
        .where('envio_id', envioId)
        .orderBy('id', 'desc')
        .limit(limite)
        .select('*')) as Array<Record<string, unknown>>
    return {
        data: filas.map((f) => ({
            id: Number(f.id),
            envio_id: Number(f.envio_id),
            programado_para: iso(f.programado_para)!,
            enviados: Number(f.enviados),
            omitidos: Number(f.omitidos),
            fallidos: Number(f.fallidos),
            resultados: (f.resultados as ResultadoDestinatario[]) ?? [],
            created_at: iso(f.created_at)!,
        })),
    }
}

export interface CorreoExterno {
    id: number
    correo: string
    nombre: string
    activo: boolean
    aprobado_por: number | null
    aprobado_en: string
    retirado_por: number | null
    retirado_en: string | null
    version: number
}

export function serializarCorreo(f: Record<string, unknown>): CorreoExterno {
    return {
        id: Number(f.id),
        correo: String(f.correo),
        nombre: String(f.nombre),
        activo: Boolean(f.activo),
        aprobado_por: f.aprobado_por === null ? null : Number(f.aprobado_por),
        aprobado_en: iso(f.aprobado_en)!,
        retirado_por: f.retirado_por === null ? null : Number(f.retirado_por),
        retirado_en: iso(f.retirado_en),
        version: Number(f.version),
    }
}

export async function listarCorreosExternos(activo?: boolean): Promise<{ data: CorreoExterno[] }> {
    const filas = (await db
        .from('billing.reportes_correos_externos')
        .if(activo !== undefined, (q) => q.where('activo', activo!))
        .orderBy('correo', 'asc')
        .select('*')) as Array<Record<string, unknown>>
    return { data: filas.map(serializarCorreo) }
}

export async function empresaDeEnvio(id: number): Promise<number | null> {
    const fila = (await db.from('billing.reportes_envios').where('id', id).select('empresa_id').first()) as {
        empresa_id: number | null
    } | null
    if (!fila) throw new NoEncontrado(`El envío programado ${id} no existe`)
    return fila.empresa_id === null ? null : Number(fila.empresa_id)
}
