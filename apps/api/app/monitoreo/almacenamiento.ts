import { opendir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { redis } from '#shared/redis'
import { directorioComprobantes } from '#billing/comprobantes_archivos'
import {
    conTimeout,
    estadoDisco,
    leerEspacioVolumen,
    usoDisco,
    type EstadoComponente,
} from '#monitoreo/salud'

/**
 * Almacenamiento (`GET /api/v1/sistema/almacenamiento`, contrato `salud.md` §6; pedido del PM:
 * «control de qué se está almacenando y cuánto espacio está ocupando»).
 *
 * - El desglose (carpetas, base de datos, Redis) se calcula con presupuesto de tiempo en la acción
 *   `sistema.recalcular_almacenamiento` (botón y cron diario de `notify:worker`) y se guarda en
 *   `core.almacenamiento_mediciones` (una fila por cálculo, nunca se edita). La ruta GET devuelve el
 *   último cálculo y el espacio de los volúmenes leído en el momento (barato). Sin TTL: el dato vale
 *   hasta el siguiente cálculo y lleva su `calculado_en`.
 * - Nunca borra nada.
 */

export const DIAS_CRECIMIENTO = 30

let raizFijada: string | undefined

/** Solo pruebas: otra carpeta de datos en lugar de `COMPROBANTES_DIR`. Sin argumento, la real. */
export function fijarRaizDatos(ruta?: string) {
    raizFijada = ruta
}

/** Carpeta raíz de los archivos (`COMPROBANTES_DIR`): comprobantes, logos, anuncios, inventario… */
export function raizDatos(): string {
    return raizFijada ?? directorioComprobantes()
}
export const TOP_TABLAS = 10

/** Subcarpetas de `COMPROBANTES_DIR` con dueño conocido; lo demás cae en «comprobantes». */
const SUBCARPETAS: Array<{ id: string; carpeta: string; nombre: string }> = [
    { id: 'logos', carpeta: 'logos', nombre: 'Logos y fondos (empresas e inicio de sesión)' },
    { id: 'anuncios', carpeta: 'anuncios', nombre: 'Imágenes de anuncios del portal' },
    { id: 'inventario', carpeta: 'inventario', nombre: 'Adjuntos de inventario y facturas de compra' },
    { id: 'libros', carpeta: 'libros', nombre: 'Libros legales emitidos (PDF)' },
    { id: 'sorteos', carpeta: 'sorteos', nombre: 'Documentos de sorteos' },
]

export interface ArchivoMayor {
    nombre: string
    bytes: number
}

export interface Categoria {
    id: string
    nombre: string
    /** ruta relativa a `COMPROBANTES_DIR` o absoluta (respaldos) */
    ruta: string | null
    estado: 'completo' | 'parcial' | 'no_disponible'
    bytes: number
    archivos: number
    crecimiento_30d_bytes: number | null
    crecimiento_30d_archivos: number | null
    mayor: ArchivoMayor | null
    aviso: string | null
}

export interface TablaTamano {
    schema: string
    tabla: string
    bytes: number
}

export interface BaseDatos {
    tamano_bytes: number | null
    por_schema: Array<{ schema: string; bytes: number }>
    tablas_mayores: TablaTamano[]
    aviso: string | null
}

export interface MemoriaRedis {
    usada_bytes: number | null
    pico_bytes: number | null
    maxima_bytes: number | null
    aviso: string | null
}

export interface Volumen {
    id: 'datos' | 'base'
    nombre: string
    ruta: string | null
    total_bytes: number | null
    usado_bytes: number | null
    libre_bytes: number | null
    porcentaje_usado: number | null
    estado: EstadoComponente
    aviso: string | null
}

export interface Medicion {
    id: number
    calculado_en: string
    duracion_ms: number
    origen: 'manual' | 'cron'
    parcial: boolean
    categorias: Categoria[]
    base_datos: BaseDatos
    redis: MemoriaRedis
    volumen_datos: Volumen
}

/*
|--------------------------------------------------------------------------
| Recorrido de carpetas con presupuesto
|--------------------------------------------------------------------------
*/

interface Acumulado {
    bytes: number
    archivos: number
    recientesBytes: number
    recientesArchivos: number
    mayor: ArchivoMayor | null
    completo: boolean
}

/**
 * Recorre `raiz` (iterativo, sin seguir enlaces) sumando tamaños hasta `limite` (epoch ms). Las
 * carpetas de `excluir` (absolutas) no se recorren. Si se acaba el tiempo, `completo: false`.
 */
export async function recorrer(raiz: string, limite: number, excluir: string[] = []): Promise<Acumulado> {
    const acc: Acumulado = {
        bytes: 0,
        archivos: 0,
        recientesBytes: 0,
        recientesArchivos: 0,
        mayor: null,
        completo: true,
    }
    const corte = Date.now() - DIAS_CRECIMIENTO * 86_400_000
    const pendientes = [raiz]
    while (pendientes.length > 0) {
        if (Date.now() > limite) {
            acc.completo = false
            break
        }
        const dir = pendientes.pop()!
        let handle
        try {
            handle = await opendir(dir)
        } catch (error) {
            if (dir === raiz) throw error
            continue
        }
        for await (const entrada of handle) {
            const ruta = join(dir, entrada.name)
            if (entrada.isDirectory()) {
                if (!excluir.includes(ruta)) pendientes.push(ruta)
            } else if (entrada.isFile()) {
                try {
                    const info = await stat(ruta)
                    acc.bytes += info.size
                    acc.archivos++
                    // los archivos de Argos se escriben una vez: la fecha de modificación es la de creación
                    if (info.mtimeMs >= corte) {
                        acc.recientesBytes += info.size
                        acc.recientesArchivos++
                    }
                    if (!acc.mayor || info.size > acc.mayor.bytes) {
                        acc.mayor = { nombre: relative(raiz, ruta), bytes: info.size }
                    }
                } catch {
                    // borrado mientras se recorría
                }
            }
            if (Date.now() > limite) {
                acc.completo = false
                break
            }
        }
    }
    return acc
}

async function categoria(
    def: { id: string; nombre: string; ruta: string | null; absoluta: string | null },
    limite: number,
    excluir: string[] = [],
): Promise<Categoria> {
    const base: Categoria = {
        id: def.id,
        nombre: def.nombre,
        ruta: def.ruta,
        estado: 'no_disponible',
        bytes: 0,
        archivos: 0,
        crecimiento_30d_bytes: null,
        crecimiento_30d_archivos: null,
        mayor: null,
        aviso: null,
    }
    if (!def.absoluta) return { ...base, aviso: 'La carpeta no está configurada en la API' }
    try {
        const acc = await recorrer(def.absoluta, limite, excluir)
        return {
            ...base,
            estado: acc.completo ? 'completo' : 'parcial',
            bytes: acc.bytes,
            archivos: acc.archivos,
            crecimiento_30d_bytes: acc.recientesBytes,
            crecimiento_30d_archivos: acc.recientesArchivos,
            mayor: acc.mayor,
            aviso: acc.completo ? null : 'Se acabó el tiempo del cálculo: los totales son un mínimo',
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { ...base, estado: 'completo', crecimiento_30d_bytes: 0, crecimiento_30d_archivos: 0 }
        }
        return { ...base, aviso: 'No se pudo leer la carpeta' }
    }
}

/** Carpeta de respaldos locales (`BACKUP_DIR`, la de `infra/backups/respaldar.sh`). */
export function directorioRespaldos(): string | null {
    return process.env.BACKUP_DIR?.trim() || null
}

export async function categoriasArchivos(limite: number): Promise<Categoria[]> {
    const raiz = raizDatos()
    const propias = SUBCARPETAS.map((s) => join(raiz, s.carpeta))
    // en serie: el presupuesto se reparte por orden; lo que no alcance queda `parcial`
    const salida: Categoria[] = []
    salida.push(
        await categoria(
            { id: 'comprobantes', nombre: 'Comprobantes de depósito', ruta: '.', absoluta: raiz },
            limite,
            propias,
        ),
    )
    for (const s of SUBCARPETAS) {
        salida.push(
            await categoria(
                { id: s.id, nombre: s.nombre, ruta: s.carpeta, absoluta: join(raiz, s.carpeta) },
                limite,
            ),
        )
    }
    const respaldos = directorioRespaldos()
    salida.push(
        await categoria(
            { id: 'respaldos', nombre: 'Respaldos locales', ruta: respaldos, absoluta: respaldos },
            limite,
        ),
    )
    return salida
}

/*
|--------------------------------------------------------------------------
| Base de datos y Redis
|--------------------------------------------------------------------------
*/

/**
 * Tamaño de la base, por schema y las 10 tablas más grandes (las particiones suman a su tabla
 * raíz). Con el rol de la app (`argosisp_app`) `pg_total_relation_size` funciona sin privilegios
 * especiales; si algo falla, se devuelve lo que se pudo con `aviso`.
 */
export async function tamanoBaseDatos(cliente: QueryClientContract = db.connection()): Promise<BaseDatos> {
    const salida: BaseDatos = { tamano_bytes: null, por_schema: [], tablas_mayores: [], aviso: null }
    try {
        const { rows } = (await cliente.rawQuery(
            'SELECT pg_database_size(current_database())::bigint AS bytes',
        )) as { rows: Array<{ bytes: string }> }
        salida.tamano_bytes = Number(rows[0]!.bytes)
    } catch {
        salida.aviso = 'No se pudo leer el tamaño total de la base (permiso CONNECT)'
    }
    try {
        const { rows } = (await cliente.rawQuery(
            `WITH rel AS (
                 SELECT coalesce(pg_partition_root(c.oid), c.oid) AS raiz,
                        pg_total_relation_size(c.oid) AS bytes
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.relkind IN ('r', 'm')
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                    AND n.nspname NOT LIKE 'pg_temp%'
             )
             SELECT n.nspname AS schema, c.relname AS tabla, sum(rel.bytes)::bigint AS bytes
               FROM rel
               JOIN pg_class c ON c.oid = rel.raiz
               JOIN pg_namespace n ON n.oid = c.relnamespace
              GROUP BY 1, 2
              ORDER BY 3 DESC`,
        )) as { rows: Array<{ schema: string; tabla: string; bytes: string }> }
        const porSchema = new Map<string, number>()
        for (const r of rows) porSchema.set(r.schema, (porSchema.get(r.schema) ?? 0) + Number(r.bytes))
        salida.por_schema = [...porSchema.entries()]
            .map(([schema, bytes]) => ({ schema, bytes }))
            .sort((a, b) => b.bytes - a.bytes)
        salida.tablas_mayores = rows
            .slice(0, TOP_TABLAS)
            .map((r) => ({ schema: r.schema, tabla: r.tabla, bytes: Number(r.bytes) }))
    } catch {
        salida.aviso = [salida.aviso, 'No se pudo leer el tamaño de las tablas'].filter(Boolean).join(' · ')
    }
    return salida
}

/** `INFO memory` de Redis. */
export async function memoriaRedis(): Promise<MemoriaRedis> {
    try {
        const info = await conTimeout(redis().info('memory'))
        const campo = (nombre: string) => {
            const m = new RegExp(`^${nombre}:(\\d+)`, 'm').exec(info)
            return m ? Number(m[1]) : null
        }
        const maxima = campo('maxmemory')
        return {
            usada_bytes: campo('used_memory'),
            pico_bytes: campo('used_memory_peak'),
            maxima_bytes: maxima && maxima > 0 ? maxima : null,
            aviso: null,
        }
    } catch {
        return { usada_bytes: null, pico_bytes: null, maxima_bytes: null, aviso: 'Redis no respondió' }
    }
}

/*
|--------------------------------------------------------------------------
| Volúmenes (en el momento)
|--------------------------------------------------------------------------
*/

export async function volumenDatos(): Promise<Volumen> {
    const ruta = raizDatos()
    try {
        const { total, libre } = await conTimeout(leerEspacioVolumen(ruta))
        return {
            id: 'datos',
            nombre: 'Volumen de datos (comprobantes, logos y documentos)',
            ruta,
            total_bytes: total,
            usado_bytes: total - libre,
            libre_bytes: libre,
            porcentaje_usado: Math.round(usoDisco(total, libre) * 1000) / 10,
            estado: estadoDisco(total, libre),
            aviso: null,
        }
    } catch {
        return {
            id: 'datos',
            nombre: 'Volumen de datos (comprobantes, logos y documentos)',
            ruta,
            total_bytes: null,
            usado_bytes: null,
            libre_bytes: null,
            porcentaje_usado: null,
            estado: 'desconocido',
            aviso: 'No se pudo leer el espacio del volumen',
        }
    }
}

/**
 * Volumen de la base: solo se puede medir si la carpeta de datos de Postgres es visible desde la
 * API (mismo host, sin Docker de por medio) y el rol puede leer `data_directory`. Si no, solo el
 * tamaño de la base (`base_datos.tamano_bytes`) con aviso.
 */
export async function volumenBase(): Promise<Volumen> {
    const base: Volumen = {
        id: 'base',
        nombre: 'Volumen de la base de datos',
        ruta: null,
        total_bytes: null,
        usado_bytes: null,
        libre_bytes: null,
        porcentaje_usado: null,
        estado: 'desconocido',
        aviso: 'La carpeta de datos de PostgreSQL no es visible desde la API (otro contenedor o servidor)',
    }
    try {
        const { rows } = (await conTimeout(
            db.rawQuery(`SELECT current_setting('data_directory', true) AS dir`),
        )) as { rows: Array<{ dir: string | null }> }
        const dir = rows[0]?.dir
        if (!dir) return base
        await stat(dir)
        const { total, libre } = await conTimeout(leerEspacioVolumen(dir))
        return {
            ...base,
            ruta: dir,
            total_bytes: total,
            usado_bytes: total - libre,
            libre_bytes: libre,
            porcentaje_usado: Math.round(usoDisco(total, libre) * 1000) / 10,
            estado: estadoDisco(total, libre),
            aviso: null,
        }
    } catch {
        return base
    }
}

/*
|--------------------------------------------------------------------------
| Lectura de la última medición
|--------------------------------------------------------------------------
*/

interface FilaMedicion {
    id: number
    calculado_en: Date
    duracion_ms: number
    origen: 'manual' | 'cron'
    parcial: boolean
    resultado: Pick<Medicion, 'categorias' | 'base_datos' | 'redis' | 'volumen_datos'>
}

export function medicionDeFila(fila: FilaMedicion): Medicion {
    return {
        id: Number(fila.id),
        calculado_en: new Date(fila.calculado_en).toISOString(),
        duracion_ms: fila.duracion_ms,
        origen: fila.origen,
        parcial: fila.parcial,
        ...fila.resultado,
    }
}

export async function ultimaMedicion(
    cliente: QueryClientContract = db.connection(),
): Promise<Medicion | null> {
    const fila = (await cliente
        .from('core.almacenamiento_mediciones')
        .orderBy('id', 'desc')
        .select('*')
        .first()) as FilaMedicion | null
    return fila ? medicionDeFila(fila) : null
}

export interface AlmacenamientoRespuesta {
    volumenes: Volumen[]
    medicion: Medicion | null
}

/** Respuesta de `GET /sistema/almacenamiento`: volúmenes en el momento + último cálculo. */
export async function verAlmacenamiento(): Promise<AlmacenamientoRespuesta> {
    const [datos, base, medicion] = await Promise.all([volumenDatos(), volumenBase(), ultimaMedicion()])
    return { volumenes: [datos, base], medicion }
}
