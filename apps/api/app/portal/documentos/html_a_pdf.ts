import PDFDocument from 'pdfkit'
import { Parser } from 'htmlparser2'
import SVGtoPDF from 'svg-to-pdfkit'

/**
 * HTML → PDF sin navegador (pdfkit + htmlparser2), para el aviso de cobro (tarea 8).
 *
 * Por qué no Chromium: la imagen de la API es `node:22-alpine` y Chromium suma ~300 MB y un
 * proceso por PDF. Una plantilla de aviso de cobro es texto, tablas y líneas; este renderizador
 * cubre ese subconjunto de HTML con las fuentes estándar del PDF (Helvetica, WinAnsi: tildes,
 * ñ, ¿¡ y "Q" sin incrustar fuentes).
 *
 * Subconjunto soportado (documentado para el editor de A4 en `app/portal/README.md`):
 * - Bloques: `h1` `h2` `h3` `p` `div` `section` `header` `footer` `ul`/`ol`/`li` `hr` `br` `table`
 *   (`thead` `tbody` `tfoot` `tr` `th` `td`, con `width="40%"` y `colspan`).
 * - En línea: `strong`/`b`, `em`/`i`, `small`, `span`.
 * - Clases: `derecha`, `centro`, `tenue` (gris), `grande`, `negrita`, `caja` (tabla con borde),
 *   `sin-borde`. `style` admite `text-align`, `font-weight: bold`, `font-size: Npx|Npt`, `color: #rgb`.
 * - Imágenes: solo `<img src="clave">` con una clave de `opciones.imagenes` (hoy `empresa:logo`, el
 *   logo de la empresa del documento, PNG o SVG saneado), como bloque propio (no dentro de una
 *   tabla), con `height` (pt, 48 por defecto, de 12 a 120) y `width` opcional; `class="centro"` o
 *   `"derecha"` la alinea. Nunca se descarga nada: un `src` que no está en el mapa se ignora.
 * - Se ignoran `script`, `style`, `head`, `title` y atributos desconocidos.
 */

/** Imagen que el documento puede dibujar con `<img src="clave">`. */
export interface ImagenPdf {
    tipo: 'image/png' | 'image/svg+xml'
    contenido: Buffer
}

interface Nodo {
    tag: string
    attrs: Record<string, string>
    hijos: Array<Nodo | string>
}

type Alineacion = 'left' | 'center' | 'right' | 'justify'

interface Estilo {
    negrita: boolean
    cursiva: boolean
    tamano: number
    color: string
    alinear: Alineacion
}

interface Tramo {
    texto: string
    estilo: Estilo
}

const VACIOS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col'])
const IGNORADOS = new Set(['script', 'style', 'head', 'title', 'img'])
const BLOQUES = new Set([
    'p',
    'div',
    'section',
    'header',
    'footer',
    'article',
    'main',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'hr',
    'table',
    'body',
    'html',
])

const BASE: Estilo = { negrita: false, cursiva: false, tamano: 10, color: '#111827', alinear: 'left' }
const TENUE = '#6b7280'
const BORDE = '#d1d5db'
const FONDO_TH = '#f3f4f6'
const MARGEN = 48
const RELLENO = 4
const INTERLINEA = 1.5

export function parsearHtml(html: string): Nodo {
    const raiz: Nodo = { tag: 'raiz', attrs: {}, hijos: [] }
    const pila: Nodo[] = [raiz]
    const parser = new Parser(
        {
            onopentag(nombre, attrs) {
                const nodo: Nodo = { tag: nombre.toLowerCase(), attrs, hijos: [] }
                pila.at(-1)!.hijos.push(nodo)
                if (!VACIOS.has(nodo.tag)) pila.push(nodo)
            },
            ontext(texto) {
                pila.at(-1)!.hijos.push(texto)
            },
            onclosetag(nombre) {
                const tag = nombre.toLowerCase()
                if (VACIOS.has(tag)) return
                const indice = pila.findLastIndex((n) => n.tag === tag)
                if (indice > 0) pila.length = indice
            },
        },
        { decodeEntities: true, lowerCaseTags: true },
    )
    parser.write(html)
    parser.end()
    return raiz
}

