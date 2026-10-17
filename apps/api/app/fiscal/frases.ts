import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { PAQUETES, instalacionVigente } from '#fiscal/instalador'
import { datosFiscales, resolver } from '#fiscal/parametros'
import { LocalizacionNoInstalada } from '#fiscal/errores'

/**
 * Frases de los documentos (contrato §3.2 y §6.2).
 *
 * - **Del régimen** (`origen = regimen`): se derivan del régimen vigente en la fecha del documento
 *   (inv. C.2), al leer. No se guardan filas: así no pueden quedar desfasadas de la vigencia del
 *   parámetro `regimen` (por ejemplo, con una primera configuración fechada antes de la instalación).
 * - **Manuales** (`origen = manual`, `fiscal.frases`, solo inserción): las agrega el contador (pago
 *   directo, exportación…). Clave `manual:<tipo_frase>-<escenario>`; la vigente en una fecha es la
 *   fila más reciente de esa clave con `vigente_desde <= fecha`, y si tiene `activa = false` la frase
 *   dejó de aplicar ese día (se retira sin `UPDATE`).
 */

export interface FraseVista {
    /** null en las del régimen (derivadas) */
    id: number | null
    empresa_id: number
    clave: string
    tipo_frase: number | null
    escenario: number | null
    texto: string
    tipos_dte: string[]
    origen: 'regimen' | 'manual'
    activa: boolean
    vigente_desde: string | null
    resolucion: { numero: string; fecha: string } | null
    confirmar_contador: boolean
    fuente: string | null
    motivo: string | null
    creado_por: number | null
    created_at: string | null
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'clave',
    'tipo_frase',
    'escenario',
    'texto',
    'tipos_dte',
    'origen',
    'activa',
    db.raw(`to_char(vigente_desde, 'YYYY-MM-DD') as vigente_desde`),
    'resolucion',
    'confirmar_contador',
    'fuente',
    'motivo',
    'creado_por',
    'created_at',
]

function aVista(fila: Record<string, unknown>): FraseVista {
    return {
        ...(fila as unknown as FraseVista),
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
        created_at: new Date(fila.created_at as string).toISOString(),
    }
}

/** Filas de frases manuales de la empresa (historial), en orden. */
export async function historialFrasesManuales(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FraseVista[]> {
    const filas = (await cliente
        .from('fiscal.frases')
        .where('empresa_id', empresaId)
        .orderBy([
            { column: 'clave', order: 'asc' },
            { column: 'vigente_desde', order: 'asc' },
            { column: 'id', order: 'asc' },
        ])
        .select(COLUMNAS)) as Array<Record<string, unknown>>
    return filas.map(aVista)
}

/** Última fila de cada frase manual con `vigente_desde <= fecha` (activa o retirada). */
export async function frasesManualesEn(
    empresaId: number,
    fecha: string,
    cliente: QueryClientContract = db.connection(),
): Promise<FraseVista[]> {
    const filas = (await cliente
        .from('fiscal.frases')
        .where('empresa_id', empresaId)
        .where('vigente_desde', '<=', fecha)
        .distinctOn('clave')
        .orderBy([
            { column: 'clave', order: 'asc' },
            { column: 'vigente_desde', order: 'desc' },
            { column: 'id', order: 'desc' },
        ])
        .select(COLUMNAS)) as Array<Record<string, unknown>>
    return filas.map(aVista)
}

/** Frases del régimen vigente en `fecha` (derivadas del parámetro `regimen`). */
export async function frasesDeRegimen(
    empresaId: number,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<FraseVista[]> {
    const instalacion = await instalacionVigente(cliente ?? db.connection(), empresaId)
    if (!instalacion) throw new LocalizacionNoInstalada(empresaId)
    const paquete = PAQUETES[instalacion.localizacion_codigo]
    const datos = await datosFiscales(empresaId, cliente)
    const regimen = resolver(datos.filas, 'regimen', fecha)
    if (!paquete || !regimen) return []
    return (paquete.frases_por_regimen[regimen.valor as string] ?? []).map((f) => ({
        id: null,
        empresa_id: empresaId,
        clave: f.clave,
        tipo_frase: f.tipo_frase,
        escenario: f.escenario,
        texto: f.texto,
        tipos_dte: [...f.tipos_dte],
        origen: 'regimen' as const,
        activa: true,
        vigente_desde: regimen.vigente_desde,
        resolucion: null,
        confirmar_contador: f.confirmar_contador,
        fuente: f.fuente,
        motivo: null,
        creado_por: null,
        created_at: null,
    }))
}

/** Frases que aplican en `fecha`: las del régimen y las manuales activas. */
export async function frasesVigentes(
    empresaId: number,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<FraseVista[]> {
    const manuales = await frasesManualesEn(empresaId, fecha, cliente ?? db.connection())
    const delRegimen = await frasesDeRegimen(empresaId, fecha, cliente)
    return [...delRegimen, ...manuales.filter((f) => f.activa)]
}
