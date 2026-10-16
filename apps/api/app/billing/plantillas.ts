import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { normalizarReglasPromesa, type ReglasPromesa } from '#billing/reglas_promesa'
import type { PlantillaBase } from '#billing/excepciones'

/**
 * Plantillas de facturación: lectura, forma pública y reglas de coherencia entre campos.
 */

export interface Plantilla extends PlantillaBase {
    id: number
    /** la plantilla que usa un servicio creado sin `plantilla_facturacion_id` (a lo sumo una) */
    por_defecto: boolean
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS = (cliente: QueryClientContract) => [
    'id',
    'nombre',
    'ciclo',
    'dia',
    'prorrateo',
    'dias_gracia',
    'facturas_para_limitar',
    'facturas_para_cortar',
    'mora_tipo',
    'mora_valor',
    'mora_recurrente',
    cliente.raw(`to_char(hora_corte, 'HH24:MI') as hora_corte`),
    'certificar_al',
    'reglas_promesa',
    'por_defecto',
    'version',
    'created_at',
    'updated_at',
]

function aPlantilla(fila: Record<string, unknown>): Plantilla {
    const plantilla = fila as unknown as Plantilla
    return {
        ...plantilla,
        plantilla_id: plantilla.id,
        reglas_promesa: normalizarReglasPromesa(plantilla.reglas_promesa as ReglasPromesa),
    }
}

export type PlantillaPublica = Omit<Plantilla, 'plantilla_id'>

/** Forma pública (API): sin `plantilla_id` interno. */
export function serializarPlantilla(plantilla: Plantilla): PlantillaPublica {
    const publica: Partial<Plantilla> = { ...plantilla }
    delete publica.plantilla_id
    return publica as PlantillaPublica
}

/** Valores para `audit.cambios` (sin ids ni marcas de tiempo). */
export function paraAuditoria(plantilla: Plantilla | PlantillaPublica): Record<string, unknown> {
    const valores: Record<string, unknown> = { ...plantilla }
    delete valores.id
    delete valores.plantilla_id
    return valores
}

export async function listarPlantillas(cliente: QueryClientContract = db.connection()) {
    const filas = await cliente
        .from('billing.plantillas_facturacion')
        .select(...COLUMNAS(cliente))
        .orderBy('nombre', 'asc')
    return filas.map((fila) => serializarPlantilla(aPlantilla(fila)))
}

export async function obtenerPlantilla(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Plantilla> {
    const fila = await cliente
        .from('billing.plantillas_facturacion')
        .where('id', id)
        .select(...COLUMNAS(cliente))
        .first()
    if (!fila) throw new NoEncontrado(`La plantilla de facturación ${id} no existe`)
    return aPlantilla(fila)
}

/** Campos editables de una plantilla, ya validados por VineJS. */
export interface CamposPlantilla {
    nombre: string
    ciclo: 'dia_fijo' | 'aniversario'
    dia: number | null
    prorrateo: boolean
    dias_gracia: number
    facturas_para_limitar: number
    facturas_para_cortar: number
    mora_tipo: 'ninguna' | 'fija' | 'porcentaje'
    mora_valor: string
    mora_recurrente: boolean
    hora_corte: string
    certificar_al: 'emitir' | 'pagar' | 'nunca'
    reglas_promesa: ReglasPromesa
}

/**
 * Reglas entre campos (422 con todos los errores):
 * - `dia_fijo` exige `dia`; en `aniversario` el día es el de instalación (`dia` = null).
 * - `facturas_para_limitar` ≤ `facturas_para_cortar` (0 = nunca limitar).
 * - mora: `ninguna` ⇒ valor 0; `fija`/`porcentaje` ⇒ valor > 0; porcentaje ≤ 100.
 * - promesas: máximo con buen historial ≥ máximo base.
 */
export function validarCoherencia(campos: CamposPlantilla): CamposPlantilla {
    const errores: ErrorCampo[] = []
    const salida = { ...campos }

    if (salida.ciclo === 'dia_fijo' && (salida.dia === null || salida.dia === undefined)) {
        errores.push({
            field: 'dia',
            message: 'El ciclo dia_fijo exige el día de facturación',
            rule: 'coherencia',
        })
    }
    if (salida.ciclo === 'aniversario') salida.dia = null

    if (salida.facturas_para_limitar > salida.facturas_para_cortar) {
        errores.push({
            field: 'facturas_para_limitar',
            message: 'facturas_para_limitar no puede ser mayor que facturas_para_cortar (0 = no limitar)',
            rule: 'coherencia',
        })
    }

    const mora = dec(salida.mora_valor)
    if (salida.mora_tipo === 'ninguna') {
        salida.mora_valor = '0.00'
    } else if (mora.lte(0)) {
        errores.push({
            field: 'mora_valor',
            message: `La mora ${salida.mora_tipo} exige un valor mayor que 0`,
            rule: 'coherencia',
        })
    } else if (salida.mora_tipo === 'porcentaje' && mora.gt(100)) {
        errores.push({
            field: 'mora_valor',
            message: 'El porcentaje de mora no puede pasar de 100',
            rule: 'coherencia',
        })
    }
    if (salida.mora_tipo !== 'ninguna') salida.mora_valor = mora.toFixed(2)

    const reglas = salida.reglas_promesa
    if (reglas.max_por_periodo_buen_historial < reglas.max_por_periodo) {
        errores.push({
            field: 'reglas_promesa.max_por_periodo_buen_historial',
            message: 'El máximo con buen historial no puede ser menor que el máximo base',
            rule: 'coherencia',
        })
    }

    if (errores.length > 0) throw new ValidacionFallida(errores)
    return salida
}

/*
|--------------------------------------------------------------------------
| Plantilla por defecto
|--------------------------------------------------------------------------
*/

/**
 * Id de la plantilla marcada `por_defecto`, o null si ninguna lo está. La usa A1
 * (`app/core/plantilla_por_defecto.ts`) al crear un servicio sin `plantilla_facturacion_id`.
 */
export async function plantillaPorDefectoId(cliente: QueryClientContract = db.connection()) {
    const fila = await cliente
        .from('billing.plantillas_facturacion')
        .where('por_defecto', true)
        .select('id')
        .first()
    return fila ? Number(fila.id) : null
}

/**
 * Quita la marca a la plantilla por defecto actual (si es otra que `exceptoId`) antes de marcar
 * una nueva: sube su `version` y deja su diff en `audit.cambios`.
 */
export async function desmarcarPorDefecto(t: Transaccion, exceptoId: number | null = null) {
    const filas = (await t.trx
        .from('billing.plantillas_facturacion')
        .where('por_defecto', true)
        .if(exceptoId !== null, (q) => q.whereNot('id', exceptoId!))
        .forUpdate()
        .select('id')) as Array<{ id: number }>
    for (const { id } of filas) {
        await t.trx
            .from('billing.plantillas_facturacion')
            .where('id', id)
            .update({
                por_defecto: false,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'plantilla_facturacion', id },
            { por_defecto: true },
            { por_defecto: false },
        )
    }
}
