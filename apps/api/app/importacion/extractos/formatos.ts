import type { Celda } from '#importacion/extractos/hoja'

/**
 * Formatos de los estados de cuenta de los bancos de Guatemala (A6). Cada banco exporta su tabla
 * con filas de encabezado antes de los datos (nombre del banco, cuenta, periodo, saldo anterior) y
 * una fila de títulos de columna. Aquí se reconoce:
 *
 * - **la fila de títulos**, por sinónimos de cada papel (`fecha`, `descripcion`, `referencia`,
 *   `debito`, `credito`, `monto`, `saldo`) sin tildes ni mayúsculas;
 * - **el banco**, por su marca en las filas anteriores a los títulos, en el nombre del archivo o
 *   por el banco de la cuenta bancaria elegida.
 *
 * | Banco      | Títulos típicos                                                              |
 * | ---------- | ---------------------------------------------------------------------------- |
 * | Banrural   | Fecha · Agencia · No. Documento · Descripción · Débito · Crédito · Saldo      |
 * | Industrial | Fecha · TT · Descripción · No. Doc · Débito · Crédito · Saldo Contable        |
 * | BAC        | Fecha · Referencia · Descripción · Débitos · Créditos · Balance               |
 * | G&T        | Fecha · Descripción · No. Documento · Cargos · Abonos · Saldo                 |
 * | Promerica  | Fecha · Concepto · Documento · Débito · Crédito · Saldo                       |
 *
 * Todos usan fecha día/mes/año y punto decimal con coma de miles. Un archivo es **reconocido**
 * cuando se identifica el banco y la fila de títulos trae fecha, descripción y débito y crédito (o
 * un monto con signo). Si no, el mapeo es una **sugerencia** que el panel confirma.
 */

export const PAPELES = ['fecha', 'descripcion', 'referencia', 'debito', 'credito', 'monto', 'saldo'] as const
export type Papel = (typeof PAPELES)[number]

export type FormatoFecha = 'dmy' | 'mdy' | 'ymd'
export type Decimal = 'punto' | 'coma'

/** Índice de una columna del archivo (desde 0); nunca un importe. */
export type IndiceColumna = number

/** Mapeo de columnas (índices desde 0) de un estado de cuenta. */
export interface MapeoExtracto {
    /** hoja del libro (null = la primera con datos; en CSV, null) */
    hoja: string | null
    /** número de fila (desde 1) de los títulos de columna; null = el archivo no los trae */
    fila_encabezado: number | null
    /** número de fila (desde 1) del primer movimiento */
    fila_datos: number
    columnas: {
        fecha: number
        descripcion: number
        referencia: number | null
        debito: number | null
        credito: number | null
        /** monto con signo (+ entra, − sale) en vez de débito y crédito */
        monto: IndiceColumna | null
        saldo: IndiceColumna | null
    }
    formato_fecha: FormatoFecha
    decimal: Decimal
    /** títulos normalizados de la fila de encabezado: firma para reconocer el archivo después */
    encabezados: string[]
}

export interface PerfilBanco {
    codigo: 'banrural' | 'industrial' | 'bac' | 'gyt' | 'promerica'
    nombre: string
    /** nombre en `billing.bancos` (catálogo de A3) */
    catalogo: RegExp
    /** marcas del banco en el texto del archivo o en su nombre */
    marcas: RegExp
    formato_fecha: FormatoFecha
    decimal: Decimal
}

export const PERFILES: readonly PerfilBanco[] = [
    {
        codigo: 'banrural',
        nombre: 'Banrural',
        catalogo: /^banrural$/i,
        marcas: /banrural|desarrollo rural/,
        formato_fecha: 'dmy',
        decimal: 'punto',
    },
    {
        codigo: 'industrial',
        nombre: 'Banco Industrial',
        catalogo: /^banco industrial$/i,
        marcas: /banco industrial|bi en linea|bienlinea|\bbi\b/,
        formato_fecha: 'dmy',
        decimal: 'punto',
    },
    {
        codigo: 'bac',
        nombre: 'BAC Credomatic',
        catalogo: /^bac/i,
        marcas: /\bbac\b|credomatic/,
        formato_fecha: 'dmy',
        decimal: 'punto',
    },
    {
        codigo: 'gyt',
        nombre: 'Banco G&T Continental',
        catalogo: /g\s*&\s*t/i,
        marcas: /g\s*&\s*t|g y t continental|gytcontinental|\bgyt\b/,
        formato_fecha: 'dmy',
        decimal: 'punto',
    },
    {
        codigo: 'promerica',
        nombre: 'Banco Promerica',
        catalogo: /promerica/i,
        marcas: /promerica/,
        formato_fecha: 'dmy',
        decimal: 'punto',
    },
]

