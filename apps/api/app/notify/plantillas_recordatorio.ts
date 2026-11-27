import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'

/**
 * Plantillas de recordatorio (R1 del plan v3, `contratos/recordatorios.md`): modelo, lectura y la
 * resolución única `plantillaRecordatorioEfectiva` (personalizada > asignada > por defecto).
 *
 * Las acciones que las cambian viven en `actions/` (`crear_plantilla_recordatorio`, …). El cron que
 * las usa para programar es R2: hasta entonces `ProgramarRecordatorios` sigue leyendo
 * `notify.recordatorios`.
 */

export const MAX_PASOS = 8
export const DISPARADORES = ['vencimiento', 'corte_proximo', 'promesa_por_vencer'] as const
export const AVISOS = [
    'factura_por_vencer',
    'factura_vencida',
    'corte_proximo',
    'promesa_por_vencer',
] as const
export const EVENTOS_PLANTILLA = [
    'recordatorio.1',
    'recordatorio.2',
    'recordatorio.3',
    'recordatorio.corte_proximo',
    'recordatorio.promesa_por_vencer',
] as const
export const CANALES_PASO = ['whatsapp', 'correo', 'telegram'] as const

export type Disparador = (typeof DISPARADORES)[number]
export type AvisoRecordatorio = (typeof AVISOS)[number]
export type EventoPlantillaRecordatorio = (typeof EVENTOS_PLANTILLA)[number]
export type CanalPaso = (typeof CANALES_PASO)[number]

/** Paso como llega a una acción: `aviso` y `evento_plantilla` se deducen si no vienen. */
export interface EntradaPaso {
    orden: number
    disparador: Disparador
    dias: number
    /** HH:MM, hora de Guatemala (por defecto 09:00) */
    hora?: string
    aviso?: AvisoRecordatorio
    evento_plantilla?: EventoPlantillaRecordatorio
    /** vacío = el canal que elija Iris (o los locales sin Iris) */
    canales?: CanalPaso[]
    activo?: boolean
}

export interface PasoRecordatorio {
    orden: number
    disparador: Disparador
    dias: number
    /** HH:MM */
    hora: string
    aviso: AvisoRecordatorio
    evento_plantilla: EventoPlantillaRecordatorio
    canales: CanalPaso[]
    activo: boolean
}

export interface PlantillaRecordatorio {
    id: number
    empresa_id: number
    nombre: string
    descripcion: string | null
    por_defecto: boolean
    /** con valor: la plantilla personalizada de ese servicio */
    servicio_id: number | null
    retirada_en: string | null
    retirada_por: number | null
    motivo_retiro: string | null
    pasos: PasoRecordatorio[]
    version: number
    created_at: string
    updated_at: string
}

export type OrigenRecordatorio =
    'personalizada' | 'asignada_servicio' | 'asignada_suscripcion' | 'por_defecto'

export interface PlantillaEfectiva {
    origen: OrigenRecordatorio
    plantilla: PlantillaRecordatorio
}

const EVENTOS_VENCIMIENTO: readonly EventoPlantillaRecordatorio[] = [
    'recordatorio.1',
    'recordatorio.2',
    'recordatorio.3',
]
const AVISOS_VENCIMIENTO: readonly AvisoRecordatorio[] = ['factura_por_vencer', 'factura_vencida']

function avisoPorDefecto(disparador: Disparador, dias: number): AvisoRecordatorio {
    if (disparador === 'corte_proximo') return 'corte_proximo'
    if (disparador === 'promesa_por_vencer') return 'promesa_por_vencer'
    return dias <= 0 ? 'factura_por_vencer' : 'factura_vencida'
}

function eventoPorDefecto(disparador: Disparador, dias: number): EventoPlantillaRecordatorio {
    if (disparador === 'corte_proximo') return 'recordatorio.corte_proximo'
    if (disparador === 'promesa_por_vencer') return 'recordatorio.promesa_por_vencer'
    if (dias < 0) return 'recordatorio.1'
    return dias === 0 ? 'recordatorio.2' : 'recordatorio.3'
}

/**
 * Valida y completa los pasos (422 con un error por campo): a lo sumo 8, `orden` 1 a 8 sin
 * repetir, `dias` −60 a 60 (solo antes o el día en `corte_proximo` y `promesa_por_vencer`), aviso y
 * texto acordes al disparador. Devuelve los pasos ordenados por `orden`.
 */
