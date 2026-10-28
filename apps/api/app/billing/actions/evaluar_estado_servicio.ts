import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import CambiarEstadoServicio, { type EstadoOperativo } from '#core/actions/cambiar_estado_servicio'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'

/**
 * `servicios.evaluar_estado` = `evaluarEstadoServicio(servicio_id)`: la **única** función que
 * decide el estado de un servicio. La llaman el cron de corte, `registrarPago`, `anularPago`,
 * `crearPromesaPago` e `incumplirPromesa`; siempre anidada con `{ trx }` cuando hay una acción
 * alrededor, así el cambio de estado y su evento quedan en la misma transacción que el pago.
 *
 * Reglas, con la configuración efectiva (plantilla + excepciones del servicio):
 *  0. `pendiente_instalacion`: sale temprano sin tocar nada (`contratos/instalacion.md` §1). No tiene
 *     facturas de servicio y solo lo mueven `servicios.activar_instalacion` o `servicios.retirar`;
 *     así el pago de un cargo único anticipado (p. ej. la instalación) no choca con el 422
 *     `servicio_pendiente_instalacion` de `CambiarEstadoServicio`.
 *  1. Retirado, suspendido a mano por un operador (`suspension_manual`, decisión del PM) o sin
 *     plantilla: no se toca. La suspensión manual solo la quita `reactivar`.
 *  2. Promesa de pago activa → `activo` (la promesa no corta).
 *  3. Facturas de servicio vencidas ≥ `facturas_para_cortar` → `suspendido`.
 *  4. Vencidas ≥ `facturas_para_limitar` (> 0) → `limitado`, solo si el plan tiene velocidad
 *     limitada > 0 en bajada y subida; si no, sigue `activo`.
 *  5. Si no → `activo`.
 *
 * `hora_corte` se respeta solo para **bajar** de estado (activo → limitado → suspendido): antes
 * de esa hora (Guatemala) del día el servicio se queda como está y el motivo lo dice. Subir es
 * inmediato. `ignorarHoraCorte` lo usa el corte manual del laboratorio.
 *
 * Si el estado cambia llama `CambiarEstadoServicio` (A1), que escribe el cambio, `audit.cambios`
 * y `servicio.estado_cambiado` por outbox (A2 corta o reactiva con eso).
 */

export interface EntradaEvaluarEstado {
    servicio_id: number
    /** instante de referencia (pruebas y cron); por defecto ahora */
    ahora?: Date
    ignorarHoraCorte?: boolean
}

export interface ResultadoEvaluarEstado {
    servicio_id: number
    /** estado en que queda el servicio */
    estado: EstadoServicioConPendiente
    motivo: string
    de: EstadoServicioConPendiente
    cambiado: boolean
    /** estado que corresponde por reglas (difiere de `estado` si espera la hora de corte) */
    deseado: EstadoServicioConPendiente
    vencidas: number
    promesa_activa: boolean
}

const RANGO: Record<EstadoOperativo, number> = { activo: 0, limitado: 1, suspendido: 2 }

export default class EvaluarEstadoServicio extends DomainAction<
    EntradaEvaluarEstado,
    ResultadoEvaluarEstado
> {
    readonly nombre = 'servicios.evaluar_estado'

    /**
     * Decisión del PM (2026-10-16): solo se audita la evaluación que cambió el estado (cada pago,
     * promesa y corte evalúa muchos servicios sin cambio). Los errores se auditan siempre y quien
     * la llama (pago, promesa, corte con `registrar_corrida`) deja su propia fila.
     */
    protected override auditarExito(salida: ResultadoEvaluarEstado): boolean {
        return salida.cambiado
    }

    protected async handle(input: EntradaEvaluarEstado, t: Transaccion): Promise<ResultadoEvaluarEstado> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await leerServicio(t.trx, input.servicio_id)
        t.fijarEmpresa(servicio.empresa_id)
        const base = {
            servicio_id: servicio.id,
            de: servicio.estado,
            estado: servicio.estado,
            deseado: servicio.estado,
            cambiado: false,
            vencidas: 0,
            promesa_activa: false,
        }
        if (servicio.estado === 'pendiente_instalacion') {
            return { ...base, motivo: 'servicio pendiente de instalación' }
        }
        if (servicio.estado === 'retirado') return { ...base, motivo: 'servicio retirado' }
        if (servicio.suspension_manual) return { ...base, motivo: 'suspensión manual' }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) return { ...base, motivo: 'sin plantilla de facturación' }

        const { vencidas } = (await t.trx
            .from('billing.facturas')
            .where('servicio_id', servicio.id)
            .where('tipo', 'servicio')
            .where('estado', 'vencida')
            .count('* as vencidas')
            .first()) as { vencidas: string | number }
        const totalVencidas = Number(vencidas)
        const promesa = (await t.trx
            .from('billing.promesas')
            .where('servicio_id', servicio.id)
            .where('estado', 'activa')
            .select('id', 'vence_en')
            .first()) as { id: number; vence_en: Date } | null

        const { deseado, motivo } = decidir({
            vencidas: totalVencidas,
            promesaId: promesa?.id ?? null,
            limitar: config.facturas_para_limitar,
            cortar: config.facturas_para_cortar,
            limitable: servicio.limitable,
        })
        const actual = servicio.estado as EstadoOperativo
        const resultado = {
            ...base,
            deseado,
            vencidas: totalVencidas,
            promesa_activa: promesa !== null,
        }
        if (deseado === actual) return { ...resultado, motivo }

        const baja = RANGO[deseado] > RANGO[actual]
        if (baja && !input.ignorarHoraCorte && !llegoHoraCorte(config.hora_corte, input.ahora)) {
            return { ...resultado, motivo: `${motivo}; espera la hora de corte ${config.hora_corte}` }
        }

        const cambio = await new CambiarEstadoServicio().execute(
            { servicioId: servicio.id, nuevo: deseado, motivo },
            t.ctx,
            { trx: t.trx },
        )
        return { ...resultado, estado: cambio.a, cambiado: cambio.cambiado, motivo }
    }
}

export function decidir(datos: {
    vencidas: number
    promesaId: number | null
    limitar: number
    cortar: number
    limitable: boolean
}): { deseado: EstadoOperativo; motivo: string } {
    const { vencidas, limitar, cortar } = datos
    const plural = vencidas === 1 ? 'factura vencida' : 'facturas vencidas'
    if (datos.promesaId !== null) {
        return {
            deseado: 'activo',
            motivo: `promesa de pago ${datos.promesaId} activa (${vencidas} ${plural})`,
        }
    }
    if (vencidas >= cortar) {
        return { deseado: 'suspendido', motivo: `${vencidas} ${plural} (se corta con ${cortar})` }
    }
    if (limitar > 0 && vencidas >= limitar) {
        if (datos.limitable) {
            return { deseado: 'limitado', motivo: `${vencidas} ${plural} (se limita con ${limitar})` }
        }
        return {
            deseado: 'activo',
            motivo: `${vencidas} ${plural}; el plan no tiene velocidad limitada (se corta con ${cortar})`,
        }
    }
    return { deseado: 'activo', motivo: vencidas === 0 ? 'sin facturas vencidas' : `${vencidas} ${plural}` }
}

/** ¿Ya pasó hoy la hora de corte (HH:MM, Guatemala)? */
export function llegoHoraCorte(horaCorte: string, ahora: Date = new Date()): boolean {
    const local = DateTime.fromJSDate(ahora).setZone(ZONA_NEGOCIO).toFormat('HH:mm')
    return local >= horaCorte.slice(0, 5)
}
