import { esCuentaDelKardex } from '#fiscal/l10n/gt/cuentas'
import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Extractos y conciliación bancaria (contrato de localización fiscal §10.3): lectura.
 *
 * Una conciliación **liga** una línea del extracto con movimientos que ya están en el libro (en la
 * cuenta del extracto); nunca reescribe un asiento. Las filas de un mismo acto comparten `grupo`
 * y se deshacen juntas (`ledger.conciliaciones_anulaciones`). Una conciliación vigente = sin
 * anulación.
 */

/** Lock por cuenta bancaria: importar y conciliar en la misma cuenta van de uno en uno. */
export const LOCK_CONCILIACION = 3011

/** Texto normalizado para la huella (sin espacios repetidos, minúsculas). */
function normal(texto: string | null | undefined): string {
    return (texto ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Huella de una línea: fecha, monto, referencia, descripción y el número de aparición de esa misma
 * combinación en el archivo (dos depósitos iguales el mismo día son dos líneas). Reimportar un
 * archivo que se solapa da las mismas huellas y se detecta (odoo §6).
 */
export function huellasDeLineas(
    lineas: Array<{ fecha: string; monto: string; referencia?: string | null; descripcion: string }>,
): string[] {
    const vistas = new Map<string, number>()
    return lineas.map((l) => {
        const base = `${l.fecha}|${aTexto(l.monto)}|${normal(l.referencia)}|${normal(l.descripcion)}`
        const n = (vistas.get(base) ?? 0) + 1
        vistas.set(base, n)
        return createHash('sha256').update(`${base}|${n}`, 'utf8').digest('hex')
    })
}

const VIGENTE = (alias: string) =>
    `NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones xa WHERE xa.conciliacion_id = ${alias}.id)`

export interface ExtractoVista {
    id: number
    empresa_id: number
    cuenta_id: number
    cuenta_codigo: string
    cuenta_nombre: string
    cuenta_bancaria_id: number | null
    desde: string
    hasta: string
    saldo_inicial: string
    saldo_final: string
    archivo: string | null
    sha256: string | null
    motivo_no_encadena: string | null
    lineas: number
    conciliadas: number
    importado_por: number | null
    created_at: Date
}

function consultaExtractos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.extractos as e')
        .join('ledger.cuentas as c', 'c.id', 'e.cuenta_id')
        .select(
            'e.id',
            'e.empresa_id',
            'e.cuenta_id',
            'c.codigo as cuenta_codigo',
            'c.nombre as cuenta_nombre',
            'e.cuenta_bancaria_id',
            cliente.raw(`to_char(e.desde, 'YYYY-MM-DD') as desde`),
            cliente.raw(`to_char(e.hasta, 'YYYY-MM-DD') as hasta`),
            'e.saldo_inicial',
            'e.saldo_final',
            'e.archivo',
            'e.sha256',
            'e.motivo_no_encadena',
            cliente.raw(
                `(SELECT count(*)::int FROM ledger.extractos_lineas l WHERE l.extracto_id = e.id) as lineas`,
            ),
            cliente.raw(
                `(SELECT count(DISTINCT l.id)::int FROM ledger.extractos_lineas l
                    JOIN ledger.conciliaciones k ON k.linea_id = l.id AND ${VIGENTE('k')}
                   WHERE l.extracto_id = e.id) as conciliadas`,
            ),
            'e.importado_por',
            'e.created_at',
        )
}

export async function verExtracto(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaExtractos(cliente).where('e.id', id).first()) as ExtractoVista | null
    if (!fila) throw new NoEncontrado(`El extracto ${id} no existe`)
    return fila
}

export async function listarExtractos(
    filtros: OpcionesPaginacion & { cuenta_id?: number },
    empresas: number[] | null,
) {
    const consulta = consultaExtractos(db.connection()).if(filtros.cuenta_id, (q) =>
        q.where('e.cuenta_id', filtros.cuenta_id!),
    )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('e.empresa_id', ids))
    return paginar<ExtractoVista>(consulta, filtros, { columna: 'e.id' })
}

/** Empresa de un extracto o de una línea (para exigir el acceso en la ruta). */
export async function empresaDe(
    tabla: 'extractos' | 'extractos_lineas' | 'conciliaciones' | 'reglas_conciliacion',
    id: number,
) {
    const fila = await db.from(`ledger.${tabla}`).where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`No existe ${tabla.replace('_', ' ')} ${id}`)
    return { empresa_id: Number(fila.empresa_id) }
}