export function normalizarPasos(pasos: EntradaPaso[]): PasoRecordatorio[] {
    const errores: ErrorCampo[] = []
    if (pasos.length > MAX_PASOS) {
        errores.push({
            field: 'pasos',
            message: `A lo sumo ${MAX_PASOS} pasos por plantilla`,
            rule: 'maxLength',
        })
    }
    const vistos = new Set<number>()
    const salida: PasoRecordatorio[] = []
    pasos.forEach((paso, i) => {
        const campo = (nombre: string) => `pasos.${i}.${nombre}`
        if (!Number.isInteger(paso.orden) || paso.orden < 1 || paso.orden > MAX_PASOS) {
            errores.push({ field: campo('orden'), message: `El orden va de 1 a ${MAX_PASOS}`, rule: 'range' })
        } else if (vistos.has(paso.orden)) {
            errores.push({
                field: campo('orden'),
                message: `El orden ${paso.orden} está repetido`,
                rule: 'distinct',
            })
        }
        vistos.add(paso.orden)
        if (!(DISPARADORES as readonly string[]).includes(paso.disparador)) {
            errores.push({ field: campo('disparador'), message: 'Disparador desconocido', rule: 'enum' })
            return
        }
        if (!Number.isInteger(paso.dias) || paso.dias < -60 || paso.dias > 60) {
            errores.push({ field: campo('dias'), message: 'Los días van de -60 a 60', rule: 'range' })
        } else if (paso.disparador !== 'vencimiento' && paso.dias > 0) {
            errores.push({
                field: campo('dias'),
                message: 'Este disparador solo avisa antes o el mismo día (días ≤ 0)',
                rule: 'max',
            })
        }
        const hora = paso.hora ?? '09:00'
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
            errores.push({ field: campo('hora'), message: 'Hora HH:MM de Guatemala', rule: 'regex' })
        }
        const aviso = paso.aviso ?? avisoPorDefecto(paso.disparador, paso.dias)
        const evento = paso.evento_plantilla ?? eventoPorDefecto(paso.disparador, paso.dias)
        if (paso.disparador === 'vencimiento') {
            if (!AVISOS_VENCIMIENTO.includes(aviso)) {
                errores.push({
                    field: campo('aviso'),
                    message: 'Aviso no válido para el vencimiento',
                    rule: 'enum',
                })
            }
            if (!EVENTOS_VENCIMIENTO.includes(evento)) {
                errores.push({
                    field: campo('evento_plantilla'),
                    message: 'Texto no válido para el vencimiento (recordatorio.1 a recordatorio.3)',
                    rule: 'enum',
                })
            }
        } else {
            if (aviso !== avisoPorDefecto(paso.disparador, paso.dias)) {
                errores.push({
                    field: campo('aviso'),
                    message: `El aviso de este disparador es ${paso.disparador}`,
                    rule: 'enum',
                })
            }
            if (evento !== eventoPorDefecto(paso.disparador, paso.dias)) {
                errores.push({
                    field: campo('evento_plantilla'),
                    message: `El texto de este disparador es recordatorio.${paso.disparador}`,
                    rule: 'enum',
                })
            }
        }
        const canales = [...new Set(paso.canales ?? [])]
        if (canales.some((c) => !(CANALES_PASO as readonly string[]).includes(c))) {
            errores.push({ field: campo('canales'), message: 'Canal desconocido', rule: 'enum' })
        }
        salida.push({
            orden: paso.orden,
            disparador: paso.disparador,
            dias: paso.dias,
            hora,
            aviso,
            evento_plantilla: evento,
            canales: canales.sort() as CanalPaso[],
            activo: paso.activo ?? true,
        })
    })
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Los pasos de la plantilla no son válidos')
    return salida.sort((a, b) => a.orden - b.orden)
}

/**
 * Deja en la base exactamente `pasos` (por `orden`: actualiza los que cambian, agrega los nuevos y
 * borra los que ya no están). Devuelve true si algo cambió.
 */
