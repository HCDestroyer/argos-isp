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
import { horasDeCorte } from '#billing/cortes'

/**
 * Cron vigilado: periódico (`cadaMin`, su periodo en `billing/jobs.ts`) o diario (`diario`, hora
 * `HH:mm` en Guatemala, la de `CRONS_DIARIOS` de `billing/jobs.ts`).
 */
export type CronVigilado =
    | { accion: string; descripcion: string; cadaMin: number }
    | { accion: string; descripcion: string; diario: string }

/**
 * Crons de billing (A3) que se vigilan por su corrida en `audit.acciones` (las registra
 * `RegistrarCorrida` con canal `cron`, con el nombre de la acción).
 */
export const CRONS_VIGILADOS: readonly CronVigilado[] = [
    { accion: 'facturas.generar', descripcion: 'La generación de facturas', cadaMin: 60 },
    { accion: 'facturas.vencer_pendientes', descripcion: 'El vencimiento de facturas y mora', cadaMin: 60 },
    // lealtad (contratos/lealtad.md §15.1): `lealtad:antiguedad` 03:05 y `lealtad:vencer` 03:20
    {
        accion: 'lealtad.otorgar_antiguedad',
        descripcion: 'Los puntos de lealtad por antigüedad',
        diario: '03:05',
    },
    { accion: 'lealtad.vencer', descripcion: 'El vencimiento de puntos de lealtad', diario: '03:20' },
]

/**
 * Último instante en que el cron debió correr (hasta `ahora`) y el siguiente después de una
 * corrida. Periódico: `ultima + cadaMin`. Diario: la hora de hoy en Guatemala si ya pasó; si no,
 * la de ayer.
 */
function horario(cron: CronVigilado, ahora: DateTime, ultima: DateTime | null) {
    if ('cadaMin' in cron) {
        return {
            // atrasado si la última corrida es anterior a `debio - tolerancia` (ver handle)
            debio: ahora.minus({ minutes: cron.cadaMin }),
            siguiente: ultima ? ultima.plus({ minutes: cron.cadaMin }) : null,
        }
    }
    const [hora, minuto] = cron.diario.split(':').map(Number) as [number, number]
    const local = ahora.setZone(ZONA)
    let debio = local.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 })
    if (debio > local) debio = debio.minus({ days: 1 })
    return { debio: debio.toUTC(), siguiente: debio.toUTC() }
}

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

/**
 * `notificaciones.vigilar_crons` (cron cada 5 min en `notify:worker`): avisa al equipo cuando un
 * cron de facturación o de corte no corrió a su hora, y cuando vuelve a correr.
 *
 * - **Periódicos** (`facturas.generar`, `facturas.vencer_pendientes`): atrasado si la última corrida
 *   correcta por cron tiene más de `periodo + NOTIFY_CRON_TOLERANCIA_MIN` (o nunca corrió).
 *   Incidente `cron:<accion>`, abierto hasta que vuelva a correr.
 * - **Diarios** (`lealtad.otorgar_antiguedad` 03:05, `lealtad.vencer` 03:20, Guatemala): atrasado
 *   si pasó la tolerancia desde su hora de hoy (o de ayer, antes de esa hora) y no hay corrida
 *   correcta desde esa hora. Mismo incidente `cron:<accion>`.
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

        // Un cron que nunca corrió se mide desde el último despliegue (última migración): recién
        // levantado el sistema, billing-worker aún no tuvo tiempo de correr y no es una falla.
        const despliegue = await ultimoDespliegue(t.trx)
        for (const cron of CRONS_VIGILADOS) {
            const clave = `cron:${cron.accion}`
            const ultima = await ultimaCorrida(t.trx, cron.accion, ahora)
            const { debio, siguiente } = horario(cron, ahora, ultima)
            // Periódico: atrasado si no corrió en `periodo + tolerancia`. Diario: si ya pasó la
            // tolerancia desde la hora de hoy (o de ayer) y no hay corrida desde esa hora.
            const diario = !('cadaMin' in cron)
            const limite = diario ? debio : debio.minus({ minutes: tolerancia })
            const enGracia = diario && ahora < debio.plus({ minutes: tolerancia })
            const referencia = ultima ?? despliegue
            if (!ultima && referencia && referencia >= limite) continue
            if (enGracia && (!ultima || ultima < limite)) continue
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
                        esperado: instanteLocal(siguiente),
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
            local.minus({ minutes: tolerancia }).toISODate() === hoy ? await horasDeCorte(vencidas, trx) : []
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

/** Instante de la última migración aplicada (`adonis_schema.migration_time`). */
async function ultimoDespliegue(trx: TransactionClientContract): Promise<DateTime | null> {
    const fila = (await trx.from('adonis_schema').max('migration_time as ultima').first()) as {
        ultima: Date | null
    } | null
    return fila?.ultima ? DateTime.fromJSDate(fila.ultima) : null
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
