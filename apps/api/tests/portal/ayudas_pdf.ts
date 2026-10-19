import { inflateSync } from 'node:zlib'

/**
 * Texto de un PDF de pdfkit (fuentes estándar, WinAnsi) para las pruebas: descomprime cada
 * flujo FlateDecode y junta, sin separador, los textos hex de los operadores `TJ` (los espacios
 * son los del documento; los cortes de línea no dejan marca).
 *
 * Cada flujo se lee con los `/Length` bytes que declara su diccionario, como un lector de PDF, y
 * no buscando `endstream`: pdfkit escribe `stream\n<datos>\nendstream`, y cuando el último byte
 * comprimido es `0x0D` (el byte bajo de la suma Adler-32, ~1 de cada 256 documentos según su
 * contenido) un regex `\r?\nendstream` se comía ese byte, el inflado fallaba y el texto salía
 * vacío. Un flujo FlateDecode que no infla es un error, nunca texto vacío.
 */
export function textoDePdf(pdf: Buffer): string {
    const binario = pdf.toString('latin1')
    const textos: string[] = []
    // `N G obj << … >> stream`: el diccionario no cruza un `endobj` (no se mezcla con otro objeto)
    const objetos = /\d+ \d+ obj\s*<<((?:(?!endobj)[^])*?)>>\s*stream\r?\n/g
    let objeto: RegExpExecArray | null
    while ((objeto = objetos.exec(binario))) {
        const diccionario = objeto[1]!
        const largo = /\/Length (\d+)(?!\d)(?! \d+ R)/.exec(diccionario)
        if (!largo) throw new Error('textoDePdf: flujo sin /Length directo')
        const inicio = objeto.index + objeto[0].length
        const crudo = pdf.subarray(inicio, inicio + Number(largo[1]))
        const fin = inicio + crudo.length
        if (!/^\r?\n?endstream/.test(binario.slice(fin, fin + 12))) {
            throw new Error(`textoDePdf: /Length ${largo[1]} no termina en endstream`)
        }
        // el siguiente objeto se busca después de los datos, nunca dentro de ellos
        objetos.lastIndex = fin
        const contenido = /\/Filter \/FlateDecode/.test(diccionario)
            ? inflateSync(crudo).toString('latin1')
            : crudo.toString('latin1')
        for (const linea of contenido.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
            const partes = [...linea[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) =>
                Buffer.from(h[1]!, 'hex').toString('latin1'),
            )
            textos.push(partes.join(''))
        }
    }
    return textos.join('')
}