export async function guardarPasos(
    trx: QueryClientContract,
    plantillaId: number,
    pasos: PasoRecordatorio[],
): Promise<boolean> {
    const actuales = await leerPasos(trx, [plantillaId])
    const antes = new Map((actuales.get(plantillaId) ?? []).map((p) => [p.orden, p]))
    let cambio = false
    for (const paso of pasos) {
        const previo = antes.get(paso.orden)
        antes.delete(paso.orden)
        if (previo && JSON.stringify(previo) === JSON.stringify(paso)) continue
        cambio = true
        const datos = {
            disparador: paso.disparador,
            dias: paso.dias,
            hora: paso.hora,
            aviso: paso.aviso,
            evento_plantilla: paso.evento_plantilla,
            canales: paso.canales,
            activo: paso.activo,
        }
        if (previo) {
            await trx
                .from('notify.plantillas_recordatorio_pasos')
                .where({ plantilla_id: plantillaId, orden: paso.orden })
                .update({
                    ...datos,
                    version: trx.knexRawQuery('version + 1'),
                    updated_at: trx.knexRawQuery('now()'),
                })
        } else {
            await trx
                .insertQuery()
                .table('notify.plantillas_recordatorio_pasos')
                .insert({ plantilla_id: plantillaId, orden: paso.orden, ...datos })
        }
    }
    if (antes.size > 0) {
        cambio = true
        await trx
            .from('notify.plantillas_recordatorio_pasos')
            .where('plantilla_id', plantillaId)
            .whereIn('orden', [...antes.keys()])
            .delete()
    }
    return cambio
}

async function leerPasos(
    cliente: QueryClientContract,
    plantillas: number[],
): Promise<Map<number, PasoRecordatorio[]>> {
    const mapa = new Map<number, PasoRecordatorio[]>()
    if (plantillas.length === 0) return mapa
    const filas = (await cliente
        .from('notify.plantillas_recordatorio_pasos')
        .whereIn('plantilla_id', plantillas)
        .select(
            'plantilla_id',
            'orden',
            'disparador',
            'dias',
            cliente.raw(`to_char(hora, 'HH24:MI') AS hora`),
            'aviso',
            'evento_plantilla',
            'canales',
            'activo',
        )
        .orderBy(['plantilla_id', 'orden'])) as Array<PasoRecordatorio & { plantilla_id: number }>
    for (const { plantilla_id: id, ...paso } of filas) {
        const lista = mapa.get(id) ?? []
        lista.push({ ...paso, canales: [...(paso.canales ?? [])].sort() as CanalPaso[] })
        mapa.set(id, lista)
    }
    return mapa
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'nombre',
    'descripcion',
    'por_defecto',
    'servicio_id',
    'retirada_en',
    'retirada_por',
    'motivo_retiro',
    'version',
    'created_at',
    'updated_at',
]

async function conPasos(
    cliente: QueryClientContract,
    filas: Array<Omit<PlantillaRecordatorio, 'pasos'>>,
): Promise<PlantillaRecordatorio[]> {
    const pasos = await leerPasos(
        cliente,
        filas.map((f) => f.id),
    )
    return filas.map((f) => ({ ...f, pasos: pasos.get(f.id) ?? [] }))
}