function clases(nodo: Nodo): Set<string> {
    return new Set((nodo.attrs.class ?? '').split(/\s+/).filter(Boolean))
}

/** Estilo del nodo a partir del heredado, su etiqueta, sus clases y su `style`. */
function estiloDe(nodo: Nodo, heredado: Estilo): Estilo {
    const e: Estilo = { ...heredado }
    switch (nodo.tag) {
        case 'h1':
            Object.assign(e, { negrita: true, tamano: 18 })
            break
        case 'h2':
            Object.assign(e, { negrita: true, tamano: 14 })
            break
        case 'h3':
        case 'h4':
            Object.assign(e, { negrita: true, tamano: 11.5 })
            break
        case 'strong':
        case 'b':
        case 'th':
            e.negrita = true
            break
        case 'em':
        case 'i':
            e.cursiva = true
            break
        case 'small':
            e.tamano = heredado.tamano * 0.85
            break
    }
    const c = clases(nodo)
    if (c.has('derecha')) e.alinear = 'right'
    if (c.has('centro')) e.alinear = 'center'
    if (c.has('tenue')) e.color = TENUE
    if (c.has('negrita')) e.negrita = true
    if (c.has('grande')) e.tamano = e.tamano * 1.3
    if (nodo.attrs.align && ['left', 'center', 'right', 'justify'].includes(nodo.attrs.align)) {
        e.alinear = nodo.attrs.align as Alineacion
    }
    for (const regla of (nodo.attrs.style ?? '').split(';')) {
        const [prop = '', valor = ''] = regla.split(':').map((p) => p.trim().toLowerCase())
        if (prop === 'text-align' && ['left', 'center', 'right', 'justify'].includes(valor)) {
            e.alinear = valor as Alineacion
        } else if (prop === 'font-weight') {
            e.negrita = valor === 'bold' || Number(valor) >= 600
        } else if (prop === 'font-style') {
            e.cursiva = valor === 'italic'
        } else if (prop === 'font-size') {
            const tamano = Number.parseFloat(valor)
            if (tamano >= 5 && tamano <= 40) e.tamano = valor.endsWith('px') ? tamano * 0.75 : tamano
        } else if (prop === 'color' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(valor)) {
            e.color = valor
        }
    }
    return e
}

function fuente(e: Estilo): string {
    if (e.negrita && e.cursiva) return 'Helvetica-BoldOblique'
    if (e.negrita) return 'Helvetica-Bold'
    if (e.cursiva) return 'Helvetica-Oblique'
    return 'Helvetica'
}

/** WinAnsi no tiene todo Unicode: comillas y guiones tipográficos pasan; lo demás, `?`. */
const TIPOGRAFICOS = new Set(['–', '—', '‘', '’', '“', '”', '•', '€', '…'])

function aWinAnsi(texto: string): string {
    let salida = ''
    for (const caracter of texto) {
        const punto = caracter.codePointAt(0)!
        salida += punto <= 0xff || TIPOGRAFICOS.has(caracter) ? caracter : '?'
    }
    return salida
}

/** Tramos de texto en línea de `nodo` (los bloques internos se separan con salto de línea). */
function tramos(nodo: Nodo, estilo: Estilo, salida: Tramo[] = []): Tramo[] {
    for (const hijo of nodo.hijos) {
        if (typeof hijo === 'string') {
            salida.push({ texto: hijo.replace(/\s+/g, ' '), estilo })
            continue
        }
        if (IGNORADOS.has(hijo.tag)) continue
        if (hijo.tag === 'br') {
            salida.push({ texto: '\n', estilo })
            continue
        }
        const interno = estiloDe(hijo, estilo)
        const bloque = BLOQUES.has(hijo.tag)
        if (bloque && salida.length > 0 && !salida.at(-1)!.texto.endsWith('\n')) {
            salida.push({ texto: '\n', estilo })
        }
        tramos(hijo, interno, salida)
        if (bloque) salida.push({ texto: '\n', estilo })
    }
    return salida
}

