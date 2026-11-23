import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema } from '#shared/errores'

/**
 * Autologin desde otro sistema (contrato Horus §1.5, lado receptor; Iris lo reutiliza, contrato
 * Iris §1.3). Argos recibe tickets; la emisión hacia Horus ("Ver en Horus") es de A6 y hacia Iris
 * ("Ver en Iris") está en `app/integraciones/iris`.
 *
 * - El **conector** es el sistema que pidió el ticket (`horus` o `iris`), identificado por su token de
 *   integración: el ticket queda ligado a ese token y deja de servir si el token se revoca.
 * - Un ticket dura `VIGENCIA_TICKET_S` y se usa una vez. Sin vinculación, el canje entrega un token
 *   de vinculación (`VIGENCIA_VINCULACION_S`, un uso) para completar el login normal.
 */

export const CONECTORES_SSO = ['horus', 'iris'] as const
export type ConectorSso = (typeof CONECTORES_SSO)[number]

/** Nombre visible del conector, para los mensajes. */
export const NOMBRES_CONECTOR_SSO: Record<ConectorSso, string> = { horus: 'Horus', iris: 'Iris' }

/** Nombre visible de un conector guardado (`horus` → `Horus`); el valor tal cual si no se conoce. */
export function nombreConectorSso(conector: string): string {
    return (NOMBRES_CONECTOR_SSO as Record<string, string>)[conector] ?? conector
}

/** Fila (única, `id = 1`) de cada conector: su `url_base` es el origen de la otra instalación. */
export const TABLAS_CONECTOR_SSO: Record<ConectorSso, string> = {
    horus: 'integraciones.horus_conector',
    iris: 'integraciones.iris_conector',
}

/**
 * Host (con puerto si no es el estándar del esquema) de una URL http(s); null si no hay o no se
 * entiende. Nunca devuelve el esquema, credenciales, ruta, consulta ni fragmento.
 */
export function hostDeUrl(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        const u = new URL(url.trim())
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
        // `URL.host` ya omite el puerto estándar (443/80) y nunca lleva usuario ni contraseña
        return u.host || null
    } catch {
        return null
    }
}

/**
 * Origen público (`https://host[:puerto]`) de una URL http(s); null si no hay o no se entiende.
 * Nunca lleva credenciales, ruta, consulta ni fragmento: sirve para mostrarla en una pantalla pública.
 */
export function origenDeUrl(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        const u = new URL(url.trim())
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
        // `URL.origin` es esquema + host (puerto solo si no es el estándar), sin usuario ni contraseña
        return u.host ? u.origin : null
    } catch {
        return null
    }
}

/**
 * Instalación del otro sistema que pidió el autologin: el host de la `url_base` de su conector
 * (p. ej. `iris.isp.example` o `horus.isp.example:8443`), o null si el conector no tiene
 * `url_base`. Se muestra en `/sso/entrar` antes de pedir el login, para que quien entra vea a qué
 * instalación le da acceso con su cuenta de Argos (un enlace reenviado vincularía la cuenta de
 * otra persona).
 */
export async function instalacionConector(
    conector: ConectorSso,
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    const fila = (await cliente
        .from(TABLAS_CONECTOR_SSO[conector])
        .where('id', 1)
        .select('url_base')
        .first()) as {
        url_base: string | null
    } | null
    return hostDeUrl(fila?.url_base)
}

/**
 * Destinos que Argos abre (contrato §1.5, 1.7.0): `cliente` y `servicio` con el id de Argos. Los
 * tipos `router` y `hallazgo` llevan ids de Horus y solo existen con Horus como destino.
 */
export const TIPOS_DESTINO_SSO = ['cliente', 'servicio'] as const
export type TipoDestinoSso = (typeof TIPOS_DESTINO_SSO)[number]

/**
 * Id de un usuario de Iris (`usuario.id_externo` del ticket y `<id>` de `X-Iris-Actor:
 * usuario:<id>`): el mismo formato en los dos, para que la vinculación sirva a la actuación.
 */
export const FORMATO_ID_EXTERNO_IRIS = /^[A-Za-z0-9_-]{1,64}$/

export const VIGENCIA_TICKET_S = 60
export const VIGENCIA_VINCULACION_S = 600

export function generarSecretoSso(): { valor: string; hash: string } {
    const valor = randomBytes(32).toString('base64url')
    return { valor, hash: hashSecretoSso(valor) }
}

export function hashSecretoSso(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
}

/** Ruta del panel cuando el ticket no trae destino (Iris 0.7.0: «Vincular mi usuario de Argos»). */
export const RUTA_INICIO_PANEL = '/'

/**
 * Ruta local del panel para el destino (`id_externo` del otro sistema = id de Argos). Sin destino
 * (solo tickets de Iris), el inicio del panel.
 */
export function rutaDestino(tipo: TipoDestinoSso | null, idExterno: string | null): string {
    if (tipo === null || idExterno === null) return RUTA_INICIO_PANEL
    const rutas: Record<TipoDestinoSso, string> = {
        cliente: '/clientes/',
        servicio: '/servicios/',
    }
    return `${rutas[tipo]}${encodeURIComponent(idExterno)}`
}

/**
 * URL pública del panel (`PANEL_URL_PUBLICA`, sin `/` final). Sin ella, en desarrollo y pruebas
 * `http://localhost:3000`; en producción 503 `sso_no_configurado`.
 */
export function urlPanel(entorno: NodeJS.ProcessEnv = process.env): string {
    const valor = entorno.PANEL_URL_PUBLICA?.trim()
    if (valor) return valor.replace(/\/+$/, '')
    if (entorno.NODE_ENV === 'production') {
        throw new Problema(
            503,
            'sso_no_configurado',
            'Autologin sin configurar',
            'Define PANEL_URL_PUBLICA (URL pública del panel) para emitir tickets de autologin',
        )
    }
    return 'http://localhost:3000'
}

/** Ticket vencido, usado, desconocido o de un conector que ya no está conectado. */
export class TicketInvalido extends Problema {
    constructor(detalle: string) {
        super(410, 'ticket_invalido', 'Ticket de autologin inválido', detalle)
    }
}

/** Token de vinculación vencido, usado o desconocido. */
export class VinculacionInvalida extends Problema {
    constructor(detalle: string) {
        super(410, 'vinculacion_invalida', 'Vinculación vencida', detalle)
    }
}

export interface VinculacionVista {
    id: number
    conector: string
    id_externo: string
    usuario_id: number
    correo_externo: string | null
    nombre_externo: string | null
    revocada_en: string | null
    created_at: string
}

const COLUMNAS_VINCULACION = [
    'id',
    'conector',
    'id_externo',
    'usuario_id',
    'correo_externo',
    'nombre_externo',
    'revocada_en',
    'created_at',
]

/** Vinculaciones vigentes de un usuario (las suyas en `GET /me/vinculaciones`). */
export async function vinculacionesDeUsuario(
    usuarioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VinculacionVista[]> {
    return (await cliente
        .from('core.vinculaciones_externas')
        .where('usuario_id', usuarioId)
        .whereNull('revocada_en')
        .select(COLUMNAS_VINCULACION)
        .orderBy('id', 'desc')) as VinculacionVista[]
}

export async function verVinculacion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<VinculacionVista | null> {
    return ((await cliente
        .from('core.vinculaciones_externas')
        .where('id', id)
        .select(COLUMNAS_VINCULACION)
        .first()) ?? null) as VinculacionVista | null
}
