import { createHash, randomInt } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { Problema } from '#shared/errores'
import { normalizarIp } from '#portal/ip_origen'

/**
 * Nodo portal remoto (contrato `.claude/integration/contratos/nodo-portal.md`).
 *
 * Un portal que corre en otro servidor llama a `/api/v1/portal/**` (y a `GET /api/v1/version`) con:
 * - `X-Argos-Nodo-Token: argn_<43 base62>`: token del nodo (`core.nodos_portal`, solo su sha256).
 * - `X-Argos-Cliente-Ip`: IP del navegador del cliente que el nodo ya resolvió.
 * - `X-Argos-Cliente-Proto` (opcional, `http` | `https`): cómo llegó el navegador al nodo; decide si
 *   la cookie de sesión del portal lleva `Secure`. Sin ella, `http`.
 *
 * Solo con un token de nodo válido y no revocado la API cree esas cabeceras; sin la cabecera del
 * token se ignoran siempre y la IP sale del socket o del proxy local de confianza (`ip_origen.ts`),
 * como antes. Con un token desconocido o revocado responde 401 (`nodo_portal_invalido`): el nodo
 * mal configurado se nota, nunca se degrada a la IP de su propio servidor. El token no autentica
 * en ninguna otra ruta: los guards del panel solo leen `Authorization`.
 */

export const PREFIJO_TOKEN_NODO = 'argn_'
export const CABECERA_TOKEN_NODO = 'x-argos-nodo-token'
export const CABECERA_IP_CLIENTE = 'x-argos-cliente-ip'
export const CABECERA_PROTO_CLIENTE = 'x-argos-cliente-proto'

/** Nombre del nodo: su identificador (lo usa el CLI `argosisp nodo-portal … <nombre>`). */
export const PATRON_NOMBRE_NODO = /^[a-z0-9][a-z0-9-]{0,62}$/

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** `argn_` + 43 caracteres base62 (~256 bits). */
export function generarTokenNodo(): { valor: string; hash: string } {
    let cuerpo = ''
    for (let i = 0; i < 43; i++) cuerpo += BASE62[randomInt(BASE62.length)]
    const valor = PREFIJO_TOKEN_NODO + cuerpo
    return { valor, hash: hashTokenNodo(valor) }
}

export function hashTokenNodo(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
}

export interface NodoValidado {
    id: number
    nombre: string
}

export interface NodoDeLaPeticion extends NodoValidado {
    /** IP del cliente según el nodo (`X-Argos-Cliente-Ip`, ya normalizada) */
    ipCliente: string
    /** el navegador llegó al nodo por HTTPS (`X-Argos-Cliente-Proto: https`) */
    https: boolean
}

export class NodoPortalInvalido extends Problema {
    constructor() {
        super(
            401,
            'nodo_portal_invalido',
            'Nodo portal no autorizado',
            'El token del nodo portal no existe o fue revocado',
        )
    }
}

/** Valor de `X-Argos-Nodo-Token`, o null si la petición no la trae (vacía cuenta como ausente). */
export function tokenNodoDeLaPeticion(ctx: HttpContext): string | null {
    const valor = (ctx.request.header(CABECERA_TOKEN_NODO) ?? '').trim()
    return valor === '' ? null : valor
}

const validados = new WeakMap<HttpContext, NodoValidado | null>()
const resueltos = new WeakMap<HttpContext, NodoDeLaPeticion | null>()

/**
 * Valida `X-Argos-Nodo-Token` (una vez por petición). null sin la cabecera; 401 si el token no
 * existe o fue revocado. Actualiza `ultimo_uso` y `ultima_ip` como mucho una vez por minuto
 * (telemetría, como `ultimo_uso` de los tokens de API; no se audita).
 */
export async function validarTokenNodo(ctx: HttpContext): Promise<NodoValidado | null> {
    const previo = validados.get(ctx)
    if (previo !== undefined) return previo

    const token = tokenNodoDeLaPeticion(ctx)
    if (!token) {
        validados.set(ctx, null)
        return null
    }
    const fila = (await db
        .from('core.nodos_portal')
        .where('hash', hashTokenNodo(token))
        .whereNull('revocado_en')
        .select('id', 'nombre')
        .first()) as { id: number; nombre: string } | null
    if (!fila) throw new NodoPortalInvalido()

    await db
        .from('core.nodos_portal')
        .where('id', fila.id)
        .where((q) => q.whereNull('ultimo_uso').orWhereRaw(`ultimo_uso < now() - interval '1 minute'`))
        .update({
            ultimo_uso: db.knexRawQuery('now()'),
            ultima_ip: normalizarIp(ctx.request.request.socket.remoteAddress),
        })

    const nodo = { id: Number(fila.id), nombre: fila.nombre }
    validados.set(ctx, nodo)
    return nodo
}

/**
 * Nodo ya resuelto en esta petición (por `resolverNodoPortal`); undefined si aún no se resolvió,
 * null si la petición no viene de un nodo.
 */
export function nodoDeLaPeticion(ctx: HttpContext): NodoDeLaPeticion | null | undefined {
    return resueltos.get(ctx)
}

/**
 * Nodo y cliente de una petición del portal: null sin token de nodo; 401 con un token inválido;
 * 400 `ip_cliente_invalida` si el token es válido pero `X-Argos-Cliente-Ip` falta o no es una IP.
 */
export async function resolverNodoPortal(ctx: HttpContext): Promise<NodoDeLaPeticion | null> {
    const previo = resueltos.get(ctx)
    if (previo !== undefined) return previo

    const nodo = await validarTokenNodo(ctx)
    if (!nodo) {
        resueltos.set(ctx, null)
        return null
    }
    const ipCliente = normalizarIp(ctx.request.header(CABECERA_IP_CLIENTE))
    if (!ipCliente) {
        throw new Problema(
            400,
            'ip_cliente_invalida',
            'Falta la IP del cliente',
            'Un nodo portal debe mandar la IP del cliente en X-Argos-Cliente-Ip',
        )
    }
    const proto = (ctx.request.header(CABECERA_PROTO_CLIENTE) ?? '').trim().toLowerCase()
    const resuelto: NodoDeLaPeticion = { ...nodo, ipCliente, https: proto === 'https' }
    resueltos.set(ctx, resuelto)
    return resuelto
}
