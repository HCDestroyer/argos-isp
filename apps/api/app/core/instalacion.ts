import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { Decimal } from 'decimal.js'
import { ReglaNegocio } from '#shared/errores'

/** Estados con que puede nacer un servicio (`servicios.crear`); `activo` por defecto. */
export const ESTADOS_INICIALES_SERVICIO = ['activo', 'pendiente_instalacion'] as const
export type EstadoInicialServicio = (typeof ESTADOS_INICIALES_SERVICIO)[number]

/**
 * Servicio pendiente de instalación (`.claude/integration/contratos/instalacion.md`).
 *
 * Un `pendiente_instalacion` solo sale con `servicios.activar_instalacion` (→ activo) o con
 * `servicios.retirar`. Cualquier otra transición o acción sobre su estado (suspender, limitar,
 * reactivar, quitar límite, desconectar, plan temporal, la transición de `evaluarEstadoServicio`)
 * responde 422 `servicio_pendiente_instalacion`.
 */
export class ServicioPendienteInstalacion extends ReglaNegocio {
    constructor(verbo?: string) {
        super(
            verbo
                ? `No se puede ${verbo} un servicio pendiente de instalación: actívalo con activar-instalacion o retíralo`
                : 'El servicio está pendiente de instalación: solo se activa con activar-instalacion o se retira',
            'servicio_pendiente_instalacion',
        )
    }
}

/**
 * 422 si el servicio está pendiente de instalación. Para rutas que llaman acciones de otro módulo
 * que no conocen el estado (p. ej. `servicios.desconectar`, de A2): sin sesión que cortar, el
 * operador recibe el motivo real en vez de un 404. No bloquea: la acción vuelve a leer la fila.
 */
export async function rechazarSiPendiente(
    servicioId: number,
    verbo: string,
    cliente: QueryClientContract = db.connection(),
): Promise<void> {
    const fila = (await cliente.from('core.servicios').where('id', servicioId).select('estado').first()) as {
        estado: string
    } | null
    if (fila?.estado === 'pendiente_instalacion') throw new ServicioPendienteInstalacion(verbo)
}

/** Referencia de planta de la instalación (pedido A9 de Iris): solo lectura. */
export interface PlantaServicio {
    caja?: string
    puerto?: string
    olt?: string
    slot?: string
    pon?: string
    /** decimal como texto, 2 decimales (`-19.40`); nunca `number` */
    potencia_dbm?: string
}

const CAMPOS_PLANTA = ['caja', 'puerto', 'olt', 'slot', 'pon', 'potencia_dbm'] as const

/** Solo los campos que vinieron, en orden fijo, con `potencia_dbm` a 2 decimales. */
export function normalizarPlanta(planta: PlantaServicio): PlantaServicio {
    const salida: PlantaServicio = {}
    for (const campo of CAMPOS_PLANTA) {
        const valor = planta[campo]
        if (valor === undefined) continue
        salida[campo] = campo === 'potencia_dbm' ? new Decimal(valor).toFixed(2) : valor
    }
    return salida
}

/**
 * Tolerancia para `instalado_en` "en el futuro": el reloj del teléfono o del servidor de Iris puede
 * ir unos segundos adelantado y un 4xx no se reintenta (contrato Iris §3).
 */
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000
