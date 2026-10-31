import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Alta de productos por lote (A3, `contratos/inventario.md` D.4; `POST /productos/lote`): una tabla
 * editable que también se llena pegando desde Excel o un CSV, con la entrada opcional a una bodega
 * (saldo inicial `1.1.14 / 2.9.01`). Todo o nada: los errores llegan por fila
 * (`productos.<i>.campo`) y aquí se muestran en su celda.
 */

const CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/
const COSTO = /^\d{1,12}(\.\d{1,6})?$/
const PRECIO = /^\d{1,12}(\.\d{1,2})?$/

export const MAXIMO_FILAS_LOTE = 500

/** Columnas en el orden en que se pegan (la primera fila puede ser el encabezado). */
export const COLUMNAS_LOTE = ['sku', 'nombre', 'tipo', 'unidad', 'modalidad', 'precio_venta', 'cantidad', 'costo_unitario', 'series'] as const
export type ColumnaLote = typeof COLUMNAS_LOTE[number]

export const esquemaFilaLote = z.object({
    sku: z.string().trim().min(1, 'Escribe el SKU').max(60, 'Máximo 60 caracteres'),
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(200, 'Máximo 200 caracteres'),
    tipo: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Elige el tipo'),
    unidad: z.string().trim().max(30, 'Máximo 30 caracteres'),
    /** Vacía = la del tipo. */
    modalidad: z.enum(['', 'comodato', 'consumible_gasto', 'consumible_cobro']),
    precio_venta: z.string().trim().refine(v => v === '' || PRECIO.test(v), 'Precio con hasta 2 decimales'),
    /** Entrada por cantidad. */
    cantidad: z.string().trim().refine(v => v === '' || (CANTIDAD.test(v) && !new Decimal(v).isZero()), 'Cantidad mayor que 0, hasta 3 decimales'),
    costo_unitario: z.string().trim().refine(v => v === '' || COSTO.test(v), 'Costo con hasta 6 decimales'),
    /** Entrada por serie: series o MAC separadas por coma, punto y coma o espacio. */
    series: z.string().trim(),
})

export type FilaLote = z.input<typeof esquemaFilaLote>

export const esquemaLote = z.object({
    bodega_id: z.number().int().nullable(),
    filas: z.array(esquemaFilaLote).min(1, 'Agrega al menos un producto').max(MAXIMO_FILAS_LOTE, `Máximo ${MAXIMO_FILAS_LOTE} productos por lote`),
})

export type EntradaLote = z.input<typeof esquemaLote>

export function filaLoteVacia(tipo = 'material'): FilaLote {
    return { sku: '', nombre: '', tipo, unidad: '', modalidad: '', precio_venta: '', cantidad: '', costo_unitario: '', series: '' }
}

/** Una fila sin nada escrito (no viaja). */
export function filaLoteEnBlanco(fila: FilaLote): boolean {
    return !fila.sku.trim() && !fila.nombre.trim() && !fila.cantidad.trim() && !fila.series.trim()
}

export function seriesDeFila(fila: Pick<FilaLote, 'series'>): string[] {
    return fila.series.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
}

/** Seguimiento de la fila: el de su tipo (las series mandan si las hay). */
export function seguimientoFila(fila: FilaLote, seguimientoTipo: 'cantidad' | 'serie' | undefined): 'cantidad' | 'serie' {
    return seguimientoTipo ?? (seriesDeFila(fila).length ? 'serie' : 'cantidad')
}

/** Separa una línea de CSV o de Excel (tabulador); respeta comillas dobles. */
function celdas(linea: string, separador: string): string[] {
    const salida: string[] = []
    let actual = ''
    let comillas = false
    for (let i = 0; i < linea.length; i++) {
        const c = linea[i]
        if (c === '"') {
            if (comillas && linea[i + 1] === '"') {
                actual += '"'
                i++
            }
            else {
                comillas = !comillas
            }
        }
        else if (c === separador && !comillas) {
            salida.push(actual)
            actual = ''
        }
        else {
            actual += c
        }
    }
    salida.push(actual)
    return salida.map(x => x.trim())
}

const ALIAS: Record<string, ColumnaLote> = {
    sku: 'sku',
    codigo: 'sku',
    nombre: 'nombre',
    producto: 'nombre',
    descripcion: 'nombre',
    tipo: 'tipo',
    unidad: 'unidad',
    modalidad: 'modalidad',
    precio: 'precio_venta',
    precio_venta: 'precio_venta',
    cantidad: 'cantidad',
    existencia: 'cantidad',
    costo: 'costo_unitario',
    costo_unitario: 'costo_unitario',
    series: 'series',
    serie: 'series',
    mac: 'series',
}

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_')
}

const MODALIDADES_TEXTO: Record<string, FilaLote['modalidad']> = {
    comodato: 'comodato',
    gasto: 'consumible_gasto',
    consumible_gasto: 'consumible_gasto',
    cobro: 'consumible_cobro',
    consumible_cobro: 'consumible_cobro',
    venta: 'consumible_cobro',
}