/** Limpia espacios: sin espacio al inicio de línea ni antes de un salto, sin saltos al final. */
function normalizar(lista: Tramo[]): Tramo[] {
    const salida: Tramo[] = []
    let inicioDeLinea = true
    for (const tramo of lista) {
        let texto = tramo.texto
        if (inicioDeLinea) texto = texto.replace(/^ +/, '')
        texto = texto
            .replace(/ +\n/g, '\n')
            .replace(/\n +/g, '\n')
            .replace(/\n{2,}/g, '\n')
        if (texto === '') continue
        if (texto === '\n' && (salida.length === 0 || salida.at(-1)!.texto.endsWith('\n'))) continue
        salida.push({ texto, estilo: tramo.estilo })
        inicioDeLinea = texto.endsWith('\n')
    }
    while (salida.length > 0 && /^\s*$/.test(salida.at(-1)!.texto)) salida.pop()
    if (salida.length > 0) {
        const ultimo = salida.at(-1)!
        ultimo.texto = ultimo.texto.replace(/\s+$/, '')
    }
    return salida
}

type Doc = InstanceType<typeof PDFDocument>

class Renderizador {
    constructor(
        private readonly doc: Doc,
        private readonly imagenes: Record<string, ImagenPdf> = {},
    ) {}

    /** `<img src="clave">` del mapa de imágenes, como bloque; lo demás se ignora. */
    imagen(nodo: Nodo, x: number, ancho: number): void {
        const imagen = this.imagenes[nodo.attrs.src ?? '']
        if (!imagen) return
        const numero = (valor: string | undefined) => {
            const n = Number.parseFloat(valor ?? '')
            return Number.isFinite(n) && n > 0 ? n : null
        }
        const alto = Math.min(120, Math.max(12, numero(nodo.attrs.height) ?? 48))
        const caja = Math.min(ancho, numero(nodo.attrs.width) ?? ancho / 2)
        this.saltoSiHaceFalta(alto + 6)
        const c = clases(nodo)
        const alinear = c.has('centro') ? 'center' : c.has('derecha') ? 'right' : 'left'
        const y = this.doc.y
        try {
            if (imagen.tipo === 'image/png') {
                // tamaño en la cabecera IHDR del PNG (ancho y alto, 4 bytes cada uno desde el byte 16)
                const anchoPng = imagen.contenido.readUInt32BE(16)
                const altoPng = imagen.contenido.readUInt32BE(20)
                const escala = Math.min(caja / anchoPng, alto / altoPng)
                const w = anchoPng * escala
                const posicion =
                    alinear === 'right' ? x + ancho - w : alinear === 'center' ? x + (ancho - w) / 2 : x
                this.doc.image(imagen.contenido, posicion, y, { width: w, height: altoPng * escala })
            } else {
                const posicion =
                    alinear === 'right' ? x + ancho - caja : alinear === 'center' ? x + (ancho - caja) / 2 : x
                const aspecto =
                    alinear === 'right'
                        ? 'xMaxYMin meet'
                        : alinear === 'center'
                          ? 'xMidYMin meet'
                          : 'xMinYMin meet'
                SVGtoPDF(this.doc as never, imagen.contenido.toString('utf8'), posicion, y, {
                    width: caja,
                    height: alto,
                    preserveAspectRatio: aspecto,
                })
            }
        } catch {
            // Un logo dañado no impide el documento: queda el nombre de la empresa en texto.
            return
        }
        this.doc.x = x
        this.doc.y = y + alto + 6
    }

    get ancho(): number {
        return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right
    }

    get limiteInferior(): number {
        return this.doc.page.height - this.doc.page.margins.bottom
    }