export function perfilPorCodigo(codigo: string | null | undefined): PerfilBanco | null {
    return PERFILES.find((p) => p.codigo === codigo) ?? null
}

/** Perfil del banco del catálogo (`billing.bancos.nombre`). */
export function perfilDelCatalogo(nombreBanco: string | null | undefined): PerfilBanco | null {
    if (!nombreBanco) return null
    return PERFILES.find((p) => p.catalogo.test(nombreBanco)) ?? null
}

/** Texto sin tildes, en minúsculas, sin signos ni espacios repetidos. */
export function normalizarTitulo(texto: Celda): string {
    return (texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\b(q|gtq|quetzales)\b/g, ' ')
        .replace(/[^a-z0-9/&]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const SINONIMOS: Record<Papel, string[]> = {
    fecha: [
        'fecha',
        'fecha transaccion',
        'fecha de transaccion',
        'fecha operacion',
        'fecha de operacion',
        'fecha contable',
        'fecha movimiento',
        'fecha valor',
        'fecha registro',
        'f operacion',
        'date',
    ],
    descripcion: [
        'descripcion',
        'concepto',
        'detalle',
        'descripcion transaccion',
        'descripcion de la transaccion',
        'descripcion movimiento',
        'transaccion',
        'observaciones',
        'narrativa',
        'description',
    ],
    referencia: [
        'referencia',
        'documento',
        'no documento',
        'no doc',
        'no de documento',
        'numero documento',
        'numero de documento',
        'num documento',
        'doc',
        'no referencia',
        'numero referencia',
        'no boleta',
        'boleta',
        'cheque',
        'no cheque',
        'reference',
    ],
    debito: [
        'debito',
        'debitos',
        'debe',
        'cargo',
        'cargos',
        'retiro',
        'retiros',
        'salida',
        'salidas',
        'egreso',
        'egresos',
        'debit',
    ],
    credito: [
        'credito',
        'creditos',
        'haber',
        'abono',
        'abonos',
        'deposito',
        'depositos',
        'entrada',
        'entradas',
        'ingreso',
        'ingresos',
        'credit',
    ],
    monto: ['monto', 'importe', 'valor', 'amount'],
    saldo: ['saldo', 'saldo contable', 'saldo disponible', 'saldo final', 'balance', 'saldo actual'],
}

/** Papel que sugiere un título de columna, o null. */
export function papelDeTitulo(titulo: Celda): Papel | null {
    const t = normalizarTitulo(titulo)
    if (!t) return null
    for (const papel of PAPELES) {
        if (SINONIMOS[papel].includes(t)) return papel
    }
    // «Débito (Q)», «Saldo al cierre», «Fecha de la operación»: empieza con un sinónimo de una palabra
    const primera = t.split(' ')[0]!
    for (const papel of PAPELES) {
        if (SINONIMOS[papel].some((s) => !s.includes(' ') && s === primera && s.length > 3)) return papel
    }
    return null
}

/** Columnas por papel de una fila de títulos (la primera columna que encaja en cada papel). */
export function papelesDeFila(fila: Celda[]): Partial<Record<Papel, number>> {
    const papeles: Partial<Record<Papel, number>> = {}
    fila.forEach((celda, i) => {
        const papel = papelDeTitulo(celda)
        if (papel && papeles[papel] === undefined) papeles[papel] = i
    })
    return papeles
}

function completo(p: Partial<Record<Papel, number>>): boolean {
    return (
        p.fecha !== undefined &&
        p.descripcion !== undefined &&
        ((p.debito !== undefined && p.credito !== undefined) || p.monto !== undefined)
    )
}

export interface Deteccion {
    perfil: PerfilBanco | null
    /** banco identificado por la marca del archivo (no solo por la cuenta) */
    marca: boolean
    mapeo: MapeoExtracto
    reconocido: boolean
}

const FILAS_BUSQUEDA = 40

/**
 * Detecta la fila de títulos y el banco. `bancoCuenta`: perfil del banco de la cuenta elegida (se
 * usa si el archivo no trae su marca). Siempre devuelve un mapeo: si no reconoce el formato, es la
 * mejor sugerencia (la fila con más títulos conocidos o, sin títulos, la forma de los datos).
 */
export function detectarFormato(
    filas: Celda[][],
    nombreArchivo: string,
    hoja: string | null,
    bancoCuenta: PerfilBanco | null,
): Deteccion {
    let mejor: { fila: number; papeles: Partial<Record<Papel, number>>; puntos: number } | null = null
    for (let r = 0; r < Math.min(filas.length, FILAS_BUSQUEDA); r++) {
        const papeles = papelesDeFila(filas[r]!)
        const puntos = Object.keys(papeles).length + (completo(papeles) ? 10 : 0)
        if (puntos >= 2 && (!mejor || puntos > mejor.puntos)) mejor = { fila: r, papeles, puntos }
        if (completo(papeles)) break
    }

    const textoPrevio = filas
        .slice(0, mejor ? mejor.fila : Math.min(filas.length, 15))
        .flat()
        .map(normalizarTitulo)
        .join(' ')
    const archivo = normalizarTitulo(nombreArchivo.replace(/\.[a-z0-9]+$/i, ''))
    const porMarca = PERFILES.find((p) => p.marcas.test(textoPrevio) || p.marcas.test(archivo)) ?? null
    const perfil = porMarca ?? bancoCuenta

    if (mejor && completo(mejor.papeles)) {
        const p = mejor.papeles
        const usarMonto = p.debito === undefined || p.credito === undefined
        return {
            perfil,
            marca: porMarca !== null,
            reconocido: perfil !== null,
            mapeo: {
                hoja,
                fila_encabezado: mejor.fila + 1,
                fila_datos: mejor.fila + 2,
                columnas: {
                    fecha: p.fecha!,
                    descripcion: p.descripcion!,
                    referencia: p.referencia ?? null,
                    debito: usarMonto ? null : p.debito!,
                    credito: usarMonto ? null : p.credito!,
                    monto: usarMonto ? p.monto! : null,
                    saldo: p.saldo ?? null,
                },
                formato_fecha: perfil?.formato_fecha ?? 'dmy',
                decimal: perfil?.decimal ?? 'punto',
                encabezados: filas[mejor.fila]!.map(normalizarTitulo),
            },
        }
    }
    return { perfil, marca: porMarca !== null, reconocido: false, mapeo: sugerirPorDatos(filas, hoja, mejor) }
}

/** Sugerencia sin fila de títulos completa: por la forma de los datos (fechas, textos y números). */
function sugerirPorDatos(
    filas: Celda[][],
    hoja: string | null,
    parcial: { fila: number; papeles: Partial<Record<Papel, number>> } | null,
): MapeoExtracto {
    // Primera fila con una fecha: ahí empiezan los datos
    let inicio = filas.findIndex((f) => f.some((c) => leerFecha(c, 'dmy') !== null))
    if (inicio < 0) inicio = parcial ? parcial.fila + 1 : 0
    const muestra = filas.slice(inicio, inicio + 30)
    const ancho = Math.max(0, ...filas.map((f) => f.length))
    const conteo = (pred: (c: Celda) => boolean) =>
        Array.from({ length: ancho }, (_, c) => muestra.filter((f) => pred(f[c] ?? null)).length)
    const fechas = conteo((c) => leerFecha(c, 'dmy') !== null)
    const numeros = conteo((c) => c !== null && /^[-+(]?\s*(q\s*)?[\d.,]+\)?-?$/i.test(c))
    const textos = Array.from({ length: ancho }, (_, c) =>
        muestra.reduce((s, f) => s + (f[c] && !/^[-\d.,/ ()]+$/.test(f[c]!) ? f[c]!.length : 0), 0),
    )
    const p = { ...(parcial?.papeles ?? {}) }
    const indiceMax = (v: number[], excluir: number[]) =>
        v.reduce((m, x, i) => (excluir.includes(i) || x <= 0 ? m : m < 0 || x > v[m]! ? i : m), -1)
    if (p.fecha === undefined) {
        const f = indiceMax(fechas, [])
        if (f >= 0) p.fecha = f
    }
    if (p.descripcion === undefined) {
        const d = indiceMax(textos, [p.fecha ?? -1])
        if (d >= 0) p.descripcion = d
    }
    const usadas = Object.values(p) as number[]
    const numericas = numeros
        .map((n, i) => ({ n, i }))
        .filter((x) => x.n > 0 && !usadas.includes(x.i) && x.i !== p.fecha)
        .map((x) => x.i)
    // Lo usual: … débito · crédito · saldo (el saldo, a la derecha)
    if (p.debito === undefined && p.credito === undefined && p.monto === undefined) {
        if (numericas.length >= 3) {
            p.debito = numericas[numericas.length - 3]
            p.credito = numericas[numericas.length - 2]
            p.saldo = p.saldo ?? numericas[numericas.length - 1]
        } else if (numericas.length === 2) {
            p.monto = numericas[0]
            p.saldo = p.saldo ?? numericas[1]
        } else if (numericas.length === 1) {
            p.monto = numericas[0]
        }
    }
    const usarMonto = p.debito === undefined || p.credito === undefined
    const encabezado = parcial && parcial.fila < inicio ? parcial.fila : inicio > 0 ? inicio - 1 : null
    return {
        hoja,
        fila_encabezado: encabezado === null ? null : encabezado + 1,
        fila_datos: inicio + 1,
        columnas: {
            fecha: p.fecha ?? 0,
            descripcion: p.descripcion ?? 1,
            referencia: p.referencia ?? null,
            debito: usarMonto ? null : p.debito!,
            credito: usarMonto ? null : p.credito!,
            monto: usarMonto ? (p.monto ?? null) : null,
            saldo: p.saldo ?? null,
        },
        formato_fecha: 'dmy',
        decimal: 'punto',
        encabezados: encabezado === null ? [] : filas[encabezado]!.map(normalizarTitulo),
    }
}

/**
 * Ubica un mapeo guardado en el archivo: busca su fila de títulos (la misma firma) en las primeras
 * filas y corrige el desplazamiento si el banco agregó o quitó filas de encabezado. null si la
 * firma no aparece (el banco cambió el formato).
 */
export function ubicarMapeoGuardado(filas: Celda[][], guardado: MapeoExtracto): MapeoExtracto | null {
    if (guardado.fila_encabezado === null || guardado.encabezados.length === 0) return null
    const firma = guardado.encabezados.filter((t) => t !== '').join('|')
    for (let r = 0; r < Math.min(filas.length, FILAS_BUSQUEDA); r++) {
        const titulos = filas[r]!.map(normalizarTitulo)
        if (titulos.filter((t) => t !== '').join('|') !== firma) continue
        const desplazamiento = r + 1 - guardado.fila_encabezado
        return {
            ...guardado,
            fila_encabezado: r + 1,
            fila_datos: guardado.fila_datos + desplazamiento,
        }
    }
    return null
}

// ── Valores ──────────────────────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
    ene: 1,
    jan: 1,
    feb: 2,
    mar: 3,
    abr: 4,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    aug: 8,
    sep: 9,
    set: 9,
    oct: 10,
    nov: 11,
    dic: 12,
    dec: 12,
}

function fechaIso(y: number, m: number, d: number): string | null {
    if (y < 100) y += 2000
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2200) return null
    const f = new Date(Date.UTC(y, m - 1, d))
    if (f.getUTCMonth() !== m - 1) return null
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Fecha de una celda (`AAAA-MM-DD` de Excel, `dd/mm/aaaa`, `dd-mm-aa`, `02-ene-2026`…), o null. */
export function leerFecha(celda: Celda, formato: FormatoFecha): string | null {
    if (!celda) return null
    const t = celda
        .trim()
        .toLowerCase()
        .replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?\s*m\.?)?$/, '')
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
    if (m) return fechaIso(Number(m[1]), Number(m[2]), Number(m[3]))
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t)
    if (m) {
        const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
        if (formato === 'mdy') return fechaIso(y, a, b)
        if (formato === 'ymd') return null
        return fechaIso(y, b, a)
    }
    m = /^(\d{1,2})[-/ .]([a-z]{3})[a-z]*\.?[-/ .](\d{2}|\d{4})$/.exec(t)
    if (m && MESES[m[2]!]) return fechaIso(Number(m[3]), MESES[m[2]!]!, Number(m[1]))
    return null
}
