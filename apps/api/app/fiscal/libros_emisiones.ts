import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { directorioComprobantes } from '#billing/comprobantes_archivos'
import { aXlsx } from '#billing/reportes/exportar'
import { definirColumnas, type Reporte } from '#billing/reportes/definicion'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import type { LibroHabilitable, LibroLegal } from '#fiscal/libros_legales'
import { libroPdf, type DatosOficiales, type EmpresaLibro } from '#fiscal/libros_pdf'

/**
 * Habilitaciones de folios y emisiones oficiales de los libros legales (contrato de localización
 * fiscal §3.7 y §7, fase 6 PR D). Las dos tablas son de solo inserción (trigger y `REVOKE`).
 *
 * - Los rangos habilitados de cada (empresa, libro) son correlativos: el siguiente empieza en el
 *   folio que sigue al último habilitado. Así «el siguiente folio del libro» es siempre
 *   `max(folio_final) + 1` de sus emisiones, o el primero habilitado.
 * - El archivo de cada emisión vive en el almacenamiento de archivos (`COMPROBANTES_DIR/libros/`),
 *   nunca en la base; la fila guarda su ruta, tamaño y SHA-256. La descarga vuelve a calcular la
 *   huella y responde 409 `archivo_alterado` si no coincide.
 */

/** Advisory lock de los folios de libros (primer entero; el segundo es la empresa). */
export const LOCK_LIBROS = 3031

/*
|--------------------------------------------------------------------------
| Habilitaciones
|--------------------------------------------------------------------------
*/

export interface HabilitacionVista {
    id: number
    empresa_id: number
    libro: LibroHabilitable
    tipo: 'computarizado'
    autorizacion: string
    folio_desde: number
    folio_hasta: number
    fecha: string
    nota: string | null
    /** folios de este rango ya usados por emisiones */
    usados: number
    disponibles: number
    registrado_por: number | null
    registrado_por_nombre: string | null
    created_at: Date
}

function consultaHabilitaciones(cliente: QueryClientContract) {
    return cliente
        .from('fiscal.libros_habilitados as h')
        .leftJoin('core.usuarios as u', 'u.id', 'h.registrado_por')
        .select(
            'h.id',
            'h.empresa_id',
            'h.libro',
            'h.tipo',
            'h.autorizacion',
            'h.folio_desde',
            'h.folio_hasta',
            cliente.raw(`to_char(h.fecha, 'YYYY-MM-DD') as fecha`),
            'h.nota',
            'h.registrado_por',
            'u.nombre as registrado_por_nombre',
            'h.created_at',
            cliente.raw(
                `greatest(0, least(h.folio_hasta, coalesce((select max(e.folio_final) from fiscal.libros_emisiones e
                  where e.empresa_id = h.empresa_id and e.libro = h.libro), 0)) - h.folio_desde + 1)::int as usados`,
            ),
        )
}

function aHabilitacion(f: Record<string, unknown>): HabilitacionVista {
    const desde = Number(f.folio_desde)
    const hasta = Number(f.folio_hasta)
    const usados = Number(f.usados)
    return {
        ...(f as unknown as HabilitacionVista),
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        folio_desde: desde,
        folio_hasta: hasta,
        usados,
        disponibles: hasta - desde + 1 - usados,
        registrado_por: f.registrado_por === null ? null : Number(f.registrado_por),
    }
}

export async function verHabilitacion(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaHabilitaciones(cliente).where('h.id', id).first()) as Record<
        string,
        unknown
    > | null
    if (!fila) throw new NoEncontrado(`La habilitación ${id} no existe`)
    return aHabilitacion(fila)
}

export async function listarHabilitaciones(
    filtros: OpcionesPaginacion & { libro?: LibroHabilitable },
    empresas: number[] | null,
) {
    const consulta = consultaHabilitaciones(db.connection()).if(filtros.libro, (q) =>
        q.where('h.libro', filtros.libro!),
    )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('h.empresa_id', ids))
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, {
        columna: 'h.id',
        clave: (f) => Number(f.id),
    })
    return { data: pagina.data.map(aHabilitacion), nextCursor: pagina.nextCursor }
}

