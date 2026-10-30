import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { VIGENCIA_ENLACE_MIN, hashCodigo } from '#integraciones/horus/actions/generar_enlace_horus'
import { leerFilaIris, permiteHttpIris } from '#integraciones/iris/configuracion'
import { usuarioIris } from '#core/integraciones_iris'
import { empresasDelAlcance, type EmpresaDelAlcance } from '#integraciones/iris/actions/canjear_enlace_iris'

/**
 * «Conectar con un botón» (contrato Iris 0.4.0, §1.4): reglas del origen de Iris, PKCE S256 y el
 * código de conexión compartido con el enlace de §1.3 (`integraciones.iris_enlaces`).
 */

/** Ruta de Iris a la que vuelve el panel de Argos tras aprobar o rechazar (§1.4 paso 4). */
export const RUTA_VUELTA_IRIS = '/administracion/integraciones/argos/vuelta'

/** `code_challenge` S256: base64url sin relleno de los 32 bytes de un SHA-256. */
const FORMATO_CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

// ── Errores 422 de §1.4 ──────────────────────────────────────────────────────────────────────

export class IrisOrigenInvalido extends Problema {
    constructor(detalle: string) {
        super(422, 'iris_origen_invalido', 'Origen de Iris inválido', detalle, [
            { field: 'iris', message: detalle, rule: 'origen' },
        ])
    }
}

export class IrisOrigenNoConfirmado extends Problema {
    constructor(host: string) {
        const detalle = `Iris en ${host} no es un origen conocido: escribe su dominio (${host}) para confirmar`
        super(422, 'iris_origen_no_confirmado', 'Confirma el origen de Iris', detalle, [
            { field: 'confirmar_origen', message: detalle, rule: 'confirmar' },
        ])
    }
}

export class CodeChallengeInvalido extends Problema {
    constructor() {
        const detalle = 'code_challenge debe ser base64url de 43 caracteres (SHA-256 del code_verifier, S256)'
        super(422, 'code_challenge_invalido', 'code_challenge inválido', detalle, [
            { field: 'code_challenge', message: detalle, rule: 'formato' },
        ])
    }
}

/** 401 del canje: el código nació con `code_challenge` y el verifier falta o no coincide. */
export class CodigoInvalido extends Problema {
    /** `gastar`: el código aún no se había canjeado y queda inservible (`gastarCodigoIris`). */
    constructor(
        readonly enlaceId: number,
        readonly gastar = true,
    ) {
        super(
            401,
            'codigo_invalido',
            'Código de conexión inválido',
            'El code_verifier falta o no coincide con el code_challenge; el código quedó gastado',
        )
    }
}

// ── Origen de Iris ───────────────────────────────────────────────────────────────────────────

/**
 * Normaliza el origen de Iris a `https://host[:puerto]` (host en minúsculas, sin puerto por
 * defecto). `http://` solo con `IRIS_PERMITIR_HTTP`. Sin usuario, contraseña, ruta, consulta ni
 * fragmento (se tolera una `/` final).
 */
export function normalizarOrigenIris(
    valor: string,
): { origen: string; host: string; error: null } | { origen: null; host: null; error: string } {
    let url: URL
    try {
        url = new URL(valor.trim())
    } catch {
        return { origen: null, host: null, error: 'No es una URL válida' }
    }
    if (url.protocol === 'http:' && !permiteHttpIris()) {
        return {
            origen: null,
            host: null,
            error: 'Solo https:// (http:// solo en laboratorio con IRIS_PERMITIR_HTTP)',
        }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { origen: null, host: null, error: 'Solo https://' }
    }
    if (!url.hostname) return { origen: null, host: null, error: 'Falta el dominio de Iris' }
    if (url.username || url.password) {
        return { origen: null, host: null, error: 'La URL no lleva usuario ni contraseña' }
    }
    if (url.search || url.hash || valor.includes('#') || valor.includes('?')) {
        return { origen: null, host: null, error: 'La URL no lleva consulta ni fragmento' }
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        return {
            origen: null,
            host: null,
            error: 'Se espera el origen de Iris (https://host[:puerto]), sin ruta',
        }
    }
    return { origen: url.origin, host: url.host, error: null }
}

/** Orígenes de `ARGOSISP_IRIS_ORIGENES` (separados por espacios), normalizados; se ignoran los inválidos. */
export function origenesIrisDeEntorno(valor = process.env.ARGOSISP_IRIS_ORIGENES ?? ''): string[] {
    return valor
        .split(/\s+/)
        .filter(Boolean)
        .map((o) => normalizarOrigenIris(o).origen)
        .filter((o): o is string => o !== null)
}

/** Si el origen coincide con la URL del conector Iris configurado o con `ARGOSISP_IRIS_ORIGENES`. */
export async function esOrigenIrisConocido(
    origen: string,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    if (origenesIrisDeEntorno().includes(origen)) return true
    const fila = await leerFilaIris(cliente)
    if (!fila?.url_base) return false
    try {
        return new URL(fila.url_base).origin === origen
    } catch {
        return false
    }
}

