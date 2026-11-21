import { createHash, randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { SvgInvalido, sanearSvg } from '#core/svg'
import { borrarArchivoLogo, guardarArchivoLogo, leerArchivoLogo } from '#core/logos'

/**
 * Apariencia de la instalación (contrato `.claude/integration/contratos/apariencia.md`): tema del
 * panel y del portal, marca y archivos del inicio de sesión. Una sola fila global (`core.apariencia`,
 * id 1). El logo de cada empresa sigue en `core.empresas` (`#core/logos`).
 *
 * Los archivos van al mismo volumen que los logos de empresa (`COMPROBANTES_DIR/logos/apariencia/`),
 * con las mismas funciones de `#core/logos` (ruta relativa confinada a esa carpeta).
 */

/**
 * Presets de tema. `claro`/`oscuro`: hex del color primario en cada modo, con contraste AA (≥ 4.5:1)
 * verificado contra `#FFFFFF` y contra el fondo oscuro `#0B0F1A` (tabla en el contrato y prueba
 * `tests/core/apariencia.spec.ts`).
 */
export const TEMAS = [
    { id: 'indigo', nombre: 'Índigo', color: 'indigo', claro: '#4F46E5', oscuro: '#818CF8' },
    { id: 'azul', nombre: 'Azul', color: 'blue', claro: '#2563EB', oscuro: '#60A5FA' },
    { id: 'violeta', nombre: 'Violeta', color: 'violet', claro: '#7C3AED', oscuro: '#A78BFA' },
    { id: 'esmeralda', nombre: 'Esmeralda', color: 'emerald', claro: '#047857', oscuro: '#34D399' },
    { id: 'naranja', nombre: 'Naranja', color: 'orange', claro: '#C2410C', oscuro: '#FB923C' },
    { id: 'rosa', nombre: 'Rosa', color: 'pink', claro: '#BE185D', oscuro: '#F472B6' },
    { id: 'pizarra', nombre: 'Pizarra', color: 'slate', claro: '#475569', oscuro: '#94A3B8' },
] as const

export type IdTema = (typeof TEMAS)[number]['id']
export const IDS_TEMAS = TEMAS.map((t) => t.id) as IdTema[]
export const MODOS = ['sistema', 'claro', 'oscuro'] as const
export type Modo = (typeof MODOS)[number]

export const TEMA_POR_DEFECTO: IdTema = 'indigo'
export const NOMBRE_MARCA_POR_DEFECTO = 'ArgosIsp'

/** Archivos de la apariencia: logo y fondo del inicio de sesión. */
export type ArchivoApariencia = 'logo_login' | 'fondo_login'

export type TipoImagen = 'image/png' | 'image/svg+xml' | 'image/jpeg' | 'image/webp'

const EXTENSION: Record<TipoImagen, string> = {
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
}

/** Reglas por archivo: tipos admitidos y tamaño máximo. */
export const REGLAS_ARCHIVO: Record<ArchivoApariencia, { tipos: TipoImagen[]; maximo: number; prefijo: string }> =
    {
        logo_login: { tipos: ['image/png', 'image/svg+xml'], maximo: 512 * 1024, prefijo: 'logo-login' },
        fondo_login: {
            tipos: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'],
            maximo: 1536 * 1024,
            prefijo: 'fondo-login',
        },
    }

export interface ImagenPreparada {
    contenido: Buffer
    tipo: TipoImagen
    etag: string
}

function errorArchivo(message: string, rule: string): ValidacionFallida {
    return new ValidacionFallida([{ field: 'archivo', message, rule }])
}

function legibleKb(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

/** Tipo por firma (nunca por extensión ni `Content-Type`). Null si no es PNG, JPEG ni WebP. */
function tipoPorFirma(b: Buffer): TipoImagen | null {
    if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) {
        return 'image/png'
    }
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
        return 'image/webp'
    }
    return null
}

/**
 * Valida y normaliza un archivo subido: PNG/JPEG/WebP por firma o SVG saneado (`#core/svg`). 422 en
 * `archivo` (`required`, `tamano`, `tipo`, `svg`).
 */
export function prepararImagen(archivo: ArchivoApariencia, contenido: Uint8Array): ImagenPreparada {
    const reglas = REGLAS_ARCHIVO[archivo]
    if (contenido.length === 0) throw errorArchivo('Falta el archivo', 'required')
    if (contenido.length > reglas.maximo) {
        throw errorArchivo(
            `El archivo pesa ${legibleKb(contenido.length)}; el máximo es ${legibleKb(reglas.maximo)}`,
            'tamano',
        )
    }
    const buffer = Buffer.from(contenido)
    const admitidos = reglas.tipos.map((t) => EXTENSION[t].toUpperCase()).join(', ')
    const porFirma = tipoPorFirma(buffer)
    if (porFirma) {
        if (!reglas.tipos.includes(porFirma)) throw errorArchivo(`El archivo debe ser ${admitidos}`, 'tipo')
        return { contenido: buffer, tipo: porFirma, etag: huella(buffer) }
    }
    const texto = buffer.toString('utf8')
    if (!/<svg[\s>/]/i.test(texto)) throw errorArchivo(`El archivo debe ser ${admitidos}`, 'tipo')
    let saneado: string
    try {
        saneado = sanearSvg(texto)
    } catch (error) {
        if (error instanceof SvgInvalido) throw errorArchivo(`El SVG no es válido: ${error.message}`, 'svg')
        throw error
    }
    const limpio = Buffer.from(saneado, 'utf8')
    return { contenido: limpio, tipo: 'image/svg+xml', etag: huella(limpio) }
}