export interface FoliosLibro {
    empresa_id: number
    libro: LibroHabilitable
    /** primer folio habilitado (null sin habilitaciones) */
    primero: number | null
    /** último folio habilitado */
    ultimo_habilitado: number | null
    /** último folio usado por una emisión */
    ultimo_usado: number | null
    /** el que tomará la próxima emisión (null sin habilitaciones) */
    siguiente: number | null
    disponibles: number
}

/** Estado de los folios de un libro: el siguiente y cuántos quedan habilitados. */
export async function foliosDe(
    cliente: QueryClientContract,
    empresaId: number,
    libro: LibroHabilitable,
): Promise<FoliosLibro> {
    const { rows } = (await cliente.rawQuery(
        `SELECT (SELECT min(folio_desde) FROM fiscal.libros_habilitados WHERE empresa_id = ? AND libro = ?) AS primero,
                (SELECT max(folio_hasta) FROM fiscal.libros_habilitados WHERE empresa_id = ? AND libro = ?) AS ultimo,
                (SELECT max(folio_final) FROM fiscal.libros_emisiones WHERE empresa_id = ? AND libro = ?) AS usado`,
        [empresaId, libro, empresaId, libro, empresaId, libro],
    )) as { rows: Array<{ primero: number | null; ultimo: number | null; usado: number | null }> }
    const n = (v: number | null) => (v === null ? null : Number(v))
    const primero = n(rows[0]!.primero)
    const ultimo = n(rows[0]!.ultimo)
    const usado = n(rows[0]!.usado)
    const siguiente = primero === null ? null : usado === null ? primero : usado + 1
    return {
        empresa_id: empresaId,
        libro,
        primero,
        ultimo_habilitado: ultimo,
        ultimo_usado: usado,
        siguiente,
        disponibles: siguiente === null || ultimo === null ? 0 : Math.max(0, ultimo - siguiente + 1),
    }
}

/*
|--------------------------------------------------------------------------
| Emisiones
|--------------------------------------------------------------------------
*/

export type FormatoEmision = 'pdf' | 'xlsx'

export interface EmisionVista {
    id: number
    empresa_id: number
    libro: LibroHabilitable
    desde: string
    hasta: string
    folio_inicial: number
    folio_final: number
    paginas: number
    formato: FormatoEmision
    tamano: number
    sha256: string
    filas: number
    totales: Record<string, unknown>
    ultimo_sello: number | null
    ultimo_hash: string | null
    reimpresion: boolean
    reimpresion_de: number | null
    generado_por: number | null
    generado_por_nombre: string | null
    generado_en: Date
}

function consultaEmisiones(cliente: QueryClientContract) {
    return cliente
        .from('fiscal.libros_emisiones as e')
        .leftJoin('core.usuarios as u', 'u.id', 'e.generado_por')
        .select(
            'e.id',
            'e.empresa_id',
            'e.libro',
            cliente.raw(`to_char(e.desde, 'YYYY-MM-DD') as desde`),
            cliente.raw(`to_char(e.hasta, 'YYYY-MM-DD') as hasta`),
            'e.folio_inicial',
            'e.folio_final',
            'e.paginas',
            'e.formato',
            'e.tamano',
            'e.sha256',
            'e.filas',
            'e.totales',
            'e.ultimo_sello',
            'e.ultimo_hash',
            'e.reimpresion_de',
            'e.generado_por',
            'u.nombre as generado_por_nombre',
            'e.generado_en',
        )
}

function aEmision(f: Record<string, unknown>): EmisionVista {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...(f as unknown as EmisionVista),
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        folio_inicial: Number(f.folio_inicial),
        folio_final: Number(f.folio_final),
        paginas: Number(f.paginas),
        tamano: Number(f.tamano),
        filas: Number(f.filas),
        ultimo_sello: n(f.ultimo_sello),
        reimpresion_de: n(f.reimpresion_de),
        reimpresion: f.reimpresion_de !== null && f.reimpresion_de !== undefined,
        generado_por: n(f.generado_por),
    }
}

