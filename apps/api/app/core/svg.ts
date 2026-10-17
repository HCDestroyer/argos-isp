/**
 * Saneado de SVG para logos (`contratos/multiempresa.md`): el resultado no lleva scripts, manejadores
 * de eventos, `foreignObject`, estilos ni referencias externas. Se reconstruye el documento a partir
 * de una lista blanca de elementos y atributos; lo demás se descarta.
 *
 * - Elementos fuera de la lista se eliminan con todo su contenido (`<script>`, `<style>`,
 *   `<foreignObject>`, `<image>`, `<a>`…).
 * - Atributos fuera de la lista se eliminan (`on*`, `style`, `xlink:href` externos…). `href` y
 *   `xlink:href` solo quedan si apuntan a un id del mismo documento (`#id`); los valores con
 *   `url(...)` solo si es `url(#id)`.
 * - `<!DOCTYPE>`, entidades y secciones CDATA: el SVG se rechaza (son la vía de XXE y de
 *   contenido oculto). Comentarios e instrucciones de proceso se descartan.
 * - Si la raíz no es `<svg>` o el XML está mal formado, se rechaza.
 */

export class SvgInvalido extends Error {}

const ELEMENTOS = new Set([
    'svg',
    'g',
    'defs',
    'title',
    'desc',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'lineargradient',
    'radialgradient',
    'stop',
    'clippath',
    'mask',
    'pattern',
    'symbol',
    'use',
])

const ATRIBUTOS = new Set([
    'id',
    'class',
    'xmlns',
    'xmlns:xlink',
    'version',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'd',
    'points',
    'viewbox',
    'preserveaspectratio',
    'transform',
    'fill',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'clip-path',
    'mask',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'opacity',
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'patternunits',
    'patterncontentunits',
    'patterntransform',
    'clippathunits',
    'maskunits',
    'maskcontentunits',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'dominant-baseline',
    'letter-spacing',
    'dx',
    'dy',
    'href',
    'xlink:href',
    'role',
    'aria-label',
    'aria-hidden',
    'focusable',
])

const NOMBRE = /^[A-Za-z_][\w.:-]*$/

