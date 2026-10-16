import { inflateSync } from 'node:zlib'

/**
 * Texto de un PDF de pdfkit (fuentes estándar, WinAnsi) para las pruebas: descomprime cada
 * flujo FlateDecode y junta, sin separador, los textos hex de los operadores `TJ` (los espacios
 * son los del documento; los cortes de línea no dejan marca).
 */
export function textoDePdf(pdf: Buffer): string {
    const binario = pdf.toString('latin1')
    const textos: string[] = []
    const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
    for (const coincidencia of binario.matchAll(regex)) {
        const crudo = Buffer.from(coincidencia[1]!, 'latin1')
        let contenido: string
        try {
            contenido = inflateSync(crudo).toString('latin1')
        } catch {
            contenido = crudo.toString('latin1')
        }
        for (const linea of contenido.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
            const partes = [...linea[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) =>
                Buffer.from(h[1]!, 'hex').toString('latin1'),
            )
            textos.push(partes.join(''))
        }
    }
    return textos.join('')
}