/** El admin escribió el dominio de Iris: igual al host (con puerto si lo lleva), sin distinguir mayúsculas. */
export function origenConfirmado(host: string, confirmar: string | null | undefined): boolean {
    if (!confirmar) return false
    return confirmar.trim().toLowerCase() === host.toLowerCase()
}

// ── PKCE ─────────────────────────────────────────────────────────────────────────────────────

export function codeChallengeValido(valor: string): boolean {
    return FORMATO_CODE_CHALLENGE.test(valor)
}

/** `base64url(SHA-256(verifier)) === challenge`, en tiempo constante. */
export function verifierCoincide(verifier: string | null | undefined, challenge: string): boolean {
    if (!verifier) return false
    const calculado = Buffer.from(createHash('sha256').update(verifier, 'ascii').digest('base64url'))
    const esperado = Buffer.from(challenge)
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
}

// ── Código de conexión (compartido con el enlace de §1.3) ───────────────────────────────────

export interface CodigoIrisCreado {
    id: number
    /** en claro: solo sale en la respuesta, nunca en la base ni en la auditoría */
    codigo: string
    vence: Date
}

/**
 * Crea un código de conexión de Iris: 32 bytes aleatorios en base64url, 15 min, un solo uso. Anula
 * los anteriores sin usar (de §1.3 o §1.4) y guarda solo su SHA-256. Lo usan `GenerarEnlaceIris`
 * (§1.3) y `AutorizarIris` (§1.4, con `code_challenge` y `origen_iris`).
 */
export async function crearCodigoIris(
    t: Transaccion,
    datos: { base_url: string; code_challenge?: string; origen_iris?: string },
): Promise<CodigoIrisCreado> {
    const anulados = (await t.trx
        .from('integraciones.iris_enlaces')
        .whereNull('usado_en')
        .whereNull('anulado_en')
        .whereNull('rechazado_en')
        .update({ anulado_en: t.trx.knexRawQuery('now()') }, ['id'])) as Array<{ id: number }>
    if (anulados.length > 0) t.anotarAuditoria({ enlaces_anulados: anulados.map((e) => Number(e.id)) })
    const codigo = randomBytes(32).toString('base64url')
    const vence = new Date(Date.now() + VIGENCIA_ENLACE_MIN * 60_000)
    const [fila] = (await t.trx
        .table('integraciones.iris_enlaces')
        .insert({
            codigo_sha256: hashCodigo(codigo),
            base_url: datos.base_url,
            vence_en: vence,
            creado_por: usuarioDelActor(t.ctx.actor),
            code_challenge: datos.code_challenge ?? null,
            origen_iris: datos.origen_iris ?? null,
        })
        .returning('id')) as Array<{ id: number }>
    const id = Number(fila!.id)
    t.fijarEntidad('enlace_iris', id)
    return { id, codigo, vence }
}

/**
 * Marca gastado un código cuyo canje falló por el PKCE. Corre fuera de la transacción del canje
 * (que se revierte al fallar), así el código no admite un segundo intento.
 */
export async function gastarCodigoIris(id: number): Promise<void> {
    await db
        .from('integraciones.iris_enlaces')
        .where('id', id)
        .whereNull('rechazado_en')
        .update({ rechazado_en: db.knexRawQuery('now()') })
}

// ── Vista previa para la pantalla de autorización ───────────────────────────────────────────

export interface VistaPreviaAutorizacionIris {
    origen_normalizado: string
    origen_conocido: boolean
    alcance_global: boolean
    empresas: EmpresaDelAlcance[]
}

/**
 * Empresas que verá Iris: las del alcance del usuario técnico Iris, igual que `empresas[]` del
 * canje (`empresasDelAlcance`). Si aún no existe (nunca se conectó), nacerá con alcance global
 * (`core.usuarios.alcance_global` por defecto): todas las empresas activas.
 */
export async function empresasPrevistasIris(
    cliente: QueryClientContract = db.connection(),
): Promise<{ alcance_global: boolean; empresas: EmpresaDelAlcance[] }> {
    const usuarioId = await usuarioIris(cliente)
    if (usuarioId !== null) return empresasDelAlcance(usuarioId, cliente)
    const filas = (await cliente
        .from('core.empresas')
        .where('activa', true)
        .orderBy('id', 'asc')
        .select('id', 'nombre_comercial', 'nit')) as Array<{
        id: number
        nombre_comercial: string
        nit: string | null
    }>
    return {
        alcance_global: true,
        empresas: filas.map((f) => ({ id: Number(f.id), nombre: f.nombre_comercial, nit: f.nit })),
    }
}

/** `GET /integraciones/iris/autorizar/vista-previa?iris=`: 422 `iris_origen_invalido` si no sirve. */
export async function vistaPreviaAutorizacionIris(iris: string): Promise<VistaPreviaAutorizacionIris> {
    const normalizado = normalizarOrigenIris(iris)
    if (normalizado.error !== null) throw new IrisOrigenInvalido(normalizado.error)
    return {
        origen_normalizado: normalizado.origen,
        origen_conocido: await esOrigenIrisConocido(normalizado.origen),
        ...(await empresasPrevistasIris()),
    }
}
