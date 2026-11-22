import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ajusteBooleano } from '#core/ajustes_operacion'
import { TABLAS_CONECTOR_SSO, urlPanel, type ConectorSso } from '#core/sso'
import { Problema } from '#shared/errores'

/**
 * Recuperar la contraseña del panel por correo (decisión del PM 22).
 *
 * - Enlace de un solo uso: `<PANEL_URL_PUBLICA>/restablecer-contrasena#token=<token>` (fragmento: no
 *   llega a los registros de ningún servidor). En la base solo el SHA-256 del token.
 * - Vence a los `RECUPERAR_CONTRASENA_VIGENCIA_MIN` (30) minutos; pedir otro anula los anteriores.
 * - Límite por IP y por correo (`RECUPERAR_CONTRASENA_LIMITE_IP`, 10, y `…_LIMITE_USUARIO`, 3, por
 *   `RECUPERAR_CONTRASENA_VENTANA_S`, 3600) en la ruta.
 * - La respuesta es la misma exista o no el correo (202). Al cambiarla se cierran todas las sesiones.
 * - El admin la apaga con el ajuste `auth.recuperar_contrasena` (404 `recuperacion_apagada`).
 */

function entero(nombre: string, defecto: number, minimo = 1): number {
    const valor = Number(process.env[nombre])
    return Number.isInteger(valor) && valor >= minimo ? valor : defecto
}

export function configRecuperacion() {
    return {
        vigenciaMin: entero('RECUPERAR_CONTRASENA_VIGENCIA_MIN', 30),
        limiteIp: entero('RECUPERAR_CONTRASENA_LIMITE_IP', 10, 0),
        limiteUsuario: entero('RECUPERAR_CONTRASENA_LIMITE_USUARIO', 3, 0),
        ventanaS: entero('RECUPERAR_CONTRASENA_VENTANA_S', 3600),
    }
}

export function generarTokenRecuperacion(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url')
    return { token, hash: hashTokenRecuperacion(token) }
}

export function hashTokenRecuperacion(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function enlaceRecuperacion(token: string): string {
    return `${urlPanel()}/restablecer-contrasena#token=${token}`
}

export class RecuperacionApagada extends Problema {
    constructor() {
        super(
            404,
            'recuperacion_apagada',
            'Recuperación apagada',
            'La recuperación de contraseña por correo está apagada: pide a un administrador que la cambie',
        )
    }
}

export class EnlaceRecuperacionInvalido extends Problema {
    constructor() {
        super(
            422,
            'enlace_invalido',
            'Enlace inválido',
            'El enlace para cambiar la contraseña no existe, ya se usó o venció: pide otro',
        )
    }
}

export async function exigirRecuperacionEncendida(cliente: QueryClientContract = db.connection()) {
    if (!(await ajusteBooleano('auth.recuperar_contrasena', null, cliente))) throw new RecuperacionApagada()
}

/** ¿El conector está conectado? (activo y con `url_base`): el login muestra su botón. */
async function conectorConectado(conector: ConectorSso, cliente: QueryClientContract): Promise<boolean> {
    const fila = (await cliente
        .from(TABLAS_CONECTOR_SSO[conector])
        .where('id', 1)
        .select('activo', 'url_base')
        .first()) as { activo: boolean; url_base: string | null } | null
    return Boolean(fila?.activo && fila.url_base)
}

export interface OpcionesLogin {
    /** se puede pedir el enlace de recuperación por correo */
    recuperar_contrasena: boolean
    /** conectores conectados: el login muestra «Entrar con Iris» / «Entrar con Horus» */
    iris: boolean
    horus: boolean
}

export async function opcionesLogin(cliente: QueryClientContract = db.connection()): Promise<OpcionesLogin> {
    return {
        recuperar_contrasena: await ajusteBooleano('auth.recuperar_contrasena', null, cliente),
        iris: await conectorConectado('iris', cliente),
        horus: await conectorConectado('horus', cliente),
    }
}
