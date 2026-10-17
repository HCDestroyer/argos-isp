import { createHash } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import type { ArchivoOrigen, Entidad, ProblemaFila } from '#importacion/canonico'
import ArchivarFilasOrigen, { type FilaArchivo } from '#importacion/actions/archivar_filas_origen'

/**
 * Archivo del origen y **cuadre por tabla** (decisión del PM: "se debe traer todo, para no perder
 * ni dejar volando datos"). Cada fila de cada tabla del origen termina en exactamente uno de:
 *
 * - `importada`: tiene registro en ArgosIsp (creado en esta corrida o ya importado antes);
 * - `solo_archivo`: sin equivalente en ArgosIsp (otra tabla, un traslado, una promesa vencida…);
 * - `omitida`: con motivo (moneda, formato, referencia faltante, una acción que la rechazó).
 *
 * Si alguna fila no cae en ninguno, la corrida falla (`FilasSinContar`) y no se guarda nada.
 */

/** Resultado de una entidad canónica en la corrida (lo anota el importador). */
export interface ResultadoEntidad {
    /** `a_saldo`: entra en el saldo de un cliente (saldo inicial), no como registro propio */
    estado: 'creado' | 'existente' | 'a_saldo' | 'omitido' | 'solo_archivo'
    /** registro de ArgosIsp al que se llevó (tipo de entidad y id) */
    entidad_tipo?: string | null
    entidad_id?: number | null
    motivo?: string | null
}

export interface CuadreTabla {
    tabla: string
    leidas: number
    /** con registro en ArgosIsp: creadas en esta corrida */
    creadas: number
    /** con registro en ArgosIsp: ya importadas antes */
    existentes: number
    /** su monto entra en el saldo de un cliente (saldo inicial), sin registro propio */
    al_saldo: number
    solo_archivo: number
    omitidas: number
    /** filas que no cayeron en ningún estado: si hay alguna, la corrida falla */
    sin_contar: number
}

export class FilasSinContar extends Error {
    constructor(
        readonly tablas: CuadreTabla[],
        readonly ejemplos: string[],
    ) {
        super(
            'Cuadre por tabla: hay filas del origen que no quedaron importadas, en el archivo ni omitidas con motivo ' +
                `(${tablas.map((t) => `${t.tabla}: ${t.sin_contar}`).join(', ')}; por ejemplo ${ejemplos.join(', ')}). ` +
                'No se guardó nada.',
        )
    }
}

/** Columnas que son credenciales: se guardan como `***`. */
const CREDENCIAL = /pass|secret|token|clave|contrasen|pwd|api_?key|hash|private|llave/i

/** Enmascara credenciales: columnas con nombre de credencial y `value` de los atributos de contraseña (radcheck). */
export function enmascararFila(fila: Record<string, string | null>): Record<string, string | null> {
    const salida: Record<string, string | null> = {}
    const atributoClave = /password/i.test(String(fila.attribute ?? ''))
    for (const [columna, valor] of Object.entries(fila)) {
        const credencial = CREDENCIAL.test(columna) || (atributoClave && columna === 'value')
        salida[columna] = credencial && valor !== null && valor !== '' ? '***' : valor
    }
    return salida
}

function sha1(texto: string): string {
    return createHash('sha1').update(texto).digest('hex')
}

/** Id de la fila en el origen: su columna `id` (sin ceros a la izquierda) o una huella de la fila. */
function idDeFila(fila: Record<string, string | null>): string {
    const id = (fila.id ?? '').trim()
    if (id) return /^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, '') : id
    return `h:${sha1(JSON.stringify(fila)).slice(0, 16)}`
}

/** Tabla de un problema (`mikrowisp.sql:facturas` → `facturas`; CSV: el archivo). */
function tablaDe(archivo: string): string {
    const i = archivo.lastIndexOf(':')
    return i === -1 ? archivo : archivo.slice(i + 1)
}

export interface OpcionesArchivo {
    sistema: string
    archivo: ArchivoOrigen
    resultados: Map<string, ResultadoEntidad>
    problemas: ProblemaFila[]
    ctx: ContextoAccion
    trx: TransactionClientContract
    /** filas por lote de la acción (por defecto 500) */
    lote?: number
}

/** Clave de un resultado del importador: `<entidad>:<id canónico>`. */
export function claveResultado(entidad: Entidad, id: string): string {
    return `${entidad}:${id}`
}

/**
 * Cuenta cada fila del origen y la guarda en `importacion.filas_origen` (solo lo que cambió desde
 * la última corrida). Lanza `FilasSinContar` si alguna fila no quedó contada.
 */