    /** Separa los tramos en líneas (por `\n`); cada línea conserva sus estilos. */
    private lineas(lista: Tramo[]): Tramo[][] {
        const salida: Tramo[][] = [[]]
        for (const tramo of normalizar(lista)) {
            const partes = tramo.texto.split('\n')
            partes.forEach((parte, i) => {
                if (parte) salida.at(-1)!.push({ texto: aWinAnsi(parte), estilo: tramo.estilo })
                if (i < partes.length - 1) salida.push([])
            })
        }
        return salida.filter((linea) => linea.length > 0)
    }

    private usar(e: Estilo): this {
        this.doc.font(fuente(e)).fontSize(e.tamano).fillColor(e.color)
        return this
    }

    private anchoDe(linea: Tramo[]): number {
        return linea.reduce((total, t) => this.usar(t.estilo).doc.widthOfString(t.texto) + total, 0)
    }

    private altoDeLinea(linea: Tramo[]): number {
        const mayor = linea.reduce((a, b) => (b.estilo.tamano > a.estilo.tamano ? b : a))
        this.usar(mayor.estilo)
        return this.doc.currentLineHeight(true) + INTERLINEA
    }

    /**
     * Escribe tramos en `x`, `y` con `ancho`; devuelve el `y` final. Cada línea que cabe se
     * coloca a mano (mezcla de estilos y alineación exacta); una que no cabe se deja a pdfkit para
     * que la corte, con el estilo de su primer tramo (pierde negritas internas, no el texto).
     */
    escribir(lista: Tramo[], x: number, y: number, ancho: number, alinear?: Alineacion): number {
        let cursor = y
        for (const linea of this.lineas(lista)) {
            const alineacion = alinear ?? linea[0]!.estilo.alinear
            const total = this.anchoDe(linea)
            if (total <= ancho + 0.01) {
                let posicion = x
                if (alineacion === 'right') posicion = x + ancho - total
                else if (alineacion === 'center') posicion = x + (ancho - total) / 2
                const alto = this.altoDeLinea(linea)
                for (const tramo of linea) {
                    this.usar(tramo.estilo)
                    this.doc.text(tramo.texto, posicion, cursor, { lineBreak: false })
                    posicion += this.doc.widthOfString(tramo.texto)
                }
                cursor += alto
            } else {
                this.usar(linea[0]!.estilo)
                const texto = linea.map((t) => t.texto).join('')
                this.doc.text(texto, x, cursor, { width: ancho, align: alineacion, lineGap: INTERLINEA })
                cursor = this.doc.y
            }
        }
        this.doc.x = x
        this.doc.y = cursor
        return cursor
    }

    /** Alto que ocupará `escribir` con los mismos tramos y ancho. */
    medir(lista: Tramo[], ancho: number): number {
        let alto = 0
        for (const linea of this.lineas(lista)) {
            if (this.anchoDe(linea) <= ancho + 0.01) {
                alto += this.altoDeLinea(linea)
            } else {
                this.usar(linea[0]!.estilo)
                const texto = linea.map((t) => t.texto).join('')
                alto += this.doc.heightOfString(texto, { width: ancho, lineGap: INTERLINEA })
            }
        }
        return alto
    }

    saltoSiHaceFalta(alto: number): void {
        if (this.doc.y + alto > this.limiteInferior) {
            this.doc.addPage()
            this.doc.y = this.doc.page.margins.top
        }
    }

