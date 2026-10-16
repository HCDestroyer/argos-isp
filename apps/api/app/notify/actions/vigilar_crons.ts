import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    abrirIncidente,
    cerrarIncidente,
    crearAlerta,
    incidentesAbiertos,
    instanteLocal,
    type Incidente,
} from '#notify/alertas'
import { ZONA } from '#notify/formato'

/**
 * Crons de billing (A3) que se vigilan por su corrida en `audit.acciones` (las registra
 * `RegistrarCorrida` con canal `cron`). `cadaMin` es su periodo en `billing/jobs.ts`.
 */
export const CRONS_VIGILADOS = [
    { accion: 'facturas.generar', descripcion: 'La generación de facturas', cadaMin: 60 },
    { accion: 'facturas.vencer_pendientes', descripcion: 'El vencimiento de facturas y mora', cadaMin: 60 },
] as const

export const ACCION_CORTE = 'servicios.corte'
export const TOLERANCIA_POR_DEFECTO_MIN = 30

export interface EntradaVigilar {
    /** instante ISO de la revisión (por defecto, ahora) */
    ahora?: string
}

export interface ResultadoVigilar {
    /** claves de incidente de crons atrasados en esta revisión */
    atrasados: string[]
    /** claves que se resolvieron en esta revisión */
    recuperados: string[]
    encolar: number[]
}

/** Hora de corte efectiva de un servicio: la excepción o la de su plantilla (igual que `EjecutarCorte`). */
const HORA_EFECTIVA = `coalesce(left(e.valor #>> '{}', 5), to_char(p.hora_corte, 'HH24:MI'))`

/**
 * `notificaciones.vigilar_crons` (cron cada 5 min en `notify:worker`): avisa al equipo cuando un
 * cron de facturación o de corte no corrió a su hora, y cuando vuelve a correr.
 *
 * - **Horarios** (`facturas.generar`, `facturas.vencer_pendientes`): atrasado si la última corrida
 *   correcta por cron tiene más de `periodo + NOTIFY_CRON_TOLERANCIA_MIN` (o nunca corrió).
 *   Incidente `cron:<accion>`, abierto hasta que vuelva a correr.
 * - **Corte** (`servicios.corte`): cada hora de corte de hoy (Guatemala) de los servicios vigentes
 *   que ya pasó hace más de la tolerancia y no aparece en `resultado.horas` de una corrida de hoy.
 *   Incidente `cron:servicios.corte:<fecha> <hora>`: una alerta por hora de corte perdida.
 *
 * Solo lee; las corridas las registra A3. Una revisión sin cambios no crea envíos.
 */
export default class VigilarCrons extends DomainAction<EntradaVigilar, ResultadoVigilar> {
    readonly nombre = 'notificaciones.vigilar_crons'

