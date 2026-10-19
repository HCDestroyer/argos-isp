/**
 * Markdown mínimo y seguro para el "Qué cambió" (la sección del CHANGELOG que trae
 * `GET /version`): se convierte en datos y la plantilla los dibuja como texto, así que nunca se
 * inserta HTML. Soporta títulos (`#` a `####`), listas (`-`, `*`, `1.`), párrafos, `**negrita**`,
 * `*cursiva*`, `` `código` `` y enlaces `[texto](https://…)` (solo http y https). Todo lo demás
 * (HTML incluido) se muestra tal cual, como texto.
 */

export type Linea
    = | { tipo: 'texto', texto: string }
        | { tipo: 'negrita', texto: string }
        | { tipo: 'cursiva', texto: string }
        | { tipo: 'codigo', texto: string }
        | { tipo: 'enlace', texto: string, url: string }

export type Bloque
    = | { tipo: 'titulo', nivel: 2 | 3 | 4, partes: Linea[] }
        | { tipo: 'parrafo', partes: Linea[] }
        | { tipo: 'lista', ordenada: boolean, elementos: Linea[][] }

const ENLACE = /^\[([^\]]+)\]\(([^)\s]+)\)/
const SEGURA = /^https?:\/\//i

/** Partes en línea de un texto. */
export function enLinea(texto: string): Linea[] {
    const partes: Linea[] = []
    let resto = texto
    let acumulado = ''
    const vaciar = () => {
        if (acumulado) {
            partes.push({ tipo: 'texto', texto: acumulado })
            acumulado = ''
        }
    }
    while (resto) {
        const enlace = ENLACE.exec(resto)
        if (enlace) {
            const [completo, etiqueta = '', url = ''] = enlace
            vaciar()
            partes.push(SEGURA.test(url) ? { tipo: 'enlace', texto: etiqueta, url } : { tipo: 'texto', texto: etiqueta })
            resto = resto.slice(completo.length)
            continue
        }
        const marca = /^(\*\*|__)(.+?)\1/.exec(resto) ?? /^`([^`]+)`/.exec(resto) ?? /^([*_])(?!\s)(.+?)\1/.exec(resto)
        if (marca) {
            vaciar()
            const [completo] = marca
            if (completo.startsWith('`')) {
                partes.push({ tipo: 'codigo', texto: marca[1] ?? '' })
            }
            else if (completo.startsWith('**') || completo.startsWith('__')) {
                partes.push({ tipo: 'negrita', texto: marca[2] ?? '' })
            }
            else {
                partes.push({ tipo: 'cursiva', texto: marca[2] ?? '' })
            }
            resto = resto.slice(completo.length)
            continue
        }
        acumulado += resto.charAt(0)
        resto = resto.slice(1)
    }
    vaciar()
    return partes
}

/** Bloques de un Markdown (vacío o `null` → `[]`). */
export function markdownSeguro(markdown: string | null | undefined): Bloque[] {
    const bloques: Bloque[] = []
    let parrafo: string[] = []
    let lista: { ordenada: boolean, elementos: string[] } | null = null
    const cerrar = () => {
        if (parrafo.length) {
            bloques.push({ tipo: 'parrafo', partes: enLinea(parrafo.join(' ')) })
            parrafo = []
        }
        if (lista) {
            bloques.push({ tipo: 'lista', ordenada: lista.ordenada, elementos: lista.elementos.map(enLinea) })
            lista = null
        }
    }
    for (const cruda of (markdown ?? '').replace(/\r\n?/g, '\n').split('\n')) {
        const linea = cruda.trimEnd()
        if (!linea.trim()) {
            cerrar()
            continue
        }
        const titulo = /^(#{1,4})\s+(.*)$/.exec(linea)
        if (titulo) {
            cerrar()
            const nivel = Math.min(Math.max((titulo[1] ?? '#').length, 2), 4) as 2 | 3 | 4
            bloques.push({ tipo: 'titulo', nivel, partes: enLinea(titulo[2] ?? '') })
            continue
        }
        const elemento = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(linea)
        if (elemento) {
            const ordenada = /\d/.test(elemento[1] ?? '')
            if (parrafo.length) {
                bloques.push({ tipo: 'parrafo', partes: enLinea(parrafo.join(' ')) })
                parrafo = []
            }
            if (!lista || lista.ordenada !== ordenada) {
                if (lista) {
                    bloques.push({ tipo: 'lista', ordenada: lista.ordenada, elementos: lista.elementos.map(enLinea) })
                }
                lista = { ordenada, elementos: [] }
            }
            lista.elementos.push(elemento[2] ?? '')
            continue
        }
        if (lista && /^\s{2,}/.test(cruda)) {
            // Continuación de un elemento de la lista.
            const ultimo = lista.elementos.length - 1
            lista.elementos[ultimo] = `${lista.elementos[ultimo] ?? ''} ${linea.trim()}`
            continue
        }
        if (lista) {
            bloques.push({ tipo: 'lista', ordenada: lista.ordenada, elementos: lista.elementos.map(enLinea) })
            lista = null
        }
        parrafo.push(linea.trim())
    }
    cerrar()
    return bloques
}

/** Versión que se puede comparar y anunciar (`desarrollo` no se anuncia). */
export function versionPublicada(version: string | null | undefined): boolean {
    return Boolean(version) && version !== 'desarrollo'
}

/** Clave de `localStorage` con la última versión que vio un usuario. */
export function claveVersionVista(usuarioId: number): string {
    return `argos_version_vista_${usuarioId}`
}

export function leerVersionVista(usuarioId: number): string | null {
    try {
        return globalThis.localStorage?.getItem(claveVersionVista(usuarioId)) ?? null
    }
    catch {
        return null
    }
}

export function guardarVersionVista(usuarioId: number, version: string): void {
    try {
        globalThis.localStorage?.setItem(claveVersionVista(usuarioId), version)
    }
    catch {
        // Sin almacenamiento: el aviso puede volver a salir la próxima vez.
    }
}

/**
 * ¿Se avisa de esta versión? Solo si es publicada y distinta de la última vista. La primera vez de
 * un usuario (sin nada guardado) no se avisa: se guarda como vista.
 */
export function debeAvisarVersion(version: string, vista: string | null): boolean {
    return versionPublicada(version) && vista !== null && vista !== version
}