    bloque(nodo: Nodo, estilo: Estilo, x: number, ancho: number): void {
        let enLinea: Tramo[] = []
        const vaciar = () => {
            if (normalizar(enLinea).length > 0) {
                this.saltoSiHaceFalta(estilo.tamano * 1.5)
                this.doc.y = this.escribir(enLinea, x, this.doc.y, ancho)
            }
            enLinea = []
        }

        for (const hijo of nodo.hijos) {
            if (typeof hijo === 'string') {
                enLinea.push({ texto: hijo.replace(/\s+/g, ' '), estilo })
                continue
            }
            if (hijo.tag === 'img') {
                vaciar()
                this.imagen(hijo, x, ancho)
                continue
            }
            if (IGNORADOS.has(hijo.tag)) continue
            if (hijo.tag === 'br') {
                enLinea.push({ texto: '\n', estilo })
                continue
            }
            const interno = estiloDe(hijo, estilo)
            if (!BLOQUES.has(hijo.tag)) {
                tramos({ tag: 'span', attrs: {}, hijos: [hijo] }, estilo, enLinea)
                continue
            }
            vaciar()
            switch (hijo.tag) {
                case 'hr':
                    this.saltoSiHaceFalta(12)
                    this.doc.y += 4
                    this.doc
                        .moveTo(x, this.doc.y)
                        .lineTo(x + ancho, this.doc.y)
                        .lineWidth(0.75)
                        .strokeColor(BORDE)
                        .stroke()
                    this.doc.y += 8
                    break
                case 'table':
                    this.tabla(hijo, interno, x, ancho)
                    this.doc.y += 8
                    break
                case 'ul':
                case 'ol':
                    this.lista(hijo, interno, x, ancho)
                    this.doc.y += 4
                    break
                default: {
                    const encabezado = /^h[1-4]$/.test(hijo.tag)
                    if (encabezado) this.doc.y += interno.tamano * 0.3
                    this.bloque(hijo, interno, x, ancho)
                    if (hijo.tag === 'p' || encabezado) this.doc.y += interno.tamano * 0.45
                }
            }
        }
        vaciar()
    }

    lista(nodo: Nodo, estilo: Estilo, x: number, ancho: number): void {
        let numero = 0
        for (const item of nodo.hijos) {
            if (typeof item === 'string' || item.tag !== 'li') continue
            numero += 1
            const marca = nodo.tag === 'ol' ? `${numero}. ` : '• '
            const contenido = tramos(item, estiloDe(item, estilo))
            this.saltoSiHaceFalta(this.medir(contenido, ancho - 14))
            const y = this.doc.y
            this.escribir([{ texto: marca, estilo }], x, y, 14)
            this.doc.y = this.escribir(contenido, x + 14, y, ancho - 14)
        }
    }

    tabla(nodo: Nodo, estilo: Estilo, x: number, ancho: number): void {
        const filas: Array<{ celdas: Nodo[]; seccion: string }> = []
        const recoger = (n: Nodo, seccion: string) => {
            for (const hijo of n.hijos) {
                if (typeof hijo === 'string') continue
                if (hijo.tag === 'tr') {
                    filas.push({
                        celdas: hijo.hijos.filter(
                            (c): c is Nodo => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'),
                        ),
                        seccion,
                    })
                } else if (['thead', 'tbody', 'tfoot'].includes(hijo.tag)) {
                    recoger(hijo, hijo.tag)
                }
            }
        }
        recoger(nodo, 'tbody')
        if (filas.length === 0) return

        const columnas = Math.max(
            ...filas.map((f) => f.celdas.reduce((s, c) => s + Math.max(1, Number(c.attrs.colspan) || 1), 0)),
        )
        const anchos = this.anchosColumnas(filas, columnas, ancho)
        const conBorde = clases(nodo).has('caja')
        const sinBorde = clases(nodo).has('sin-borde')

        for (const fila of filas) {
            const celdas: Array<{
                nodo: Nodo
                x: number
                ancho: number
                contenido: Tramo[]
                estilo: Estilo
            }> = []
            let columna = 0
            for (const celda of fila.celdas) {
                const span = Math.max(1, Number(celda.attrs.colspan) || 1)
                const cx = x + anchos.slice(0, columna).reduce((a, b) => a + b, 0)
                const cAncho = anchos.slice(columna, columna + span).reduce((a, b) => a + b, 0)
                const cEstilo = estiloDe(celda, estilo)
                celdas.push({
                    nodo: celda,
                    x: cx,
                    ancho: cAncho,
                    contenido: tramos(celda, cEstilo),
                    estilo: cEstilo,
                })
                columna += span
            }
            const alto =
                Math.max(14, ...celdas.map((c) => this.medir(c.contenido, c.ancho - RELLENO * 2))) +
                RELLENO * 2
            this.saltoSiHaceFalta(alto)
            const y = this.doc.y
            const encabezado = fila.seccion === 'thead' || fila.celdas.every((c) => c.tag === 'th')
            if (encabezado && !sinBorde) {
                this.doc.rect(x, y, ancho, alto).fill(FONDO_TH)
            }
            for (const celda of celdas) {
                this.escribir(
                    celda.contenido,
                    celda.x + RELLENO,
                    y + RELLENO,
                    celda.ancho - RELLENO * 2,
                    celda.estilo.alinear,
                )
                if (conBorde) {
                    this.doc.rect(celda.x, y, celda.ancho, alto).lineWidth(0.5).strokeColor(BORDE).stroke()
                }
            }
            if (!conBorde && !sinBorde) {
                this.doc
                    .moveTo(x, y + alto)
                    .lineTo(x + ancho, y + alto)
                    .lineWidth(0.5)
                    .strokeColor(BORDE)
                    .stroke()
            }
            this.doc.x = x
            this.doc.y = y + alto
        }
    }