export interface MovimientoConciliado {
    conciliacion_id: number
    movimiento_id: number
    asiento_id: number
    origen_tipo: string
    origen_id: number | null
    fecha: string
    descripcion: string
    monto: string
}

export interface LineaExtractoVista {
    id: number
    extracto_id: number
    empresa_id: number
    cuenta_id: number
    orden: number
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    saldo: string | null
    huella: string
    conciliada: boolean
    /** id de la primera fila de la conciliación vigente (para anularla) */
    conciliacion_id: number | null
    movimientos: MovimientoConciliado[]
}

async function movimientosConciliados(
    cliente: QueryClientContract,
    lineas: number[],
): Promise<Array<MovimientoConciliado & { linea_id: number; grupo: string }>> {
    if (lineas.length === 0) return []
    return (await cliente
        .from('ledger.conciliaciones as k')
        .join('ledger.movimientos as m', 'm.id', 'k.movimiento_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .whereIn('k.linea_id', lineas)
        .whereRaw(VIGENTE('k'))
        .orderBy('k.id')
        .select(
            'k.id as conciliacion_id',
            'k.linea_id',
            'k.grupo',
            'k.movimiento_id',
            'a.id as asiento_id',
            'a.origen_tipo',
            'a.origen_id',
            cliente.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.descripcion',
            'k.monto',
        )) as Array<MovimientoConciliado & { linea_id: number; grupo: string }>
}

export async function lineasDeExtracto(
    extractoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<LineaExtractoVista[]> {
    const filas = (await cliente
        .from('ledger.extractos_lineas')
        .where('extracto_id', extractoId)
        .orderBy('orden')
        .select(
            'id',
            'extracto_id',
            'empresa_id',
            'cuenta_id',
            'orden',
            cliente.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
            'descripcion',
            'referencia',
            'monto',
            'saldo',
            'huella',
        )) as Array<Omit<LineaExtractoVista, 'conciliada' | 'conciliacion_id' | 'movimientos'>>
    const movs = await movimientosConciliados(
        cliente,
        filas.map((f) => f.id),
    )
    return filas.map((f) => {
        const propios = movs.filter((m) => Number(m.linea_id) === Number(f.id))
        return {
            ...f,
            conciliada: propios.length > 0,
            conciliacion_id: propios[0]?.conciliacion_id ?? null,
            movimientos: propios.map(({ linea_id: _l, grupo: _g, ...m }) => m),
        }
    })
}

export async function verLinea(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = await cliente.from('ledger.extractos_lineas').where('id', id).select('extracto_id').first()
    if (!fila) throw new NoEncontrado(`La línea de extracto ${id} no existe`)
    const lineas = await lineasDeExtracto(Number(fila.extracto_id), cliente)
    return lineas.find((l) => l.id === id)!
}

export interface ConciliacionVista {
    id: number
    grupo: string
    empresa_id: number
    cuenta_id: number
    linea_id: number
    monto: string
    regla_id: number | null
    creado_por: number | null
    created_at: Date
    anulada: boolean
    motivo_anulacion: string | null
    movimientos: MovimientoConciliado[]
}

/** La conciliación (todo su grupo) a la que pertenece la fila `id`. */
export async function verConciliacion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConciliacionVista> {
    const fila = (await cliente.from('ledger.conciliaciones').where('id', id).select('grupo').first()) as {
        grupo: string
    } | null
    if (!fila) throw new NoEncontrado(`La conciliación ${id} no existe`)
    const filas = (await cliente
        .from('ledger.conciliaciones as k')
        .join('ledger.movimientos as m', 'm.id', 'k.movimiento_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .leftJoin('ledger.conciliaciones_anulaciones as x', 'x.conciliacion_id', 'k.id')
        .where('k.grupo', fila.grupo)
        .orderBy('k.id')
        .select(
            'k.id',
            'k.grupo',
            'k.empresa_id',
            'k.cuenta_id',
            'k.linea_id',
            'k.movimiento_id',
            'k.monto',
            'k.regla_id',
            'k.creado_por',
            'k.created_at',
            'a.id as asiento_id',
            'a.origen_tipo',
            'a.origen_id',
            cliente.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.descripcion',
            'x.motivo as motivo_anulacion',
        )) as Array<Record<string, unknown>>
    const primera = filas[0]!
    return {
        id: Number(primera.id),
        grupo: String(primera.grupo),
        empresa_id: Number(primera.empresa_id),
        cuenta_id: Number(primera.cuenta_id),
        linea_id: Number(primera.linea_id),
        monto: aTexto(filas.reduce((s, f) => s.plus(String(f.monto)), CERO)),
        regla_id: primera.regla_id === null ? null : Number(primera.regla_id),
        creado_por: primera.creado_por === null ? null : Number(primera.creado_por),
        created_at: primera.created_at as Date,
        anulada: primera.motivo_anulacion !== null,
        motivo_anulacion: (primera.motivo_anulacion as string | null) ?? null,
        movimientos: filas.map((f) => ({
            conciliacion_id: Number(f.id),
            movimiento_id: Number(f.movimiento_id),
            asiento_id: Number(f.asiento_id),
            origen_tipo: String(f.origen_tipo),
            origen_id: f.origen_id === null ? null : Number(f.origen_id),
            fecha: String(f.fecha),
            descripcion: String(f.descripcion),
            monto: String(f.monto),
        })),
    }
}

export interface MovimientoSinConciliar {
    movimiento_id: number
    asiento_id: number
    origen_tipo: string
    origen_id: number | null
    fecha: string
    descripcion: string
    monto: string
}

/** Movimientos del libro en la cuenta sin conciliación vigente (para elegir al conciliar). */
export async function movimientosSinConciliar(
    empresaId: number,
    cuentaId: number,
    hasta?: string,
    cliente: QueryClientContract = db.connection(),
): Promise<MovimientoSinConciliar[]> {
    return (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('m.cuenta_id', cuentaId)
        .where('a.empresa_id', empresaId)
        .if(hasta, (q) => q.where('a.fecha', '<=', hasta!))
        .whereNotExists((q) =>
            q.from('ledger.conciliaciones as k').whereRaw('k.movimiento_id = m.id').whereRaw(VIGENTE('k')),
        )
        .orderBy('a.fecha')
        .orderBy('m.id')
        .select(
            'm.id as movimiento_id',
            'a.id as asiento_id',
            'a.origen_tipo',
            'a.origen_id',
            cliente.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.descripcion',
            cliente.raw('(m.debe - m.haber)::text as monto'),
        )) as MovimientoSinConciliar[]
}

/*
| Reglas
*/

export interface ReglaConciliacionVista {
    id: number
    empresa_id: number
    nombre: string
    cuenta_id: number | null
    tipo_condicion: 'contiene' | 'regex'
    patron: string
    monto_min: string | null
    monto_max: string | null
    accion: 'contrapartida' | 'cliente'
    contrapartida_cuenta_id: number | null
    contrapartida: string | null
    prioridad: number
    activa: boolean
    version: number
    created_at: Date
    updated_at: Date
}

function consultaReglas(cliente: QueryClientContract) {
    return cliente
        .from('ledger.reglas_conciliacion as r')
        .leftJoin('ledger.cuentas as c', 'c.id', 'r.contrapartida_cuenta_id')
        .select('r.*', 'c.codigo as contrapartida')
}

export async function listarReglas(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
) {
    const consulta = consultaReglas(cliente).orderBy('r.prioridad').orderBy('r.id')
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('r.empresa_id', ids))
    return (await consulta) as ReglaConciliacionVista[]
}

export async function verRegla(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaReglas(cliente).where('r.id', id).first()) as ReglaConciliacionVista | null
    if (!fila) throw new NoEncontrado(`La regla de conciliación ${id} no existe`)
    return fila
}

/** ¿La regla aplica a la línea? (`contiene` sin distinguir mayúsculas; `regex` con la bandera i). */
export function reglaCoincide(
    regla: Pick<
        ReglaConciliacionVista,
        'cuenta_id' | 'tipo_condicion' | 'patron' | 'monto_min' | 'monto_max'
    >,
    linea: { cuenta_id: number; descripcion: string; referencia: string | null; monto: string },
): boolean {
    if (regla.cuenta_id !== null && Number(regla.cuenta_id) !== Number(linea.cuenta_id)) return false
    const monto = dec(linea.monto)
    if (regla.monto_min !== null && monto.lt(regla.monto_min)) return false
    if (regla.monto_max !== null && monto.gt(regla.monto_max)) return false
    const texto = `${linea.descripcion} ${linea.referencia ?? ''}`
    if (regla.tipo_condicion === 'contiene') return texto.toLowerCase().includes(regla.patron.toLowerCase())
    try {
        return new RegExp(regla.patron, 'i').test(texto)
    } catch {
        return false
    }
}

/*
| Reporte de conciliación (§10.3: saldo del libro, del extracto y partidas en tránsito de cada lado)
*/

export interface PartidaEnTransito {
    id: number
    fecha: string
    descripcion: string
    monto: string
}

export interface ResumenConciliacion {
    empresa_id: number
    cuenta_id: number
    cuenta_codigo: string
    cuenta_nombre: string
    fecha: string
    /** saldo de la cuenta en el libro de la empresa al día */
    saldo_libro: string
    /** saldo inicial del primer extracto + Σ líneas al día (null sin extractos) */
    saldo_extracto: string | null
    /** primer día cubierto por extractos */
    desde: string | null
    /** saldo inicial del primer extracto − libro antes de esa fecha (debe ser 0) */
    diferencia_apertura: string
    /** movimientos del libro desde el primer extracto sin conciliar al día (están en el libro, no en el banco) */
    libro_en_transito: PartidaEnTransito[]
    total_libro_en_transito: string
    /** líneas del extracto sin conciliar al día (están en el banco, no en el libro) */
    extracto_en_transito: PartidaEnTransito[]
    total_extracto_en_transito: string
    /** saldo_extracto − (saldo_libro − libro_en_transito + extracto_en_transito): 0 = cuadra */
    diferencia: string
    cuadra: boolean
}

/**
 * Una conciliación cuenta «al día F» si su línea y todos sus movimientos tienen fecha ≤ F; si no,
 * sus partidas siguen en tránsito a esa fecha.
 */
export async function reporteConciliacion(
    empresas: number[] | null,
    filtros: { cuenta_id?: number; fecha?: string },
    cliente: QueryClientContract = db.connection(),
): Promise<ResumenConciliacion[]> {
    const fecha = filtros.fecha ?? hoyGuatemala()
    const cuentas = (await cliente
        .from('ledger.extractos as e')
        .join('ledger.cuentas as c', 'c.id', 'e.cuenta_id')
        .if(filtros.cuenta_id, (q) => q.where('e.cuenta_id', filtros.cuenta_id!))
        .if(empresas !== null, (q) => q.whereIn('e.empresa_id', empresas!))
        .groupBy('e.empresa_id', 'e.cuenta_id', 'c.codigo', 'c.nombre')
        .orderBy('e.empresa_id')
        .orderBy('c.codigo')
        .select(
            'e.empresa_id',
            'e.cuenta_id',
            'c.codigo as cuenta_codigo',
            'c.nombre as cuenta_nombre',
        )) as Array<{ empresa_id: number; cuenta_id: number; cuenta_codigo: string; cuenta_nombre: string }>
    const salida: ResumenConciliacion[] = []
    for (const cuenta of cuentas) {
        salida.push(await resumenDeCuenta(cliente, Number(cuenta.empresa_id), cuenta, fecha))
    }
    return salida
}

async function resumenDeCuenta(
    cliente: QueryClientContract,
    empresaId: number,
    cuenta: { cuenta_id: number; cuenta_codigo: string; cuenta_nombre: string },
    fecha: string,
): Promise<ResumenConciliacion> {
    const cuentaId = Number(cuenta.cuenta_id)
    const suma = async (sql: string, params: Array<string | number>): Promise<Dec> => {
        const r = (await cliente.rawQuery(sql, params)) as { rows: Array<{ s: string | null }> }
        return dec(r.rows[0]?.s ?? '0')
    }
    const saldoLibro = await suma(
        `SELECT sum(m.debe - m.haber)::text AS s FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
          WHERE m.cuenta_id = ? AND a.empresa_id = ? AND a.fecha <= ?`,
        [cuentaId, empresaId, fecha],
    )
    const primero = (await cliente
        .from('ledger.extractos')
        .where({ empresa_id: empresaId, cuenta_id: cuentaId })
        .orderBy('desde')
        .orderBy('id')
        .select(cliente.raw(`to_char(desde, 'YYYY-MM-DD') as desde`), 'saldo_inicial')
        .first()) as { desde: string; saldo_inicial: string } | null
    const desde = primero?.desde ?? null
    // grupos cerrados al día: línea y movimientos con fecha <= F
    const cerrados = `(SELECT k.grupo FROM ledger.conciliaciones k
                         JOIN ledger.extractos_lineas l ON l.id = k.linea_id
                         JOIN ledger.movimientos mm ON mm.id = k.movimiento_id JOIN ledger.asientos aa ON aa.id = mm.asiento_id
                        WHERE k.empresa_id = ? AND k.cuenta_id = ? AND ${VIGENTE('k')}
                        GROUP BY k.grupo HAVING max(l.fecha) <= ? AND max(aa.fecha) <= ?)`
    const libroTransito = desde
        ? (
              (await cliente.rawQuery(
                  `SELECT m.id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.descripcion, (m.debe - m.haber)::text AS monto
                 FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
                WHERE m.cuenta_id = ? AND a.empresa_id = ? AND a.fecha >= ? AND a.fecha <= ?
                  AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.movimiento_id = m.id AND k.grupo IN ${cerrados})
                ORDER BY a.fecha, m.id`,
                  [cuentaId, empresaId, desde, fecha, empresaId, cuentaId, fecha, fecha],
              )) as { rows: PartidaEnTransito[] }
          ).rows
        : []
    const extractoTransito = (
        (await cliente.rawQuery(
            `SELECT l.id, to_char(l.fecha, 'YYYY-MM-DD') AS fecha, l.descripcion, l.monto::text AS monto
               FROM ledger.extractos_lineas l
              WHERE l.cuenta_id = ? AND l.empresa_id = ? AND l.fecha <= ?
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id AND k.grupo IN ${cerrados})
              ORDER BY l.fecha, l.id`,
            [cuentaId, empresaId, fecha, empresaId, cuentaId, fecha, fecha],
        )) as { rows: PartidaEnTransito[] }
    ).rows
    let saldoExtracto: Dec | null = null
    let apertura = CERO
    if (primero) {
        const lineas = await suma(
            `SELECT sum(monto)::text AS s FROM ledger.extractos_lineas WHERE cuenta_id = ? AND empresa_id = ? AND fecha <= ?`,
            [cuentaId, empresaId, fecha],
        )
        saldoExtracto = dec(primero.saldo_inicial).plus(lineas)
        const libroAntes = await suma(
            `SELECT sum(m.debe - m.haber)::text AS s FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
              WHERE m.cuenta_id = ? AND a.empresa_id = ? AND a.fecha < ?`,
            [cuentaId, empresaId, primero.desde],
        )
        apertura = dec(primero.saldo_inicial).minus(libroAntes)
    }
    const totalLibro = libroTransito.reduce((s, p) => s.plus(p.monto), CERO)
    const totalExtracto = extractoTransito.reduce((s, p) => s.plus(p.monto), CERO)
    const diferencia =
        saldoExtracto === null ? CERO : saldoExtracto.minus(saldoLibro.minus(totalLibro).plus(totalExtracto))
    return {
        empresa_id: empresaId,
        cuenta_id: cuentaId,
        cuenta_codigo: cuenta.cuenta_codigo,
        cuenta_nombre: cuenta.cuenta_nombre,
        fecha,
        saldo_libro: aTexto(saldoLibro),
        saldo_extracto: saldoExtracto === null ? null : aTexto(saldoExtracto),
        desde,
        diferencia_apertura: aTexto(apertura),
        libro_en_transito: libroTransito.map((p) => ({ ...p, id: Number(p.id) })),
        total_libro_en_transito: aTexto(totalLibro),
        extracto_en_transito: extractoTransito.map((p) => ({ ...p, id: Number(p.id) })),
        total_extracto_en_transito: aTexto(totalExtracto),
        diferencia: aTexto(diferencia),
        cuadra: diferencia.isZero(),
    }
}

/** Cuentas que no admiten ser contrapartida de una partida del extracto (dinero o auxiliares). */
export function contrapartidaProhibida(codigo: string): boolean {
    return (
        codigo.startsWith(`${CUENTAS.CAJAS}.`) ||
        codigo.startsWith(`${CUENTAS.BANCOS}.`) ||
        codigo.startsWith('1.1.10') ||
        codigo === '1.1.11' ||
        codigo === CUENTAS.CXC_CLIENTES ||
        codigo === CUENTAS.ANTICIPOS_CLIENTES ||
        // H39: 1.1.14 solo la mueve el kardex
        esCuentaDelKardex(codigo)
    )
}
