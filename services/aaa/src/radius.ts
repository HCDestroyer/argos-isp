/**
 * Cuerpo que envía `rlm_rest` con `body = 'json'`:
 *   {"User-Name":{"type":"string","value":["juan"]},"NAS-IP-Address":{"type":"ipaddr","value":["10.0.0.1"]}}
 * Se reduce a nombre → primer valor como texto. Atributos repetidos conservan solo el primero.
 */
export type AtributosPeticion = Map<string, string>

export function leerAtributos(cuerpo: unknown): AtributosPeticion {
    const atributos: AtributosPeticion = new Map()
    if (typeof cuerpo !== 'object' || cuerpo === null) return atributos
    for (const [nombre, dato] of Object.entries(cuerpo)) {
        if (typeof dato !== 'object' || dato === null) continue
        const valor = (dato as { value?: unknown }).value
        const primero = Array.isArray(valor) ? valor[0] : valor
        if (primero === undefined || primero === null) continue
        atributos.set(nombre, String(primero))
    }
    return atributos
}
