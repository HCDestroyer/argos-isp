import { createHmac } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { limpiarDocumento } from '#core/nit_cui'
import { Problema } from '#shared/errores'
import { claveDeIp } from '#portal/limite_peticiones'
import { enteroDeEntorno } from '#portal/redis_portal'
import { configAcceso, generarToken, hashToken } from '#portal/acceso/codigos'
import { empresaPrincipalDelCliente } from '#portal/marca'

/**
 * Entrada al portal con documento y contraseña, y sesión directa desde `/corte` (pedido del PM).
 *
 * - **Usuario:** el documento del cliente (`core.clientes.nit_cui`) sin espacios ni guiones y en
 *   mayúsculas (`limpiarDocumento` de #core/nit_cui), comparado con la misma limpieza del lado de la
 *   base (índice `clientes_documento_portal`). `CF` (consumidor final) no es un documento.
 * - **Contraseña:** hash de Adonis (`hash.make`, scrypt de `config/hash.ts`). Propia del cliente en
 *   `core.portal_credenciales`; sin fila, la por defecto de la empresa (`core.portal_contrasenas_defecto`).
 * - **Límite:** `core.portal_intentos_contrasena`, en Postgres (no se cae con Redis): el intento se
 *   inserta antes de verificar y fuera de la transacción de la acción.
 */

export interface ConfigContrasenas {
    /** intentos fallidos por documento en la ventana (`PORTAL_CONTRASENA_FALLOS_DOCUMENTO`, 5) */
    fallosDocumento: number
    /** intentos (fallidos) por IP o /64 en la ventana (`PORTAL_CONTRASENA_FALLOS_IP`, 20) */
    fallosIp: number
    /** ventana de los dos contadores (`PORTAL_CONTRASENA_VENTANA_S`, 900) */
    ventanaS: number
    /** duración máxima de la sesión abierta desde `/corte` (`PORTAL_SESION_CORTE_MAX_S`, 900) */
    sesionCorteMaxS: number
}

export function configContrasenas(entorno: NodeJS.ProcessEnv = process.env): ConfigContrasenas {
    return {
        fallosDocumento: enteroDeEntorno(entorno, 'PORTAL_CONTRASENA_FALLOS_DOCUMENTO', 5, 1),
        fallosIp: enteroDeEntorno(entorno, 'PORTAL_CONTRASENA_FALLOS_IP', 20, 1),
        ventanaS: enteroDeEntorno(entorno, 'PORTAL_CONTRASENA_VENTANA_S', 900, 60),
        sesionCorteMaxS: enteroDeEntorno(entorno, 'PORTAL_SESION_CORTE_MAX_S', 900, 60),
    }
}

/** Largo de una contraseña nueva (la de por defecto y la del cliente); el máximo evita cuerpos enormes. */
export const CONTRASENA_MINIMO = 8
export const CONTRASENA_MAXIMO = 128

/** Documento como se compara: sin espacios ni guiones, en mayúsculas. */
export function normalizarDocumento(documento: string): string {
    return limpiarDocumento(documento)
}

/** Expresión SQL con la misma limpieza sobre `core.clientes.nit_cui` (usa el índice). */
export const SQL_DOCUMENTO_CLIENTE = `upper(regexp_replace(coalesce(c.nit_cui, ''), '[[:space:]-]', '', 'g'))`

function appKey(): string {
    const clave = process.env.APP_KEY
    if (!clave) throw new Error('APP_KEY no está definida: no se pueden contar los intentos del portal')
    return clave
}

/** Clave del contador por documento: HMAC (APP_KEY), nunca el documento en claro. */
export function claveDocumento(documentoNormalizado: string): string {
    return createHmac('sha256', appKey()).update(`portal-documento:${documentoNormalizado}`).digest('hex')
}

/** Clave del contador para cambiar la contraseña con sesión: por cliente. */
export function claveCliente(clienteId: number): string {
    return `cliente:${clienteId}`
}

