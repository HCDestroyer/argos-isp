/**
 * Lector mínimo de un volcado de MySQL (`mysqldump` o la exportación SQL de phpMyAdmin), para
 * importar desde Mikrowisp sin levantar un MySQL. Entiende:
 *
 * - `CREATE TABLE \`t\` (\`col\` tipo ..., PRIMARY KEY ...)`: de ahí salen los nombres de columna.
 * - `INSERT INTO \`t\` VALUES (...),(...);` y `INSERT INTO \`t\` (\`a\`,\`b\`) VALUES (...);`
 *   (también `INSERT IGNORE` y `REPLACE INTO`).
 * - Literales: números, `NULL`, cadenas con comillas simples o dobles y los escapes de MySQL
 *   (`\'`, `\\`, `\n`, `\r`, `\t`, `\0`, `\Z`, comilla doble), hex `0x..` y `_binary '..'`.
 * - Comentarios `-- `, `#` y `/* ... *\/` (incluidos los condicionales `/*!40101 ... *\/`).
 *
 * Todo lo demás (`SET`, `LOCK TABLES`, `DROP TABLE`, índices) se ignora. No ejecuta nada: solo
 * lee. Los valores salen como texto (o null), igual que una fila de CSV.
 */

export type FilaSql = Record<string, string | null>

export interface TablaSql {
    columnas: string[]
    filas: FilaSql[]
}

export class ErrorDumpSql extends Error {}

/** Lee el volcado completo: nombre de tabla (en minúsculas) → columnas y filas. */
export function leerDumpMysql(texto: string): Map<string, TablaSql> {
    const tablas = new Map<string, TablaSql>()
    for (const sentencia of sentencias(texto)) {
        const crear = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s*\(([\s\S]*)\)[^)]*$/i.exec(
            sentencia,
        )
        if (crear) {
            const nombre = nombreTabla(crear[1]!)
            const columnas = columnasDeCreate(crear[2]!)
            tablas.set(nombre, { columnas, filas: tablas.get(nombre)?.filas ?? [] })
            continue
        }
        const insertar =
            /^(?:INSERT(?:\s+IGNORE)?|REPLACE)\s+INTO\s+([`"\w.]+)\s*(\(([^)]*)\))?\s*VALUES\s*([\s\S]*)$/i.exec(
                sentencia,
            )
        if (!insertar) continue
        const nombre = nombreTabla(insertar[1]!)
        const tabla = tablas.get(nombre)
        const columnas = insertar[3]
            ? insertar[3].split(',').map((c) => quitarComillasIdentificador(c.trim()).toLowerCase())
            : tabla?.columnas
        if (!columnas || columnas.length === 0) {
            throw new ErrorDumpSql(`INSERT en ${nombre} sin columnas y sin CREATE TABLE antes`)
        }
        const destino = tabla ?? { columnas, filas: [] }
        for (const valores of tuplas(insertar[4]!, nombre)) {
            if (valores.length !== columnas.length) {
                throw new ErrorDumpSql(
                    `${nombre}: una fila trae ${valores.length} valores y la tabla tiene ${columnas.length} columnas`,
                )
            }
            const fila: FilaSql = {}
            columnas.forEach((c, i) => (fila[c] = valores[i]!))
            destino.filas.push(fila)
        }
        tablas.set(nombre, destino)
    }
    return tablas
}

function nombreTabla(crudo: string): string {
    const partes = crudo.split('.')
    return quitarComillasIdentificador(partes.at(-1)!).toLowerCase()
}

function quitarComillasIdentificador(nombre: string): string {
    return nombre.replace(/^[`"]|[`"]$/g, '')
}

/** Columnas de un CREATE TABLE: cada definición que empieza con un identificador entre comillas o una palabra que no es una clave. */
function columnasDeCreate(cuerpo: string): string[] {
    const columnas: string[] = []
    for (const definicion of dividirNivelSuperior(cuerpo)) {
        const d = definicion.trim()
        if (/^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK)\b/i.test(d)) continue
        const m = /^(`[^`]+`|"[^"]+"|\w+)/.exec(d)
        if (m) columnas.push(quitarComillasIdentificador(m[1]!).toLowerCase())
    }
    return columnas
}

/** Divide por comas que no están dentro de paréntesis ni de comillas. */
function dividirNivelSuperior(texto: string): string[] {
    const partes: string[] = []
    let nivel = 0
    let actual = ''
    let comilla: string | null = null
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i]!
        if (comilla) {
            actual += c
            if (c === '\\') {
                actual += texto[++i] ?? ''
            } else if (c === comilla) {
                comilla = null
            }
            continue
        }
        if (c === "'" || c === '"' || c === '`') comilla = c
        else if (c === '(') nivel++
        else if (c === ')') nivel--
        else if (c === ',' && nivel === 0) {
            partes.push(actual)
            actual = ''
            continue
        }
        actual += c
    }
    if (actual.trim()) partes.push(actual)
    return partes
}