function huella(contenido: Buffer): string {
    return createHash('sha256').update(contenido).digest('hex')
}

/** Ruta relativa en el almacenamiento de logos (`#core/logos`). */
export function nuevaRutaArchivo(tipo: TipoImagen): string {
    return `apariencia/${randomUUID()}.${EXTENSION[tipo]}`
}

export { guardarArchivoLogo as guardarArchivoApariencia, borrarArchivoLogo as borrarArchivoApariencia }

/** Nombre público: `logo-login-<16 hex del sha256>.<ext>`. Cambia con el contenido. */
export function nombrePublico(archivo: ArchivoApariencia, etag: string, tipo: string): string {
    return `${REGLAS_ARCHIVO[archivo].prefijo}-${etag.slice(0, 16)}.${EXTENSION[tipo as TipoImagen] ?? 'bin'}`
}

export const RUTA_ARCHIVOS = '/api/v1/apariencia/archivos'

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface FilaApariencia {
    id: number
    tema: IdTema
    modo_predeterminado: Modo
    nombre_marca: string
    eslogan: string | null
    logo_login: string | null
    logo_login_tipo: string | null
    logo_login_tamano: number | null
    logo_login_etag: string | null
    fondo_login: string | null
    fondo_login_tipo: string | null
    fondo_login_tamano: number | null
    fondo_login_etag: string | null
    version: number
    updated_at: Date
}

export async function filaApariencia(cliente?: QueryClientContract, bloquear = false): Promise<FilaApariencia> {
    const q = (cliente ?? db).from('core.apariencia').where('id', 1).select('*')
    if (bloquear) q.forUpdate()
    const fila = (await q.first()) as FilaApariencia | null
    if (!fila) throw new NoEncontrado('La apariencia no está configurada (falta la migración)')
    return fila
}

export interface ArchivoInfo {
    url: string
    tipo: string
    tamano: number
    etag: string
}

export interface AparienciaPublica {
    tema: IdTema
    paleta: { color: string; claro: string; oscuro: string }
    modo_predeterminado: Modo
    nombre_marca: string
    eslogan: string | null
    logo_login_url: string | null
    fondo_login_url: string | null
    version: number
}

export interface AparienciaCompleta extends AparienciaPublica {
    logo_login: ArchivoInfo | null
    fondo_login: ArchivoInfo | null
    temas: Array<{ id: string; nombre: string; color: string; claro: string; oscuro: string }>
    updated_at: string
}

function archivoInfo(fila: FilaApariencia, archivo: ArchivoApariencia): ArchivoInfo | null {
    const etag = fila[`${archivo}_etag`]
    const tipo = fila[`${archivo}_tipo`]
    if (!fila[archivo] || !etag || !tipo) return null
    return {
        url: `${RUTA_ARCHIVOS}/${nombrePublico(archivo, etag, tipo)}`,
        tipo,
        tamano: fila[`${archivo}_tamano`] ?? 0,
        etag,
    }
}

export function temaDe(id: string) {
    return TEMAS.find((t) => t.id === id) ?? TEMAS[0]
}

export function aparienciaPublica(fila: FilaApariencia): AparienciaPublica {
    const tema = temaDe(fila.tema)
    return {
        tema: tema.id,
        paleta: { color: tema.color, claro: tema.claro, oscuro: tema.oscuro },
        modo_predeterminado: fila.modo_predeterminado,
        nombre_marca: fila.nombre_marca,
        eslogan: fila.eslogan,
        logo_login_url: archivoInfo(fila, 'logo_login')?.url ?? null,
        fondo_login_url: archivoInfo(fila, 'fondo_login')?.url ?? null,
        version: fila.version,
    }
}

export function aparienciaCompleta(fila: FilaApariencia): AparienciaCompleta {
    return {
        ...aparienciaPublica(fila),
        logo_login: archivoInfo(fila, 'logo_login'),
        fondo_login: archivoInfo(fila, 'fondo_login'),
        temas: TEMAS.map((t) => ({ ...t })),
        updated_at: new Date(fila.updated_at).toISOString(),
    }
}

export async function verApariencia(cliente?: QueryClientContract): Promise<AparienciaCompleta> {
    return aparienciaCompleta(await filaApariencia(cliente))
}

/** Archivo vigente por su nombre público; 404 si no es el logo ni el fondo actuales. */
export async function archivoVigente(
    nombre: string,
): Promise<{ etag: string; tipo: string; leer: () => Promise<Buffer> }> {
    const fila = await filaApariencia()
    for (const archivo of ['logo_login', 'fondo_login'] as const) {
        const ruta = fila[archivo]
        const etag = fila[`${archivo}_etag`]
        const tipo = fila[`${archivo}_tipo`]
        if (ruta && etag && tipo && nombrePublico(archivo, etag, tipo) === nombre) {
            return { etag, tipo, leer: () => leerArchivoLogo(ruta) }
        }
    }
    throw new NoEncontrado('El archivo no existe')
}