/** 429 genérico: no dice si el límite fue por documento o por IP. */
export class DemasiadosIntentosPortal extends Problema {
    constructor(readonly reintentarEnS: number) {
        super(
            429,
            'demasiados_intentos',
            'Demasiados intentos',
            `Hubo demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(reintentarEnS / 60)} minuto${
                Math.ceil(reintentarEnS / 60) === 1 ? '' : 's'
            } o entra con un código.`,
        )
    }
}

/** 422 genérico: el mismo para documento inexistente, ambiguo, sin contraseña o contraseña errada. */
export class CredencialesPortalInvalidas extends Problema {
    constructor() {
        super(
            422,
            'credenciales_invalidas',
            'Datos de acceso incorrectos',
            'El documento o la contraseña no son correctos. Revisa y vuelve a intentar, o entra con un código.',
        )
    }
}

/**
 * Registra un intento (antes de verificar, fuera de cualquier transacción) y revisa el límite:
 * fallidos del documento desde su último acierto y fallidos de la IP (/64 en IPv6), en la ventana.
 * El intento recién insertado cuenta como fallido hasta que `marcarIntentoExitoso` lo cambia, así N
 * peticiones en paralelo no pasan de N comparaciones. Devuelve el id del intento.
 */
export async function registrarIntento(claveDoc: string, ip: string): Promise<number> {
    const config = configContrasenas()
    const claveIp = claveDeIp(ip) ?? ip
    const [fila] = (await db
        .table('core.portal_intentos_contrasena')
        .insert({ clave_documento: claveDoc, clave_ip: claveIp })
        .returning('id')) as Array<{ id: number | string }>
    const id = Number(fila!.id)

    const resultado = await db.rawQuery(
        `WITH ultimo_exito AS (
             SELECT max(created_at) AS en FROM core.portal_intentos_contrasena
              WHERE clave_documento = ? AND exito
         )
         SELECT
             (SELECT count(*) FROM core.portal_intentos_contrasena i, ultimo_exito u
               WHERE i.clave_documento = ? AND NOT i.exito
                 AND i.created_at > now() - make_interval(secs => ?)
                 AND (u.en IS NULL OR i.created_at > u.en)) AS por_documento,
             (SELECT count(*) FROM core.portal_intentos_contrasena
               WHERE clave_ip = ? AND NOT exito
                 AND created_at > now() - make_interval(secs => ?)) AS por_ip,
             (SELECT min(created_at) FROM core.portal_intentos_contrasena
               WHERE (clave_documento = ? OR clave_ip = ?) AND NOT exito
                 AND created_at > now() - make_interval(secs => ?)) AS desde`,
        [claveDoc, claveDoc, config.ventanaS, claveIp, config.ventanaS, claveDoc, claveIp, config.ventanaS],
    )
    const cuenta = resultado.rows[0] as { por_documento: string; por_ip: string; desde: Date | null }
    if (Number(cuenta.por_documento) > config.fallosDocumento || Number(cuenta.por_ip) > config.fallosIp) {
        // El rechazado por el límite no verifica nada: no cuenta (así el bloqueo dura una ventana).
        await db.from('core.portal_intentos_contrasena').where('id', id).delete()
        const desde = cuenta.desde ? DateTime.fromJSDate(cuenta.desde) : DateTime.utc()
        const libera = desde.plus({ seconds: config.ventanaS })
        throw new DemasiadosIntentosPortal(Math.max(1, Math.ceil(libera.diffNow('seconds').seconds)))
    }
    return id
}

/** El intento acertó: deja de contar como fallido (y reinicia el contador del documento). */
export async function marcarIntentoExitoso(id: number): Promise<void> {
    await db.from('core.portal_intentos_contrasena').where('id', id).update({ exito: true })
}

/**
 * Hash fijo para comparar cuando no hay candidato: la respuesta tarda lo mismo exista o no el
 * documento (sin enumeración por tiempo).
 */
