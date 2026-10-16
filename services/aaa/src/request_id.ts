import { createHash, randomUUID } from 'node:crypto'
import type { AtributosPeticion } from './radius.ts'

/**
 * `request_id` de cada línea de log de `aaa` (pedido de A6, `a6.md`, "Logs con request_id").
 *
 * 1. `X-Request-Id` si viene y es válido. FreeRADIUS lo manda en cada llamada de `rlm_rest`
 *    (`control:REST-HTTP-Header` en `freeradius/sites-enabled/default`), calculado igual que (2).
 * 2. Si no viene (otra config de FreeRADIUS, pruebas): derivado de forma estable del paquete,
 *    `rad-` + md5(`<NAS-IP>|<Acct-Session-Id>`), o md5(`<NAS-IP>|u:<User-Name>`) si no hay sesión.
 *    Así el authorize y todo el accounting de una misma sesión PPPoE comparten `request_id` y se
 *    encuentran con un solo grep, en `aaa`, en la API (respaldo) y en `audit.*` (worker).
 * 3. Rutas que no son de RADIUS (`/health`, `/metrics`) o un paquete sin NAS, sesión ni usuario:
 *    un UUID nuevo.
 *
 * Mismo formato que acepta el middleware de la API (`apps/api/app/middleware/request_id_middleware.ts`).
 * md5 aquí no es seguridad: solo un identificador corto y estable que FreeRADIUS sabe calcular.
 */

export const ID_VALIDO = /^[A-Za-z0-9._:-]{1,128}$/

export function idEntrante(cabecera: string | string[] | undefined): string | null {
    const valor = Array.isArray(cabecera) ? cabecera[0] : cabecera
    return valor && ID_VALIDO.test(valor) ? valor : null
}

/** Texto que se resume; debe coincidir con la expansión de `sites-enabled/default`. */
export function baseDerivada(atributos: AtributosPeticion): string | null {
    const nas = atributos.get('NAS-IP-Address') ?? atributos.get('NAS-IPv6-Address') ?? ''
    const sesion = atributos.get('Acct-Session-Id') ?? ''
    const usuario = atributos.get('User-Name') ?? ''
    if (!nas && !sesion && !usuario) return null
    return `${nas}|${sesion || `u:${usuario}`}`
}

export function idDerivado(atributos: AtributosPeticion): string | null {
    const base = baseDerivada(atributos)
    if (base === null) return null
    return `rad-${createHash('md5').update(base, 'utf8').digest('hex')}`
}

export function idNuevo(): string {
    return randomUUID()
}