/**
 * Filas pegadas desde Excel (tabuladores) o un CSV (coma o punto y coma). Si la primera fila es un
 * encabezado reconocible, manda el orden de sus columnas; si no, el de `COLUMNAS_LOTE`. El tipo se
 * acepta por código o por nombre (`tipos`), y la modalidad como «gasto», «cobro» o «comodato».
 */
export function filasDesdeTexto(texto: string, tipos: readonly { codigo: string, nombre: string }[]): FilaLote[] {
    const lineas = texto.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())
    const [primera] = lineas
    if (!primera) {
        return []
    }
    const separador = primera.includes('\t') ? '\t' : (primera.split(';').length > primera.split(',').length ? ';' : ',')
    const encabezado = celdas(primera, separador).map(c => ALIAS[normalizar(c)])
    const conEncabezado = encabezado.filter(Boolean).length >= 2
    const orden: (ColumnaLote | undefined)[] = conEncabezado ? encabezado : [...COLUMNAS_LOTE]
    const porNombre = new Map(tipos.flatMap(t => [[normalizar(t.codigo), t.codigo], [normalizar(t.nombre), t.codigo]]))
    return (conEncabezado ? lineas.slice(1) : lineas).map((linea) => {
        const fila = filaLoteVacia('')
        celdas(linea, separador).forEach((valor, i) => {
            const columna = orden[i]
            if (!columna) {
                return
            }
            if (columna === 'tipo') {
                fila.tipo = porNombre.get(normalizar(valor)) ?? normalizar(valor)
            }
            else if (columna === 'modalidad') {
                fila.modalidad = MODALIDADES_TEXTO[normalizar(valor)] ?? ''
            }
            else if (columna === 'precio_venta' || columna === 'costo_unitario' || columna === 'cantidad') {
                fila[columna] = valor.replace(/[Q\s]/g, '').replace(/,(?=\d{3}\b)/g, '')
            }
            else {
                fila[columna] = valor
            }
        })
        return fila
    })
}

type TipoParaLote = { codigo: string, seguimiento_defecto: 'cantidad' | 'serie' }

/** El cuerpo de `POST /productos/lote`; la entrada solo con bodega y algo que entrar. */
export function cuerpoLote(d: EntradaLote, tipos: readonly TipoParaLote[]) {
    return {
        productos: d.filas.map((f) => {
            const seguimientoTipo = tipos.find(t => t.codigo === f.tipo)?.seguimiento_defecto
            const seguimiento = seguimientoFila(f, seguimientoTipo)
            const series = seriesDeFila(f)
            const conEntrada = d.bodega_id !== null && (seguimiento === 'serie' ? series.length > 0 : f.cantidad.trim() !== '')
            const costo = f.costo_unitario.trim() || '0'
            return {
                sku: f.sku.trim(),
                nombre: f.nombre.trim(),
                tipo: f.tipo,
                ...(f.unidad.trim() ? { unidad: f.unidad.trim() } : {}),
                ...(f.modalidad ? { modalidad: f.modalidad } : {}),
                ...(f.precio_venta.trim() ? { precio_venta: f.precio_venta.trim() } : {}),
                ...(conEntrada && d.bodega_id !== null
                    ? { entrada: seguimiento === 'serie'
                            ? { bodega_id: d.bodega_id, unidades: series.map(s => ({ ...serieOMac(s), costo: new Decimal(costo).toFixed(2) })) }
                            : { bodega_id: d.bodega_id, cantidad: f.cantidad.trim(), costo_unitario: costo } }
                    : {}),
            }
        }),
    }
}

/** `productos.3.entrada.cantidad` → `filas.3.cantidad` (el campo de la celda en el formulario). */
export function campoFilaLote(campo: string): string {
    const coincide = /^productos\.(\d+)\.(.+)$/.exec(campo)
    if (!coincide) {
        return campo
    }
    const [, indice, resto = ''] = coincide
    const CAMPOS: Record<string, string> = {
        'seguimiento': 'tipo',
        'entrada.cantidad': 'cantidad',
        'entrada.costo_unitario': 'costo_unitario',
        'entrada.costo_total': 'costo_unitario',
        'entrada.bodega_id': 'bodega',
    }
    const destino = resto.startsWith('entrada.unidades') ? 'series' : (CAMPOS[resto] ?? resto)
    return destino === 'bodega' ? 'bodega_id' : `filas.${indice}.${destino}`
}

/** El índice de la fila que cita un 409 (`productos.4: …` en `detail`), o `null`. */
export function filaDeDetalle(detalle: string | undefined): number | null {
    const coincide = /productos\.(\d+)/.exec(detalle ?? '')
    return coincide ? Number(coincide[1]) : null
}