export async function verEmision(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaEmisiones(cliente).where('e.id', id).first()) as Record<
        string,
        unknown
    > | null
    if (!fila) throw new NoEncontrado(`La emisión ${id} no existe`)
    return aEmision(fila)
}

export async function listarEmisiones(
    filtros: OpcionesPaginacion & { libro?: LibroHabilitable },
    empresas: number[] | null,
) {
    const consulta = consultaEmisiones(db.connection()).if(filtros.libro, (q) =>
        q.where('e.libro', filtros.libro!),
    )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('e.empresa_id', ids))
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, {
        columna: 'e.id',
        clave: (f) => Number(f.id),
    })
    return { data: pagina.data.map(aEmision), nextCursor: pagina.nextCursor }
}

export async function empresaDeEmision(id: number): Promise<number> {
    const fila = (await db.from('fiscal.libros_emisiones').where('id', id).select('empresa_id').first()) as {
        empresa_id: number
    } | null
    if (!fila) throw new NoEncontrado(`La emisión ${id} no existe`)
    return Number(fila.empresa_id)
}

/** Última emisión del libro cuyo rango se cruza con el dado (la que reimprime una nueva). */
export async function emisionQueCubre(
    cliente: QueryClientContract,
    empresaId: number,
    libro: LibroHabilitable,
    desde: string,
    hasta: string,
): Promise<{ id: number; folio_inicial: number; folio_final: number } | null> {
    const fila = (await cliente
        .from('fiscal.libros_emisiones')
        .where({ empresa_id: empresaId, libro })
        .where('desde', '<=', hasta)
        .where('hasta', '>=', desde)
        .orderBy('id', 'desc')
        .select('id', 'folio_inicial', 'folio_final')
        .first()) as { id: number; folio_inicial: number; folio_final: number } | null
    return fila
        ? {
              id: Number(fila.id),
              folio_inicial: Number(fila.folio_inicial),
              folio_final: Number(fila.folio_final),
          }
        : null
}

/*
|--------------------------------------------------------------------------
| Archivos
|--------------------------------------------------------------------------
*/

export const TIPOS_ARCHIVO: Record<FormatoEmision, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function directorioLibros(): string {
    return join(directorioComprobantes(), 'libros')
}

function absoluta(ruta: string): string {
    const raiz = resolve(directorioLibros())
    const destino = resolve(raiz, ruta)
    const rel = relative(raiz, destino)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
        throw new NoEncontrado('El archivo no existe')
    }
    return destino
}

export function sha256(contenido: Buffer): string {
    return createHash('sha256').update(contenido).digest('hex')
}

/** Escribe el archivo nuevo (`wx`: nunca reemplaza) y devuelve su ruta relativa. */
export async function guardarArchivo(
    empresaId: number,
    libro: string,
    formato: FormatoEmision,
    contenido: Buffer,
): Promise<string> {
    const ruta = `${empresaId}/${libro}/${randomUUID()}.${formato}`
    const destino = absoluta(ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, { flag: 'wx' })
    return ruta
}

export async function borrarArchivo(ruta: string): Promise<void> {
    await rm(absoluta(ruta), { force: true })
}

/** Contenido de la emisión; 409 `archivo_alterado` si su huella ya no es la registrada. */
export async function contenidoEmision(id: number) {
    const fila = (await db
        .from('fiscal.libros_emisiones')
        .where('id', id)
        .select('archivo', 'sha256', 'formato', 'libro', 'folio_inicial', 'folio_final')
        .first()) as {
        archivo: string
        sha256: string
        formato: FormatoEmision
        libro: string
        folio_inicial: number
        folio_final: number
    } | null
    if (!fila) throw new NoEncontrado(`La emisión ${id} no existe`)
    let contenido: Buffer
    try {
        contenido = await readFile(absoluta(fila.archivo))
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new NoEncontrado('El archivo de la emisión no está en el almacenamiento')
        }
        throw error
    }
    if (sha256(contenido) !== fila.sha256) {
        throw new Conflicto(
            `El archivo de la emisión ${id} no coincide con su SHA-256 registrado`,
            'archivo_alterado',
            'Archivo alterado',
        )
    }
    return {
        contenido,
        tipo: TIPOS_ARCHIVO[fila.formato],
        nombre: `libro-${fila.libro}-folios-${fila.folio_inicial}-${fila.folio_final}.${fila.formato}`,
    }
}

