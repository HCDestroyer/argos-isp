import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { SQL_EMPRESA_FACTURA } from '#portal/marca'

/**
 * Anuncios del portal (contrato `.claude/integration/contratos/anuncios.md`). Lecturas y reglas que
 * comparten las acciones (`actions/*_anuncio.ts`), el panel y el portal.
 */

export const ESTADOS_ANUNCIO = ['borrador', 'publicado', 'archivado'] as const
export type EstadoAnuncio = (typeof ESTADOS_ANUNCIO)[number]
export const AUDIENCIAS = ['todos', 'suspendidos', 'con_puntos', 'al_dia'] as const
export type Audiencia = (typeof AUDIENCIAS)[number]
export const LUGARES = ['portal_inicio', 'pagina_corte'] as const
export type Lugar = (typeof LUGARES)[number]

/** Cuántos anuncios devuelve el portal por lugar (el carrusel no necesita más). */
export const MAXIMO_EN_PORTAL = 8

interface FilaAnuncio {
    id: number
    empresa_id: number
    titulo: string
    texto: string
    imagen: string | null
    imagen_tipo: string | null
    imagen_etag: string | null
    imagen_ancho: number | null
    imagen_alto: number | null
    imagen_alt: string | null
    boton_texto: string | null
    boton_url: string | null
    inicio: Date | null
    fin: Date | null
    audiencia: Audiencia
    lugares: Lugar[]
    orden: number
    estado: EstadoAnuncio
    publicado_en: Date | null
    archivado_en: Date | null
    creado_por: number | null
    version: number
    created_at: Date
    updated_at: Date
}

/** Espejo del schema `Anuncio` (panel). Nunca expone la ruta interna del archivo. */
export interface AnuncioVista {
    id: number
    empresa_id: number
    titulo: string
    texto: string
    imagen: { url: string; tipo: string; ancho: number; alto: number; alt: string | null } | null
    boton: { texto: string; url: string } | null
    inicio: Date | null
    fin: Date | null
    audiencia: Audiencia
    lugares: Lugar[]
    orden: number
    estado: EstadoAnuncio
    /** publicado y dentro de su vigencia ahora */
    vigente: boolean
    publicado_en: Date | null
    archivado_en: Date | null
    creado_por: number | null
    version: number
    created_at: Date
    updated_at: Date
}

/** Espejo del schema `PortalAnuncio`: lo mínimo para pintar la tarjeta. */
export interface PortalAnuncioVista {
    id: number
    empresa_id: number
    titulo: string
    texto: string
    imagen: { url: string; ancho: number; alto: number; alt: string } | null
    boton: { texto: string; url: string } | null
}

export function filaAnuncio(fila: FilaAnuncio): FilaAnuncio {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
    }
}

function vigenteAhora(f: FilaAnuncio, ahora = new Date()): boolean {
    return (
        f.estado === 'publicado' &&
        (f.inicio === null || f.inicio.getTime() <= ahora.getTime()) &&
        (f.fin === null || f.fin.getTime() > ahora.getTime())
    )
}

export function vistaAnuncio(f: FilaAnuncio): AnuncioVista {
    return {
        id: f.id,
        empresa_id: f.empresa_id,
        titulo: f.titulo,
        texto: f.texto,
        imagen:
            f.imagen && f.imagen_tipo && f.imagen_etag
                ? {
                      url: `/api/v1/anuncios/${f.id}/imagen?v=${f.imagen_etag.slice(0, 16)}`,
                      tipo: f.imagen_tipo,
                      ancho: Number(f.imagen_ancho),
                      alto: Number(f.imagen_alto),
                      alt: f.imagen_alt,
                  }
                : null,
        boton: f.boton_texto && f.boton_url ? { texto: f.boton_texto, url: f.boton_url } : null,
        inicio: f.inicio,
        fin: f.fin,
        audiencia: f.audiencia,
        lugares: f.lugares,
        orden: f.orden,
        estado: f.estado,
        vigente: vigenteAhora(f),
        publicado_en: f.publicado_en,
        archivado_en: f.archivado_en,
        creado_por: f.creado_por,
        version: f.version,
        created_at: f.created_at,
        updated_at: f.updated_at,
    }
}

