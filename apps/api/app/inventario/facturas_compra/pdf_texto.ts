import { inflateSync } from 'node:zlib'

/**
 * Lector mínimo de texto de un PDF (fase D, `contratos/inventario.md` D.5), sin dependencias: para
 * mandar a una IA compatible con OpenAI (que no recibe PDF) el texto de una factura generada por
 * computadora. Descomprime los flujos `FlateDecode` con `zlib` de Node y junta las cadenas de los
 * operadores `Tj`, `TJ`, `'` y `"`. No hace OCR: un PDF escaneado devuelve texto vacío (la ruta pide
 * entonces subir la imagen). Fuentes con codificación propia (CID) pueden salir ilegibles; en ese caso
 * se recomienda Anthropic, que recibe el PDF entero.
 */

const MAXIMO_TEXTO = 40_000

/** Una cadena del PDF: literal `(…)` con sus escapes o hexadecimal `<…>` (bytes WinAnsi). */
function decodificar(p: string): string {
    if (p.startsWith('<')) {
        const hex = p.slice(1, -1).replaceAll(/\s/g, '')
        return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('latin1')
    }
    return p
        .slice(1, -1)
        .replaceAll(
            /\\([nrtbf()\\])/g,
            (_m, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' })[c] ?? c,
        )
        .replaceAll(/\\(\d{1,3})/g, (_m, o: string) => String.fromCharCode(Number.parseInt(o, 8)))
}

function cadenas(contenido: string): string[] {
    const salida: string[] = []
    // (texto) Tj · [(a) -20 <62>] TJ · (texto) ' · a b (texto) "
    const cadena = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g
    const bloques = contenido.match(/BT[\s\S]*?ET/g) ?? []
    for (const bloque of bloques) {
        const lineas: string[] = []
        const operadores =
            bloque.match(/(\[[^\]]*\]\s*TJ|(?:\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|'|"))/g) ?? []
        for (const operador of operadores) {
            lineas.push((operador.match(cadena) ?? []).map(decodificar).join(''))
        }
        if (lineas.length > 0) salida.push(lineas.join(' '))
    }
    return salida
}

/** Texto del PDF (hasta 40 000 caracteres); vacío si no tiene texto extraíble. */
export function textoDePdf(pdf: Buffer): string {
    const binario = pdf.toString('latin1')
    const partes: string[] = []
    const flujo = /<<([\s\S]*?)>>\s*stream\r?\n/g
    let m: RegExpExecArray | null
    while ((m = flujo.exec(binario)) !== null) {
        const inicio = m.index + m[0].length
        const fin = binario.indexOf('endstream', inicio)
        if (fin === -1) break
        const datos = pdf.subarray(inicio, fin)
        let contenido: string | null = null
        if (/\/FlateDecode/.test(m[1]!)) {
            try {
                contenido = inflateSync(datos).toString('latin1')
            } catch {
                contenido = null
            }
        } else if (!/\/Filter/.test(m[1]!)) {
            contenido = datos.toString('latin1')
        }
        if (contenido) partes.push(...cadenas(contenido))
        flujo.lastIndex = fin
        if (partes.join('\n').length > MAXIMO_TEXTO) break
    }
    return partes
        .join('\n')
        .replaceAll(/[^\S\n]+/g, ' ')
        .trim()
        .slice(0, MAXIMO_TEXTO)
}
