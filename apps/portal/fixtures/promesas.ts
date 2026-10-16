/**
 * `GET /portal/promesas/condiciones` y `POST /portal/promesas` para el modo fixtures y las pruebas
 * (tipados contra el contrato). Las fechas son relativas a hoy en Guatemala, como en la API.
 */
import type { Schema } from '@argosisp/contracts'

/** Día de Guatemala `dias` después de hoy (YYYY-MM-DD). */
export function diaFixture(dias = 0): string {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date())
    const fecha = new Date(`${hoy}T12:00:00Z`)
    fecha.setUTCDate(fecha.getUTCDate() + dias)
    return fecha.toISOString().slice(0, 10)
}

/** Mismos montos que `QUIEN_SOY_SUSPENDIDO`: debe Q525.00, vencido Q350.00. Canal portal: 3 días. */
export function condicionesFixture(): Schema<'PortalCondicionesPromesa'> {
    return {
        disponible: true,
        motivo: null,
        promesa_abierta: null,
        fecha_minima: diaFixture(0),
        fecha_maxima: diaFixture(3),
        plazo_max_dias: 3,
        monto_maximo: '525.00',
        monto_sugerido: '350.00',
        abono_inicial: null,
        requiere_aprobacion: false,
    }
}

/** Con una promesa ya activa: no se puede pedir otra. */
export function condicionesConPromesaFixture(): Schema<'PortalCondicionesPromesa'> {
    return {
        ...condicionesFixture(),
        disponible: false,
        motivo: 'Ya tienes una promesa de pago activa.',
        promesa_abierta: { estado: 'activa', vence_en: `${diaFixture(2)}T05:59:59.000Z`, monto: '350.00' },
        fecha_minima: null,
        fecha_maxima: null,
        plazo_max_dias: null,
        monto_maximo: null,
        monto_sugerido: null,
    }
}

export type ResultadoPromesaFixture = Schema<'PortalPromesaSolicitada'>['resultado']

const MOTIVOS: Record<ResultadoPromesaFixture, string> = {
    aprobada: 'Tu promesa de pago fue aprobada.',
    rechazada: 'Ya usaste las promesas de pago disponibles para este periodo. Comunícate con nosotros para acordar una fecha de pago.',
    pendiente_aprobacion: 'Un asesor revisará tu solicitud y te avisaremos cuando quede aprobada.',
}

/** Respuesta de `POST /portal/promesas` con el resultado pedido. */
export function promesaSolicitadaFixture(
    resultado: ResultadoPromesaFixture,
    datos: { vence_el: string, monto: string },
): Schema<'PortalPromesaSolicitada'> {
    return {
        id: 88,
        resultado,
        // 23:59:59 de Guatemala (UTC−6) = 05:59:59 UTC del día siguiente.
        vence_en: new Date(`${datos.vence_el}T23:59:59-06:00`).toISOString(),
        monto: datos.monto,
        motivo: MOTIVOS[resultado],
        servicio_estado: resultado === 'aprobada' ? 'activo' : null,
    }
}