export async function archivarYCuadrar(o: OpcionesArchivo): Promise<CuadreTabla[]> {
    const omitidasPorProblema = new Map<string, string>()
    for (const p of o.problemas) {
        if (p.aviso) continue
        const clave = `${tablaDe(p.archivo)}#${p.linea}`
        if (!omitidasPorProblema.has(clave)) omitidasPorProblema.set(clave, p.mensaje)
    }

    const cuadres: CuadreTabla[] = []
    const ejemplos: string[] = []
    for (const t of o.archivo.tablas) {
        const cuadre: CuadreTabla = {
            tabla: t.tabla,
            leidas: t.filas.length,
            creadas: 0,
            existentes: 0,
            al_saldo: 0,
            solo_archivo: 0,
            omitidas: 0,
            sin_contar: 0,
        }
        const filas: FilaArchivo[] = []
        const vistos = new Map<string, number>()
        t.filas.forEach((cruda, i) => {
            const linea = t.lineas?.[i] ?? i + 1
            const clave = `${t.tabla}#${linea}`
            let estado: FilaArchivo['estado'] | null = null
            let entidadTipo: string | null = null
            let entidadId: number | null = null
            let motivo: string | null = null

            const vinculo = o.archivo.vinculos.get(clave)
            const resultado = vinculo
                ? o.resultados.get(claveResultado(vinculo.entidad, vinculo.id))
                : undefined
            if (resultado) {
                if (['creado', 'existente', 'a_saldo'].includes(resultado.estado)) {
                    if (resultado.entidad_tipo) {
                        estado = 'importada'
                        entidadTipo = resultado.entidad_tipo
                        entidadId = resultado.entidad_id ?? null
                        motivo = resultado.motivo ?? null
                        if (resultado.estado === 'creado') cuadre.creadas++
                        else if (resultado.estado === 'existente') cuadre.existentes++
                        else cuadre.al_saldo++
                    }
                } else {
                    estado = resultado.estado === 'solo_archivo' ? 'solo_archivo' : 'omitida'
                    motivo = resultado.motivo || 'sin motivo'
                }
            } else if (omitidasPorProblema.has(clave)) {
                estado = 'omitida'
                motivo = omitidasPorProblema.get(clave)!
            } else if (vinculo) {
                // Va a una entidad que el importador no contó: es un error del importador.
                estado = null
            } else {
                estado = 'solo_archivo'
                motivo =
                    o.archivo.notasFila.get(clave) ??
                    o.archivo.notasTabla[t.tabla] ??
                    'sin equivalente en ArgosIsp'
            }

            if (estado === null) {
                cuadre.sin_contar++
                if (ejemplos.length < 10) ejemplos.push(`${clave} → ${vinculo?.entidad}:${vinculo?.id}`)
                return
            }
            if (estado === 'solo_archivo') cuadre.solo_archivo++
            if (estado === 'omitida') cuadre.omitidas++

            let id = idDeFila(cruda)
            const repetido = vistos.get(id) ?? 0
            vistos.set(id, repetido + 1)
            if (repetido > 0) id = `${id}#${repetido + 1}`
            const fila = enmascararFila(cruda)
            filas.push({
                tabla: t.tabla,
                id_externo: id,
                linea,
                fila,
                estado,
                entidad_tipo: entidadTipo,
                entidad_id: entidadId,
                motivo,
                huella: sha1(JSON.stringify([fila, estado, entidadTipo, entidadId, motivo, linea])),
            })
        })
        cuadres.push(cuadre)
        if (cuadre.sin_contar === 0) await guardar(o, t.tabla, filas)
    }

    const descuadradas = cuadres.filter(
        (c) =>
            c.sin_contar > 0 ||
            c.leidas !== c.creadas + c.existentes + c.al_saldo + c.solo_archivo + c.omitidas,
    )
    if (descuadradas.length > 0) throw new FilasSinContar(descuadradas, ejemplos)
    return cuadres
}

/** Escribe solo las filas nuevas o que cambiaron (por `huella`), en lotes por la acción. */
async function guardar(o: OpcionesArchivo, tabla: string, filas: FilaArchivo[]) {
    const tamano = o.lote ?? 500
    for (let i = 0; i < filas.length; i += tamano) {
        const lote = filas.slice(i, i + tamano)
        const guardadas = (await o.trx
            .from('importacion.filas_origen')
            .where({ origen: o.sistema, tabla })
            .whereIn(
                'id_externo',
                lote.map((f) => f.id_externo),
            )
            .select('id_externo', 'huella')) as Array<{ id_externo: string; huella: string }>
        const huellas = new Map(guardadas.map((g) => [g.id_externo, g.huella]))
        const cambiadas = lote.filter((f) => huellas.get(f.id_externo) !== f.huella)
        if (cambiadas.length === 0) continue
        await new ArchivarFilasOrigen(cambiadas).execute(
            { origen: o.sistema, tabla, filas: cambiadas.length },
            o.ctx,
            { trx: o.trx },
        )
    }
}
