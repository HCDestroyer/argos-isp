/**
 * Código de corte (`contratos/corte-identificacion.md`): el proxy del router en modo código manda al
 * suspendido a `/corte?c=<código>`. La página lo guarda (en memoria y en `sessionStorage` de la pestaña)
 * y lo envía en `X-Argos-Corte` en cada llamada a la API, así la identificación no depende de la IP que
 * ve el servidor. Se quita de la barra de direcciones (no queda en el historial ni en una captura).
 */

/** Clave en `sessionStorage` (solo esta pestaña; el mini-navegador de iOS tiene la suya). */
export const CLAVE_CODIGO_CORTE = 'argos:codigo-corte'

/** Cabecera con la que viaja a la API. */
export const CABECERA_CODIGO_CORTE = 'X-Argos-Corte'

/** `?c=` con formato de código (13 símbolos base32 Crockford), en mayúsculas; null si no. */
export function codigoCorteValido(valor: unknown): string | null {
    const texto = Array.isArray(valor) ? valor[0] : valor
    if (typeof texto !== 'string') {
        return null
    }
    const codigo = texto.trim().toUpperCase()
    return /^[0-9A-HJKMNP-TV-Z]{13}$/.test(codigo) ? codigo : null
}

/** Lee el código guardado en la pestaña; null si no hay o si el navegador no deja leer. */
export function leerCodigoGuardado(): string | null {
    try {
        return codigoCorteValido(globalThis.sessionStorage?.getItem(CLAVE_CODIGO_CORTE))
    }
    catch {
        return null
    }
}

/** Guarda el código en la pestaña (si el navegador lo permite; si no, queda solo en memoria). */
export function guardarCodigo(codigo: string): void {
    try {
        globalThis.sessionStorage?.setItem(CLAVE_CODIGO_CORTE, codigo)
    }
    catch {
        // Modo privado o almacenamiento bloqueado: vale lo que está en memoria.
    }
}