/*
|--------------------------------------------------------------------------
| Generación (vista previa y emisión)
|--------------------------------------------------------------------------
*/

export async function empresaDelLibroLegal(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<EmpresaLibro> {
    const fila = (await cliente
        .from('core.empresas')
        .where('id', empresaId)
        .select('razon_social', 'nombre_comercial', 'nit')
        .firstOrFail()) as { razon_social: string | null; nombre_comercial: string; nit: string | null }
    return { nombre: fila.razon_social || fila.nombre_comercial, nit: fila.nit }
}

const COLUMNA_FOLIO = definirColumnas([{ clave: 'folio', titulo: 'Folio', tipo: 'entero' }])

/** Renglones de encabezado del libro (los mismos del PDF) para el XLSX. */
function encabezadoXlsx(
    libro: LibroLegal,
    empresa: EmpresaLibro,
    oficial: DatosOficiales | null,
    folioFinal: number | null,
): string[] {
    const lineas = [
        empresa.nombre,
        `NIT: ${empresa.nit ?? '—'}`,
        libro.nombre_legal,
        `Periodo: del ${libro.desde} al ${libro.hasta}`,
    ]
    if (oficial) {
        lineas.push(`Folios ${oficial.folio_inicial} a ${folioFinal}`)
        if (oficial.reimpresion) {
            lineas.push(
                `REIMPRESIÓN · sustituye la emisión ${oficial.reimpresion.id} (folios ${oficial.reimpresion.folio_inicial} a ${oficial.reimpresion.folio_final})`,
            )
        }
        if (oficial.ultimo_hash) {
            lineas.push(
                `Cadena del libro: sello ${oficial.ultimo_sello ?? '—'} · hash ${oficial.ultimo_hash}`,
            )
        }
    } else {
        lineas.push('Borrador sin folio')
    }
    return lineas
}

export interface ArchivoLibro {
    contenido: Buffer
    paginas: number
}

/**
 * Archivo del libro. PDF: el documento paginado. XLSX: las mismas filas con el folio de la página
 * del PDF en que caen (primera columna) y el encabezado arriba; consume los mismos folios que el
 * PDF.
 */
export async function generarArchivoLibro(
    libro: LibroLegal,
    empresa: EmpresaLibro,
    formato: FormatoEmision,
    generadoEn: Date,
    oficial: DatosOficiales | null,
): Promise<ArchivoLibro> {
    const { pdf, paginas, paginaDeFila } = await libroPdf({
        libro,
        empresa,
        generado_en: generadoEn,
        oficial,
    })
    if (formato === 'pdf') return { contenido: pdf, paginas }
    const inicial = oficial?.folio_inicial ?? null
    const reporte: Reporte = {
        ...libro.reporte,
        titulo: oficial ? libro.nombre_legal : libro.reporte.titulo,
        columnas: oficial ? [...COLUMNA_FOLIO, ...libro.reporte.columnas] : libro.reporte.columnas,
        filas: libro.reporte.filas.map((fila, i) =>
            oficial ? { folio: inicial! + (paginaDeFila[i] ?? 0), ...fila } : fila,
        ),
        totales: oficial ? { folio: null, ...libro.reporte.totales } : libro.reporte.totales,
    }
    const final = inicial === null ? null : inicial + paginas - 1
    return {
        contenido: aXlsx(reporte, { encabezado: encabezadoXlsx(libro, empresa, oficial, final) }),
        paginas,
    }
}
