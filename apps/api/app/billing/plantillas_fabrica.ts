import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { contextoSistema } from '#shared/contexto'
import CrearPlantilla, { type EntradaCrearPlantilla } from '#billing/actions/crear_plantilla'

/**
 * Plantillas de facturación de fábrica (decisión del PM, 18 nov: «por defecto la de genera 1 vence
 * 15»). `vence_en = inicio del periodo + dias_gracia`, así que «vence 15» con periodo el día 1 son 14
 * días de gracia. El resto de los campos lleva los valores por defecto de `CrearPlantilla`.
 *
 * En febrero, «Genera 14 · vence 29» vence el 29 de febrero (año bisiesto) o el 1 de marzo: así se
 * decidió.
 */
export interface PlantillaFabrica extends Omit<EntradaCrearPlantilla, 'por_defecto'> {
    /** se crea marcada `por_defecto` solo si ninguna plantilla de la instalación lo está */
    por_defecto_si_no_hay?: boolean
}

export const PLANTILLAS_FABRICA: readonly PlantillaFabrica[] = [
    {
        nombre: 'Genera 1 · vence 15',
        ciclo: 'dia_fijo',
        dia: 1,
        dias_gracia: 14,
        por_defecto_si_no_hay: true,
    },
    { nombre: 'Genera 14 · vence 29', ciclo: 'dia_fijo', dia: 14, dias_gracia: 15 },
    { nombre: 'Genera 1 · vence 5', ciclo: 'dia_fijo', dia: 1, dias_gracia: 4 },
]

/** Clave del advisory lock: dos `db:seed` a la vez no crean dos veces. */
const LOCK_PLANTILLAS_FABRICA = 7_303_101

export interface ResultadoSembrarPlantillas {
    creadas: string[]
    /** ya existía una plantilla con ese nombre: no se toca */
    existentes: string[]
    /** nombre de la que quedó marcada por defecto en esta corrida (null: no se marcó ninguna) */
    marcada: string | null
}

/**
 * Crea las plantillas de fábrica que falten, **por la acción `CrearPlantilla`** con actor sistema
 * (canal `consola`): cada una deja su fila en `audit.acciones` y sus valores en `audit.cambios`.
 *
 * - Idempotente: una plantilla con el mismo nombre (exacto; `nombre` es único) no se duplica ni se
 *   modifica. Repetirlo no hace nada.
 * - «Genera 1 · vence 15» se crea marcada `por_defecto` solo si ninguna plantilla lo está; si la
 *   instalación ya tiene una marcada, se respeta y la de fábrica queda sin marca.
 * - Todo en una transacción con advisory lock (dos corridas simultáneas no chocan).
 *
 * La corre `database/seeders/plantillas_facturacion_seeder.ts` (`node ace db:seed`, que el servicio
 * `migrate` ejecuta en cada actualización, después de las migraciones).
 */
export function sembrarPlantillasFabrica(): Promise<ResultadoSembrarPlantillas> {
    return sembrarPlantillas(PLANTILLAS_FABRICA)
}

/** `sembrarPlantillasFabrica` con otra lista (las pruebas usan nombres propios). */
export async function sembrarPlantillas(
    lista: readonly PlantillaFabrica[],
): Promise<ResultadoSembrarPlantillas> {
    return db.transaction(async (trx) => {
        await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [LOCK_PLANTILLAS_FABRICA])
        return sembrarEn(trx, lista)
    })
}

async function sembrarEn(
    trx: TransactionClientContract,
    lista: readonly PlantillaFabrica[],
): Promise<ResultadoSembrarPlantillas> {
    const resultado: ResultadoSembrarPlantillas = { creadas: [], existentes: [], marcada: null }
    const nombres = lista.map((p) => p.nombre)
    const existentes = new Set(
        (
            (await trx
                .from('billing.plantillas_facturacion')
                .whereIn('nombre', nombres)
                .select('nombre')) as Array<{ nombre: string }>
        ).map((f) => f.nombre),
    )
    const hayMarcada = Boolean(
        await trx.from('billing.plantillas_facturacion').where('por_defecto', true).select('id').first(),
    )
    const ctx = contextoSistema('consola')
    for (const { por_defecto_si_no_hay: marcable, ...plantilla } of lista) {
        if (existentes.has(plantilla.nombre)) {
            resultado.existentes.push(plantilla.nombre)
            continue
        }
        const marcar = Boolean(marcable) && !hayMarcada && resultado.marcada === null
        await new CrearPlantilla().execute({ ...plantilla, por_defecto: marcar }, ctx, { trx })
        resultado.creadas.push(plantilla.nombre)
        if (marcar) resultado.marcada = plantilla.nombre
    }
    return resultado
}