    protected async handle(input: EntradaVigilar, t: Transaccion): Promise<ResultadoVigilar> {
        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        const tolerancia = env.get('NOTIFY_CRON_TOLERANCIA_MIN') ?? TOLERANCIA_POR_DEFECTO_MIN
        const resultado: ResultadoVigilar = { atrasados: [], recuperados: [], encolar: [] }
        const avisar = async (
            incidente: Incidente,
            fase: 'abierto' | 'cerrado',
            alerta: Record<string, unknown>,
        ) => {
            const envio = await crearAlerta(t.trx, {
                incidente,
                fase,
                evento: fase === 'abierto' ? 'alerta.cron.atrasado' : 'alerta.cron.recuperado',
                alerta,
                requestId: t.ctx.requestId,
            })
            if (envio?.estado === 'encolado') resultado.encolar.push(envio.id)
        }

        for (const cron of CRONS_VIGILADOS) {
            const clave = `cron:${cron.accion}`
            const ultima = await ultimaCorrida(t.trx, cron.accion, ahora)
            const limite = ahora.minus({ minutes: cron.cadaMin + tolerancia })
            if (!ultima || ultima < limite) {
                resultado.atrasados.push(clave)
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave,
                    tipo: 'cron',
                    detalle: { accion: cron.accion },
                    ahora,
                })
                if (nuevo) {
                    await avisar(incidente, 'abierto', {
                        nombre: cron.accion,
                        descripcion: cron.descripcion,
                        esperado: instanteLocal(ultima ? ultima.plus({ minutes: cron.cadaMin }) : null),
                        ultima: instanteLocal(ultima),
                    })
                }
            } else {
                const cerrado = await cerrarIncidente(t.trx, clave, ahora)
                if (cerrado) {
                    resultado.recuperados.push(clave)
                    await avisar(cerrado, 'cerrado', {
                        nombre: cron.accion,
                        descripcion: cron.descripcion,
                        ultima: instanteLocal(ultima),
                    })
                }
            }
        }

        await this.vigilarCorte(t.trx, ahora, tolerancia, resultado, avisar)
        return resultado
    }

    private async vigilarCorte(
        trx: TransactionClientContract,
        ahora: DateTime,
        tolerancia: number,
        resultado: ResultadoVigilar,
        avisar: (
            incidente: Incidente,
            fase: 'abierto' | 'cerrado',
            alerta: Record<string, unknown>,
        ) => Promise<void>,
    ) {
        const local = ahora.setZone(ZONA)
        const hoy = local.toISODate()!
        const vencidas = local.minus({ minutes: tolerancia }).toFormat('HH:mm')
        // Horas de corte de hoy que ya debieron correr (solo si no cruzamos la medianoche al restar).
        const horas =
            local.minus({ minutes: tolerancia }).toISODate() === hoy ? await horasDeCorte(trx, vencidas) : []
        const ejecutadas = await horasEjecutadas(trx, hoy)

        const descripcion = (hora: string) => `El corte de las ${hora}`
        for (const hora of horas) {
            if (ejecutadas.has(hora)) continue
            const clave = `cron:${ACCION_CORTE}:${hoy} ${hora}`
            resultado.atrasados.push(clave)
            const { incidente, nuevo } = await abrirIncidente(trx, {
                clave,
                tipo: 'cron.corte',
                detalle: { fecha: hoy, hora },
                ahora,
            })
            if (nuevo) {
                await avisar(incidente, 'abierto', {
                    nombre: ACCION_CORTE,
                    descripcion: descripcion(hora),
                    esperado: `${local.toFormat('dd/MM/yyyy')} ${hora}`,
                    ultima: instanteLocal(await ultimaCorrida(trx, ACCION_CORTE, ahora)),
                })
            }
        }

        // Cortes atrasados que ya corrieron: se resuelven. Los de días anteriores se cierran igual
        // (EjecutarCorte solo recupera las horas del día; un aviso de "resuelto" sería falso).
        for (const abierto of await incidentesAbiertos(trx, 'cron.corte')) {
            const fecha = String(abierto.detalle.fecha ?? '')
            const hora = String(abierto.detalle.hora ?? '')
            const delDia = fecha === hoy ? ejecutadas : await horasEjecutadas(trx, fecha)
            const corrio = delDia.has(hora)
            if (!corrio && fecha === hoy) continue
            const cerrado = await cerrarIncidente(trx, abierto.clave, ahora)
            if (cerrado && corrio) {
                resultado.recuperados.push(abierto.clave)
                await avisar(cerrado, 'cerrado', {
                    nombre: ACCION_CORTE,
                    descripcion: descripcion(hora),
                    ultima: instanteLocal(await ultimaCorrida(trx, ACCION_CORTE, ahora)),
                })
            }
        }
    }
}

/** Última corrida correcta por cron de `accion` (últimos 35 días, para no recorrer todas las particiones). */
async function ultimaCorrida(
    trx: TransactionClientContract,
    accion: string,
    ahora: DateTime,
): Promise<DateTime | null> {
    const fila = (await trx
        .from('audit.acciones')
        .where('accion', accion)
        .where('canal', 'cron')
        .where('resultado', 'ok')
        .where('created_at', '>', ahora.minus({ days: 35 }).toJSDate())
        .where('created_at', '<=', ahora.toJSDate())
        .max('created_at as ultima')
        .first()) as { ultima: Date | null } | null
    return fila?.ultima ? DateTime.fromJSDate(fila.ultima) : null
}

/** Horas de corte (HH:MM) de los servicios vigentes que ya llegaron (`<= hasta`). */
async function horasDeCorte(trx: TransactionClientContract, hasta: string): Promise<string[]> {
    const { rows } = (await trx.rawQuery(
        `SELECT DISTINCT ${HORA_EFECTIVA} AS hora
           FROM core.servicios s
           JOIN billing.plantillas_facturacion p ON p.id = s.plantilla_facturacion_id
           LEFT JOIN core.servicios_excepciones e ON e.servicio_id = s.id AND e.campo = 'hora_corte'
          WHERE s.estado IN ('activo', 'limitado', 'suspendido') AND ${HORA_EFECTIVA} <= ?
          ORDER BY 1`,
        [hasta],
    )) as { rows: Array<{ hora: string }> }
    return rows.map((f) => f.hora)
}

/** Horas de corte procesadas por corridas del cron en la fecha local `fecha`. */
async function horasEjecutadas(trx: TransactionClientContract, fecha: string): Promise<Set<string>> {
    const inicio = DateTime.fromISO(fecha, { zone: ZONA }).startOf('day')
    const filas = (await trx
        .from('audit.acciones')
        .where('accion', ACCION_CORTE)
        .where('canal', 'cron')
        .where('resultado', 'ok')
        .where('created_at', '>=', inicio.toUTC().toJSDate())
        .where('created_at', '<', inicio.plus({ days: 1 }).toUTC().toJSDate())
        .select(trx.raw(`entrada -> 'resultado' -> 'horas' as horas`))) as Array<{ horas: unknown }>
    const horas = new Set<string>()
    for (const fila of filas) {
        if (Array.isArray(fila.horas)) for (const h of fila.horas) horas.add(String(h))
    }
    return horas
}