function vistaPortal(f: FilaAnuncio): PortalAnuncioVista {
    return {
        id: f.id,
        empresa_id: f.empresa_id,
        titulo: f.titulo,
        texto: f.texto,
        imagen:
            f.imagen && f.imagen_etag
                ? {
                      url: `/api/v1/portal/anuncios/${f.id}/imagen?v=${f.imagen_etag.slice(0, 16)}`,
                      ancho: Number(f.imagen_ancho),
                      alto: Number(f.imagen_alto),
                      // publicar exige el texto alternativo; por si acaso, el título
                      alt: f.imagen_alt ?? f.titulo,
                  }
                : null,
        boton: f.boton_texto && f.boton_url ? { texto: f.boton_texto, url: f.boton_url } : null,
    }
}

/** Fila con bloqueo opcional (las acciones la leen `FOR UPDATE`). */
export async function filaDeAnuncio(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<FilaAnuncio> {
    const consulta = cliente.from('core.anuncios').where('id', id)
    if (bloquear) consulta.forUpdate()
    const fila = (await consulta.first()) as FilaAnuncio | null
    if (!fila) throw new NoEncontrado(`El anuncio ${id} no existe`)
    return filaAnuncio(fila)
}

export async function verAnuncio(id: number, cliente: QueryClientContract = db.connection()) {
    return vistaAnuncio(await filaDeAnuncio(id, cliente))
}

export interface FiltrosAnuncios extends OpcionesPaginacion {
    empresas: number[] | null
    estado?: EstadoAnuncio
}

export async function listarAnuncios(filtros: FiltrosAnuncios): Promise<Pagina<AnuncioVista>> {
    const consulta = db
        .from('core.anuncios')
        .if(filtros.empresas !== null, (q) => q.whereIn('empresa_id', filtros.empresas!))
        .if(filtros.estado, (q) => q.where('estado', filtros.estado!))
        .select('*')
    const pagina = await paginar<FilaAnuncio>(consulta, filtros)
    return { data: pagina.data.map((f) => vistaAnuncio(filaAnuncio(f))), nextCursor: pagina.nextCursor }
}

/**
 * URL del botón: `http(s)://` sin usuario ni contraseña, o una ruta interna del portal (`/cuenta`,
 * `/corte#pagar`). Nada de `javascript:`, `data:`, `//otro.sitio` ni barras invertidas.
 */
export function urlBotonValida(url: string): boolean {
    if (url.length === 0 || url.length > 500 || /[\s\\]/.test(url)) return false
    if (url.startsWith('/')) return !url.startsWith('//')
    let destino: URL
    try {
        destino = new URL(url)
    } catch {
        return false
    }
    return (
        (destino.protocol === 'https:' || destino.protocol === 'http:') &&
        destino.username === '' &&
        destino.password === '' &&
        destino.hostname !== ''
    )
}

export interface CamposAnuncio {
    titulo?: string
    texto?: string
    imagen_alt?: string | null
    boton_texto?: string | null
    boton_url?: string | null
    inicio?: Date | null
    fin?: Date | null
    audiencia?: Audiencia
    lugares?: Lugar[]
    orden?: number
}

/** Reglas que el validador VineJS no puede ver solo (combinaciones de campos). 422 por campo. */
export function validarCombinacion(final: {
    boton_texto: string | null
    boton_url: string | null
    inicio: Date | null
    fin: Date | null
    lugares: Lugar[]
}): void {
    const errores: Array<{ field: string; message: string; rule: string }> = []
    if ((final.boton_texto === null) !== (final.boton_url === null)) {
        errores.push({
            field: final.boton_texto === null ? 'boton_texto' : 'boton_url',
            message: 'El botón necesita texto y dirección, o ninguno de los dos',
            rule: 'boton',
        })
    }
    if (final.boton_url !== null && !urlBotonValida(final.boton_url)) {
        errores.push({
            field: 'boton_url',
            message: 'Usa una dirección http:// o https://, o una ruta del portal que empiece con /',
            rule: 'url',
        })
    }
    if (final.inicio && final.fin && final.fin.getTime() <= final.inicio.getTime()) {
        errores.push({ field: 'fin', message: 'El fin debe ser después del inicio', rule: 'despues' })
    }
    if (new Set(final.lugares).size !== final.lugares.length) {
        errores.push({ field: 'lugares', message: 'Cada lugar una sola vez', rule: 'unico' })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
}

/*
|--------------------------------------------------------------------------
| Portal: qué anuncios ve un cliente
|--------------------------------------------------------------------------
*/

/** Situación del cliente en una empresa, para decidir la audiencia. */
export interface SituacionCliente {
    empresaId: number
    /** algún servicio suspendido o limitado (corte por deuda) */
    suspendido: boolean
    /** alguna factura vencida con saldo */
    conVencidas: boolean
    puntos: number
}

export function audienciaAplica(audiencia: Audiencia, s: SituacionCliente): boolean {
    switch (audiencia) {
        case 'todos':
            return true
        case 'suspendidos':
            return s.suspendido
        case 'al_dia':
            return !s.suspendido && !s.conVencidas
        case 'con_puntos':
            return s.puntos > 0
    }
}

/**
 * Situación del cliente en cada empresa donde tiene servicios no retirados (o solo en `empresaId`).
 * Lee servicios y facturas (A1, A3) y el saldo de puntos (`lealtad.movimientos`, A3), sin escribir.
 */
export async function situacionesDelCliente(
    clienteId: number,
    empresaId?: number,
): Promise<SituacionCliente[]> {
    const servicios = (await db
        .from('core.servicios as s')
        .where('s.cliente_id', clienteId)
        .whereNot('s.estado', 'retirado')
        .if(empresaId !== undefined, (q) => q.whereRaw('coalesce(s.empresa_id, 1) = ?', [empresaId!]))
        .groupByRaw('coalesce(s.empresa_id, 1)')
        .select(
            db.raw('coalesce(s.empresa_id, 1)::int as empresa_id'),
            db.raw(`bool_or(s.estado IN ('suspendido', 'limitado')) as suspendido`),
        )) as Array<{ empresa_id: number; suspendido: boolean }>
    if (servicios.length === 0) return []
    const empresas = servicios.map((s) => Number(s.empresa_id))

    const vencidas = (await db
        .from('billing.facturas as f')
        .join('core.servicios as s', 's.id', 'f.servicio_id')
        .where('f.cliente_id', clienteId)
        .whereIn('f.estado', ['emitida', 'parcial', 'vencida'])
        .whereRaw(`(f.estado = 'vencida' OR f.vence_en < (now() AT TIME ZONE ?)::date)`, [ZONA_NEGOCIO])
        .whereRaw('f.total > f.pagado')
        .whereRaw(`${SQL_EMPRESA_FACTURA} = ANY(?)`, [empresas])
        .groupByRaw(SQL_EMPRESA_FACTURA)
        .select(db.raw(`${SQL_EMPRESA_FACTURA}::int as empresa_id`))) as Array<{ empresa_id: number }>
    const conVencidas = new Set(vencidas.map((v) => Number(v.empresa_id)))

    const puntos = (await db
        .from('lealtad.movimientos')
        .where('cliente_id', clienteId)
        .whereIn('empresa_id', empresas)
        .groupBy('empresa_id')
        .select('empresa_id', db.raw('sum(puntos)::int as saldo'))) as Array<{
        empresa_id: number
        saldo: number
    }>
    const saldo = new Map(puntos.map((p) => [Number(p.empresa_id), Number(p.saldo)]))

    return servicios.map((s) => ({
        empresaId: Number(s.empresa_id),
        suspendido: s.suspendido === true,
        conVencidas: conVencidas.has(Number(s.empresa_id)),
        puntos: saldo.get(Number(s.empresa_id)) ?? 0,
    }))
}

/**
 * Anuncios publicados y vigentes en `lugar` para un cliente: los de las empresas de sus servicios
 * cuya audiencia le aplica, por `orden` y más nuevos primero. Sin cliente, ninguno (el portal no
 * muestra promociones a quien no identificó: la página queda igual que sin anuncios).
 */
export async function anunciosParaCliente(
    clienteId: number | null,
    lugar: Lugar,
    empresaId?: number,
): Promise<PortalAnuncioVista[]> {
    if (clienteId === null) return []
    const situaciones = await situacionesDelCliente(clienteId, empresaId)
    if (situaciones.length === 0) return []
    const porEmpresa = new Map(situaciones.map((s) => [s.empresaId, s]))
    const filas = (await db
        .from('core.anuncios')
        .whereIn('empresa_id', [...porEmpresa.keys()])
        .where('estado', 'publicado')
        .whereRaw('? = ANY(lugares)', [lugar])
        .where((q) => q.whereNull('inicio').orWhere('inicio', '<=', db.raw('now()')))
        .where((q) => q.whereNull('fin').orWhere('fin', '>', db.raw('now()')))
        .orderBy('orden', 'desc')
        .orderBy('id', 'desc')
        .limit(MAXIMO_EN_PORTAL * 4)) as FilaAnuncio[]
    return filas
        .map(filaAnuncio)
        .filter((f) => audienciaAplica(f.audiencia, porEmpresa.get(f.empresa_id)!))
        .slice(0, MAXIMO_EN_PORTAL)
        .map(vistaPortal)
}

/** Anuncio publicado y vigente (para su imagen y sus eventos en el portal); 404 si no. */
export async function anuncioVigente(id: number): Promise<FilaAnuncio> {
    const fila = await filaDeAnuncio(id).catch(() => null)
    if (!fila || !vigenteAhora(fila)) throw new NoEncontrado('El anuncio no existe')
    return fila
}

/*
|--------------------------------------------------------------------------
| Métricas
|--------------------------------------------------------------------------
*/

export interface MetricasAnuncio {
    anuncio_id: number
    vistas: number
    clics: number
    por_lugar: Array<{ lugar: Lugar; vistas: number; clics: number }>
    /** últimos 30 días, fecha de Guatemala, solo los días con algo */
    por_dia: Array<{ dia: string; vistas: number; clics: number }>
}

export async function metricasDeAnuncio(id: number): Promise<MetricasAnuncio> {
    await filaDeAnuncio(id)
    const vistas = db.raw(`count(*) FILTER (WHERE tipo = 'vista')::int as vistas`)
    const clics = db.raw(`count(*) FILTER (WHERE tipo = 'clic')::int as clics`)
    const [total] = (await db
        .from('core.anuncios_eventos')
        .where('anuncio_id', id)
        .select(vistas, clics)) as Array<{ vistas: number; clics: number }>
    const lugares = (await db
        .from('core.anuncios_eventos')
        .where('anuncio_id', id)
        .groupBy('lugar')
        .orderBy('lugar')
        .select('lugar', vistas, clics)) as Array<{
        lugar: Lugar
        vistas: number
        clics: number
    }>
    const dias = (await db
        .from('core.anuncios_eventos')
        .where('anuncio_id', id)
        .whereRaw(`created_at >= now() - interval '30 days'`)
        .groupByRaw('1')
        .orderByRaw('1')
        .select(
            db.raw(`to_char((created_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') as dia`, [ZONA_NEGOCIO]),
            vistas,
            clics,
        )) as Array<{ dia: string; vistas: number; clics: number }>
    return {
        anuncio_id: id,
        vistas: Number(total?.vistas ?? 0),
        clics: Number(total?.clics ?? 0),
        por_lugar: lugares.map((l) => ({ lugar: l.lugar, vistas: Number(l.vistas), clics: Number(l.clics) })),
        por_dia: dias.map((d) => ({ dia: d.dia, vistas: Number(d.vistas), clics: Number(d.clics) })),
    }
}