function escaparTexto(texto: string): string {
    return texto
        .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function escaparAtributo(valor: string): string {
    return escaparTexto(valor).replace(/"/g, '&quot;')
}

/** Decodifica las entidades numéricas y las predefinidas (para revisar el valor real). */
function decodificar(valor: string): string {
    return valor
        .replace(/&#x([0-9a-fA-F]+);?/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
        .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
}

function valorSeguro(nombre: string, valor: string): boolean {
    const real = decodificar(valor)
        .split('')
        .filter((c) => c.charCodeAt(0) > 0x20)
        .join('')
        .toLowerCase()
    if (nombre === 'href' || nombre === 'xlink:href') return /^#[\w.:-]+$/.test(real)
    if (real.includes('javascript:') || real.includes('data:') || real.includes('expression(')) return false
    // url(...) solo hacia el mismo documento
    for (const m of real.matchAll(/url\(([^)]*)\)/g)) {
        if (!/^['"]?#[\w.:-]+['"]?$/.test(m[1]!)) return false
    }
    return true
}

interface Etiqueta {
    nombre: string
    atributos: Array<[string, string]>
    cierre: boolean
    autocierre: boolean
    fin: number
}

function leerEtiqueta(texto: string, inicio: number): Etiqueta {
    let i = inicio + 1
    const cierre = texto[i] === '/'
    if (cierre) i++
    const nombreMatch = /^[^\s/>]+/.exec(texto.slice(i))
    if (!nombreMatch || !NOMBRE.test(nombreMatch[0])) throw new SvgInvalido('Etiqueta mal formada')
    const nombre = nombreMatch[0]
    i += nombre.length
    const atributos: Array<[string, string]> = []
    for (;;) {
        while (/\s/.test(texto[i] ?? '')) i++
        if (i >= texto.length) throw new SvgInvalido('Etiqueta sin cerrar')
        if (texto[i] === '>') return { nombre, atributos, cierre, autocierre: false, fin: i + 1 }
        if (texto.startsWith('/>', i)) {
            if (cierre) throw new SvgInvalido('Etiqueta mal formada')
            return { nombre, atributos, cierre, autocierre: true, fin: i + 2 }
        }
        if (cierre) throw new SvgInvalido('Una etiqueta de cierre no lleva atributos')
        const atributo = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(texto.slice(i))
        if (!atributo || !NOMBRE.test(atributo[1]!)) throw new SvgInvalido('Atributo mal formado')
        atributos.push([atributo[1]!, atributo[3] ?? atributo[4] ?? ''])
        i += atributo[0].length
    }
}

/**
 * Devuelve el SVG saneado. Lanza `SvgInvalido` si no es un SVG bien formado o trae DOCTYPE,
 * entidades o CDATA.
 */
export function sanearSvg(entrada: string): string {
    const texto = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada
    const salida: string[] = []
    const pila: Array<{ nombre: string; conservado: boolean }> = []
    /** profundidad dentro de un elemento descartado (se descarta todo su contenido) */
    let descartando = 0
    let raizVista = false
    let i = 0

    while (i < texto.length) {
        const menor = texto.indexOf('<', i)
        const hasta = menor === -1 ? texto.length : menor
        if (hasta > i) {
            const fragmento = texto.slice(i, hasta)
            if (pila.length === 0) {
                if (fragmento.trim() !== '') throw new SvgInvalido('Texto fuera de la raíz')
            } else if (descartando === 0) {
                salida.push(escaparTexto(fragmento))
            }
            i = hasta
            continue
        }

        if (texto.startsWith('<!--', i)) {
            const fin = texto.indexOf('-->', i + 4)
            if (fin === -1) throw new SvgInvalido('Comentario sin cerrar')
            i = fin + 3
            continue
        }
        if (texto.startsWith('<?', i)) {
            const fin = texto.indexOf('?>', i + 2)
            if (fin === -1) throw new SvgInvalido('Instrucción sin cerrar')
            i = fin + 2
            continue
        }
        if (texto.startsWith('<!', i)) {
            throw new SvgInvalido('El SVG no puede traer DOCTYPE, entidades ni CDATA')
        }

        const etiqueta = leerEtiqueta(texto, i)
        i = etiqueta.fin
        const nombre = etiqueta.nombre.toLowerCase()

        if (etiqueta.cierre) {
            const abierta = pila.pop()
            if (!abierta || abierta.nombre !== etiqueta.nombre) {
                throw new SvgInvalido('Etiquetas mal anidadas')
            }
            if (!abierta.conservado) descartando--
            else if (descartando === 0) salida.push(`</${abierta.nombre}>`)
            if (pila.length === 0) {
                if (
                    texto
                        .slice(i)
                        .replace(/<!--[\s\S]*?-->/g, '')
                        .trim() !== ''
                ) {
                    throw new SvgInvalido('Contenido después de la raíz')
                }
                break
            }
            continue
        }

        if (pila.length === 0) {
            if (raizVista || nombre !== 'svg') throw new SvgInvalido('La raíz debe ser <svg>')
            raizVista = true
        }

        const conservado = descartando === 0 && ELEMENTOS.has(nombre)
        if (conservado) {
            const filtrados = etiqueta.atributos.filter(
                ([n, v]) => ATRIBUTOS.has(n.toLowerCase()) && valorSeguro(n.toLowerCase(), v),
            )
            // servido solo (`image/svg+xml`), la raíz necesita su espacio de nombres
            if (pila.length === 0 && !filtrados.some(([n]) => n === 'xmlns')) {
                filtrados.unshift(['xmlns', 'http://www.w3.org/2000/svg'])
            }
            const atributos = filtrados.map(([n, v]) => ` ${n}="${escaparAtributo(v)}"`).join('')
            salida.push(`<${etiqueta.nombre}${atributos}${etiqueta.autocierre ? '/>' : '>'}`)
        }
        if (!etiqueta.autocierre) {
            pila.push({ nombre: etiqueta.nombre, conservado })
            if (!conservado) descartando++
        } else if (pila.length === 0) {
            break
        }
    }

    if (!raizVista) throw new SvgInvalido('No es un SVG')
    if (pila.length > 0) throw new SvgInvalido('Etiquetas sin cerrar')
    return salida.join('')
}