/** Sentencias del volcado sin comentarios, separadas por `;` fuera de comillas. */
function* sentencias(texto: string): Generator<string> {
    let actual = ''
    let i = 0
    const n = texto.length
    while (i < n) {
        const c = texto[i]!
        // Comentarios
        if (c === '-' && texto[i + 1] === '-' && (i + 2 >= n || /\s/.test(texto[i + 2]!))) {
            while (i < n && texto[i] !== '\n') i++
            continue
        }
        if (c === '#') {
            while (i < n && texto[i] !== '\n') i++
            continue
        }
        if (c === '/' && texto[i + 1] === '*') {
            const fin = texto.indexOf('*/', i + 2)
            i = fin === -1 ? n : fin + 2
            continue
        }
        // Cadenas e identificadores entre comillas: se copian tal cual.
        if (c === "'" || c === '"' || c === '`') {
            const inicio = i
            i++
            while (i < n) {
                if (texto[i] === '\\' && c !== '`') {
                    i += 2
                    continue
                }
                if (texto[i] === c) {
                    if (texto[i + 1] === c) {
                        i += 2 // comilla doblada
                        continue
                    }
                    break
                }
                i++
            }
            if (i >= n) throw new ErrorDumpSql('Comillas sin cerrar en el volcado')
            actual += texto.slice(inicio, i + 1)
            i++
            continue
        }
        if (c === ';') {
            if (actual.trim()) yield actual.trim()
            actual = ''
            i++
            continue
        }
        actual += c
        i++
    }
    if (actual.trim()) yield actual.trim()
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', Z: '\x1a', b: '\b' }

/** Tuplas `(v1, v2, ...), (...)` de un VALUES. */
function* tuplas(texto: string, tabla: string): Generator<Array<string | null>> {
    let i = 0
    const n = texto.length
    const saltarEspacios = () => {
        while (i < n && /\s/.test(texto[i]!)) i++
    }
    while (i < n) {
        saltarEspacios()
        if (i >= n) return
        if (texto[i] === ',') {
            i++
            continue
        }
        if (texto[i] !== '(') throw new ErrorDumpSql(`${tabla}: se esperaba "(" en VALUES`)
        i++
        const valores: Array<string | null> = []
        for (;;) {
            saltarEspacios()
            const c = texto[i]
            if (c === undefined) throw new ErrorDumpSql(`${tabla}: fila sin cerrar`)
            if (c === ')') {
                i++
                break
            }
            if (c === ',') {
                i++
                continue
            }
            if (texto.startsWith('_binary', i)) {
                i += '_binary'.length
                saltarEspacios()
                continue
            }
            if (c === "'" || c === '"') {
                i++
                let valor = ''
                for (;;) {
                    const d = texto[i]
                    if (d === undefined) throw new ErrorDumpSql(`${tabla}: cadena sin cerrar`)
                    if (d === '\\') {
                        const e = texto[i + 1] ?? ''
                        valor += ESCAPES[e] ?? e
                        i += 2
                        continue
                    }
                    if (d === c) {
                        if (texto[i + 1] === c) {
                            valor += c
                            i += 2
                            continue
                        }
                        i++
                        break
                    }
                    valor += d
                    i++
                }
                valores.push(valor)
                continue
            }
            // Literal sin comillas: número, NULL, 0x.., hasta la coma o el paréntesis.
            let fin = i
            while (fin < n && texto[fin] !== ',' && texto[fin] !== ')') fin++
            const literal = texto.slice(i, fin).trim()
            i = fin
            if (/^NULL$/i.test(literal)) valores.push(null)
            else if (/^0x[0-9a-f]*$/i.test(literal)) {
                valores.push(Buffer.from(literal.slice(2), 'hex').toString('utf8'))
            } else valores.push(literal)
        }
        yield valores
    }
}