/** Plantilla con sus pasos; 404 si no existe. */
export async function obtenerPlantillaRecordatorio(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaRecordatorio> {
    const fila = (await cliente
        .from('notify.plantillas_recordatorio')
        .where('id', id)
        .select(COLUMNAS)
        .first()) as Omit<PlantillaRecordatorio, 'pasos'> | null
    if (!fila) throw new NoEncontrado(`La plantilla de recordatorio ${id} no existe`)
    const [plantilla] = await conPasos(cliente, [fila])
    return plantilla!
}

/** Plantillas de las empresas (null = todas), sin las personalizadas; la por defecto primero. */
export async function listarPlantillasRecordatorio(
    empresas: number[] | null,
    filtros: { incluir_retiradas?: boolean } = {},
): Promise<PlantillaRecordatorio[]> {
    const consulta = db.from('notify.plantillas_recordatorio').whereNull('servicio_id').select(COLUMNAS)
    if (empresas !== null) consulta.whereIn('empresa_id', empresas)
    if (!filtros.incluir_retiradas) consulta.whereNull('retirada_en')
    const filas = (await consulta
        .orderBy('empresa_id')
        .orderBy('por_defecto', 'desc')
        .orderBy('nombre')) as Array<Omit<PlantillaRecordatorio, 'pasos'>>
    return conPasos(db.connection(), filas)
}

/** Lo que se audita de una plantilla: sus campos y sus pasos (sin marcas de tiempo). */
export function paraAuditoria(p: PlantillaRecordatorio): Record<string, unknown> {
    return {
        empresa_id: p.empresa_id,
        nombre: p.nombre,
        descripcion: p.descripcion,
        por_defecto: p.por_defecto,
        servicio_id: p.servicio_id,
        retirada_en: p.retirada_en,
        motivo_retiro: p.motivo_retiro,
        pasos: p.pasos,
    }
}

export interface DestinoRecordatorio {
    empresaId: number
    servicioId?: number | null
    suscripcionId?: number | null
}

/**
 * **Única** resolución de la plantilla de recordatorio que aplica (contrato §3):
 *
 * 1. la personalizada del servicio, si existe;
 * 2. la asignada al servicio o a la suscripción;
 * 3. la por defecto de la empresa.
 *
 * Solo cuentan plantillas de `empresaId` (la de la factura): si un servicio cambió de empresa, su
 * personalizada o asignación de la empresa anterior no rige y aplica la por defecto de la nueva.
 * Sin servicio ni suscripción (cargo único suelto) aplica la por defecto. `null` solo si la empresa
 * no tiene por defecto (no ocurre: la migración y el alta de empresa la siembran).
 */
export async function plantillaRecordatorioEfectiva(
    destino: DestinoRecordatorio,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaEfectiva | null> {
    const servicioId = destino.servicioId ?? null
    const suscripcionId = destino.suscripcionId ?? null
    if (servicioId !== null) {
        const personal = (await cliente
            .from('notify.plantillas_recordatorio')
            .where({ servicio_id: servicioId, empresa_id: destino.empresaId })
            .select('id')
            .first()) as { id: number } | null
        if (personal) {
            return {
                origen: 'personalizada',
                plantilla: await obtenerPlantillaRecordatorio(personal.id, cliente),
            }
        }
    }
    if (servicioId !== null || suscripcionId !== null) {
        const asignada = (await cliente
            .from('notify.recordatorios_asignaciones')
            .where('empresa_id', destino.empresaId)
            .where((q) => {
                if (servicioId !== null) q.orWhere('servicio_id', servicioId)
                if (suscripcionId !== null) q.orWhere('suscripcion_id', suscripcionId)
            })
            // la de la suscripción manda sobre la del servicio al que cuelga (una factura de
            // suscripción es de la suscripción)
            .orderByRaw('suscripcion_id IS NULL')
            .select('plantilla_id', 'suscripcion_id')
            .first()) as { plantilla_id: number; suscripcion_id: number | null } | null
        if (asignada) {
            return {
                origen: asignada.suscripcion_id !== null ? 'asignada_suscripcion' : 'asignada_servicio',
                plantilla: await obtenerPlantillaRecordatorio(asignada.plantilla_id, cliente),
            }
        }
    }
    const defecto = (await cliente
        .from('notify.plantillas_recordatorio')
        .where({ empresa_id: destino.empresaId, por_defecto: true })
        .select('id')
        .first()) as { id: number } | null
    if (!defecto) return null
    return { origen: 'por_defecto', plantilla: await obtenerPlantillaRecordatorio(defecto.id, cliente) }
}

/**
 * Plantilla efectiva de una factura (su empresa, su servicio y, cuando exista la columna de I1, su
 * suscripción). 404 si la factura no existe.
 */
export async function plantillaRecordatorioDeFactura(
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PlantillaEfectiva | null> {
    // `to_jsonb(f)`: lee `suscripcion_id` si la columna existe (I1, A3) sin depender de ella
    const { rows } = (await cliente.rawQuery(
        `SELECT f.empresa_id, f.servicio_id, (to_jsonb(f) ->> 'suscripcion_id')::bigint AS suscripcion_id
           FROM billing.facturas f WHERE f.id = ?`,
        [facturaId],
    )) as { rows: Array<{ empresa_id: number; servicio_id: number | null; suscripcion_id: number | null }> }
    const factura = rows[0]
    if (!factura) throw new NoEncontrado(`La factura ${facturaId} no existe`)
    return plantillaRecordatorioEfectiva(
        {
            empresaId: Number(factura.empresa_id),
            servicioId: factura.servicio_id === null ? null : Number(factura.servicio_id),
            suscripcionId: factura.suscripcion_id === null ? null : Number(factura.suscripcion_id),
        },
        cliente,
    )
}

/**
 * Empresa de una suscripción (`billing.suscripciones`, I1). 404 si no existe o si la tabla aún no
 * existe en esta instalación.
 */
export async function empresaDeSuscripcion(
    suscripcionId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number> {
    const { rows } = (await cliente.rawQuery(
        `SELECT to_regclass('billing.suscripciones') IS NOT NULL AS existe`,
    )) as {
        rows: Array<{ existe: boolean }>
    }
    if (!rows[0]?.existe) throw new NoEncontrado(`La suscripción ${suscripcionId} no existe`)
    const fila = (await cliente
        .from('billing.suscripciones')
        .where('id', suscripcionId)
        .select('empresa_id')
        .first()) as { empresa_id: number } | null
    if (!fila) throw new NoEncontrado(`La suscripción ${suscripcionId} no existe`)
    return Number(fila.empresa_id)
}

export interface RecordatoriosDe {
    empresa_id: number
    servicio_id: number | null
    suscripcion_id: number | null
    /** de dónde sale la que rige */
    origen: OrigenRecordatorio | null
    /** la que rige (null solo si la empresa no tiene por defecto) */
    plantilla: PlantillaRecordatorio | null
    /** la asignada (aunque la personalizada la tape), o null = la por defecto */
    asignada: { plantilla_id: number; nombre: string; retirada: boolean } | null
    personalizada: boolean
}

/** Qué recordatorios rigen para un servicio o una suscripción (para la ficha; sin próximos envíos: R2). */
export async function recordatoriosDe(
    destino: { servicioId?: number; suscripcionId?: number },
    cliente: QueryClientContract = db.connection(),
): Promise<RecordatoriosDe> {
    const servicioId = destino.servicioId ?? null
    const suscripcionId = destino.suscripcionId ?? null
    let empresaId: number
    if (servicioId !== null) {
        const fila = (await cliente
            .from('core.servicios')
            .where('id', servicioId)
            .select('empresa_id')
            .first()) as {
            empresa_id: number
        } | null
        if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
        empresaId = Number(fila.empresa_id)
    } else {
        empresaId = await empresaDeSuscripcion(suscripcionId!, cliente)
    }
    const efectiva = await plantillaRecordatorioEfectiva({ empresaId, servicioId, suscripcionId }, cliente)
    const asignacion = (await cliente
        .from('notify.recordatorios_asignaciones as a')
        .join('notify.plantillas_recordatorio as p', 'p.id', 'a.plantilla_id')
        .where('a.empresa_id', empresaId)
        .where(servicioId !== null ? 'a.servicio_id' : 'a.suscripcion_id', (servicioId ?? suscripcionId)!)
        .select('a.plantilla_id', 'p.nombre', cliente.raw('p.retirada_en IS NOT NULL AS retirada'))
        .first()) as { plantilla_id: number; nombre: string; retirada: boolean } | null
    return {
        empresa_id: empresaId,
        servicio_id: servicioId,
        suscripcion_id: suscripcionId,
        origen: efectiva?.origen ?? null,
        plantilla: efectiva?.plantilla ?? null,
        asignada: asignacion,
        personalizada: efectiva?.origen === 'personalizada',
    }
}

/** 409 `plantilla_duplicada` si ya hay otra plantilla (no personalizada) con ese nombre en la empresa. */
export async function exigirNombreLibre(
    trx: QueryClientContract,
    empresaId: number,
    nombre: string,
    salvo?: number,
): Promise<void> {
    const consulta = trx
        .from('notify.plantillas_recordatorio')
        .where('empresa_id', empresaId)
        .whereNull('servicio_id')
        .whereRaw('lower(btrim(nombre)) = lower(btrim(?))', [nombre])
    if (salvo !== undefined) consulta.whereNot('id', salvo)
    if (await consulta.select('id').first()) {
        throw new Conflicto(
            `Ya existe una plantilla de recordatorio llamada «${nombre.trim()}» en la empresa`,
            'plantilla_duplicada',
            'Plantilla duplicada',
        )
    }
}

/** Bloquea la fila (FOR UPDATE) y devuelve la plantilla con sus pasos. */
export async function bloquearPlantilla(
    trx: QueryClientContract,
    id: number,
): Promise<PlantillaRecordatorio> {
    await trx.from('notify.plantillas_recordatorio').where('id', id).forUpdate().select('id')
    return obtenerPlantillaRecordatorio(id, trx)
}

/** 409 `plantilla_personalizada`: la de un servicio se cambia desde su ficha (personalizar o quitar). */
export function exigirNoPersonalizada(p: PlantillaRecordatorio): void {
    if (p.servicio_id !== null) {
        throw new Conflicto(
            `La plantilla ${p.id} es la personalizada del servicio ${p.servicio_id}: se cambia desde el servicio`,
            'plantilla_personalizada',
            'Plantilla personalizada',
        )
    }
}