    private anchosColumnas(filas: Array<{ celdas: Nodo[] }>, columnas: number, ancho: number): number[] {
        const porcentajes: Array<number | null> = Array.from({ length: columnas }, () => null)
        for (const fila of filas) {
            let columna = 0
            for (const celda of fila.celdas) {
                const span = Math.max(1, Number(celda.attrs.colspan) || 1)
                const valor = /^(\d+(?:\.\d+)?)%$/.exec(celda.attrs.width ?? '')
                if (span === 1 && valor && porcentajes[columna] === null) {
                    porcentajes[columna] = Number(valor[1])
                }
                columna += span
            }
        }
        const definidos = porcentajes.filter((p): p is number => p !== null)
        const usado = Math.min(
            100,
            definidos.reduce((a, b) => a + b, 0),
        )
        const libres = porcentajes.length - definidos.length
        const resto = libres > 0 ? (100 - usado) / libres : 0
        const total = porcentajes.reduce<number>((s, p) => s + (p ?? resto), 0) || 100
        return porcentajes.map((p) => ((p ?? resto) / total) * ancho)
    }
}

export interface OpcionesPdf {
    titulo?: string
    /** comprimir los flujos del PDF (por defecto sí; las pruebas lo apagan para leer el texto) */
    comprimir?: boolean
    /** imágenes que la plantilla puede dibujar con `<img src="clave">` (el logo de la empresa) */
    imagenes?: Record<string, ImagenPdf>
}

/** Convierte el HTML (ya renderizado con Mustache) en un PDF tamaño carta. */
export function htmlAPdf(html: string, opciones: OpcionesPdf = {}): Promise<Buffer> {
    const doc = new PDFDocument({
        size: 'LETTER',
        margin: MARGEN,
        compress: opciones.comprimir ?? true,
        info: { Title: opciones.titulo ?? 'Documento', Producer: 'ArgosIsp', Creator: 'ArgosIsp' },
    })
    const partes: Buffer[] = []
    const listo = new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (parte: Buffer) => partes.push(parte))
        doc.on('end', () => resolve(Buffer.concat(partes)))
        doc.on('error', reject)
    })
    const raiz = parsearHtml(html)
    const cuerpo = buscar(raiz, 'body') ?? raiz
    new Renderizador(doc, opciones.imagenes).bloque(cuerpo, BASE, MARGEN, doc.page.width - MARGEN * 2)
    doc.end()
    return listo
}

function buscar(nodo: Nodo, tag: string): Nodo | null {
    for (const hijo of nodo.hijos) {
        if (typeof hijo === 'string') continue
        if (hijo.tag === tag) return hijo
        const interno = buscar(hijo, tag)
        if (interno) return interno
    }
    return null
}