let hashSenuelo: Promise<string> | undefined
export async function verificarSenuelo(contrasena: string): Promise<void> {
    hashSenuelo ??= hash.make('contraseña-señuelo-del-portal')
    await hash.verify(await hashSenuelo, contrasena)
}

/** Contraseña propia del cliente (hash) o null si usa la por defecto. */
export async function contrasenaPropia(
    cliente: QueryClientContract,
    clienteId: number,
): Promise<string | null> {
    const fila = (await cliente
        .from('core.portal_credenciales')
        .where('cliente_id', clienteId)
        .select('contrasena_hash')
        .first()) as { contrasena_hash: string } | null
    return fila?.contrasena_hash ?? null
}

/**
 * Empresas cuya contraseña por defecto vale para el cliente: con `empresaId` (el portal de una
 * empresa), solo esa; si no, las de sus servicios sin retirar o, sin ninguno, su principal.
 */
export async function empresasDelCliente(
    cliente: QueryClientContract,
    clienteId: number,
    empresaId: number | null,
): Promise<number[]> {
    if (empresaId !== null) return [empresaId]
    const filas = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')) as Array<{ empresa_id: number | string }>
    if (filas.length > 0) return filas.map((f) => Number(f.empresa_id))
    return [await empresaPrincipalDelCliente(clienteId, cliente)]
}

/** Hashes de la contraseña por defecto de esas empresas (las que tienen una configurada). */
export async function hashesPorDefecto(cliente: QueryClientContract, empresas: number[]): Promise<string[]> {
    if (empresas.length === 0) return []
    const filas = (await cliente
        .from('core.portal_contrasenas_defecto')
        .whereIn('empresa_id', empresas)
        .select('contrasena_hash')) as Array<{ contrasena_hash: string }>
    return filas.map((f) => f.contrasena_hash)
}

/** ¿La contraseña coincide con alguno de los hashes? Compara con todos (tiempo parejo). */
export async function coincideAlguno(hashes: string[], contrasena: string): Promise<boolean> {
    let coincide = false
    for (const h of hashes) {
        if (await hash.verify(h, contrasena)) coincide = true
    }
    return coincide
}

export type OrigenSesion = 'codigo' | 'contrasena' | 'corte'

export interface SesionAbierta {
    token: string
    expiraEn: DateTime
    expiraMaxEn: DateTime
}

/**
 * Abre una sesión del portal (la misma tabla y la misma cookie del acceso por código). Solo se
 * guarda el SHA-256 del token. `maxS` acota la vida total (la de `/corte` es corta).
 */
export async function abrirSesionPortal(
    trx: TransactionClientContract,
    datos: {
        clienteId: number
        origen: OrigenSesion
        ip: string
        debeCambiarContrasena?: boolean
        servicioId?: number | null
        codigoId?: number | null
        maxS?: number
    },
): Promise<SesionAbierta> {
    const config = configAcceso()
    const ahora = DateTime.utc()
    const maxS = Math.min(datos.maxS ?? config.sesionMaxS, config.sesionMaxS)
    const expiraMaxEn = ahora.plus({ seconds: maxS })
    const expiraEn = ahora.plus({ seconds: Math.min(config.sesionInactividadS, maxS) })
    const token = generarToken()
    await trx
        .insertQuery()
        .table('core.portal_sesiones')
        .insert({
            cliente_id: datos.clienteId,
            token_hash: hashToken(token),
            codigo_id: datos.codigoId ?? null,
            expira_en: expiraEn.toJSDate(),
            expira_max_en: expiraMaxEn.toJSDate(),
            ultimo_uso: ahora.toJSDate(),
            ip: datos.ip,
            origen: datos.origen,
            debe_cambiar_contrasena: datos.debeCambiarContrasena ?? false,
            servicio_id: datos.servicioId ?? null,
        })
    return { token, expiraEn, expiraMaxEn }
}
