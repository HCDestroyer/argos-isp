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

/**
 * Las dos facturas vencidas de `QUIEN_SOY_SUSPENDIDO` (Q350.00 de los Q525.00 que debe): lo que
 * cubre una promesa creada ahora, la más antigua primero (`limitesPromesa().facturas`).
 */
export function facturasCubiertasFixture(): Schema<'FacturaCubierta'>[] {
    return [
        { factura_id: 1150, tipo: 'servicio', periodo: '2026-09-01', vence_en: '2026-09-10', monto: '175.00' },
        { factura_id: 1203, tipo: 'servicio', periodo: '2026-10-01', vence_en: '2026-10-10', monto: '175.00' },
    ]
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
        monto_promesa: '350.00',
        facturas: facturasCubiertasFixture(),
        abono_inicial: null,
        deuda_maxima: null,
        pago_previo: null,
        requiere_aprobacion: false,
    }
}

/** La plantilla pide abonar el 50 % y admite hasta Q300.00 vencidos: hay que pagar Q262.50 antes. */
export function condicionesConPagoPrevioFixture(): Schema<'PortalCondicionesPromesa'> {
    return {
        ...condicionesFixture(),
        abono_inicial: { porcentaje: 50, requerido: '262.50', abonado: '0.00', faltante: '262.50' },
        deuda_maxima: { maximo: '300.00', vencida: '350.00', faltante: '50.00' },
        pago_previo: '262.50',
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
        monto_promesa: null,
        facturas: [],
    }
}

/** Sin facturas vencidas (lo pendiente aún no vence): no hay nada que prometer. */
export function condicionesSinVencidoFixture(): Schema<'PortalCondicionesPromesa'> {
    return {
        ...condicionesFixture(),
        disponible: false,
        motivo: 'No tienes facturas vencidas: no necesitas una promesa de pago.',
        fecha_minima: null,
        fecha_maxima: null,
        plazo_max_dias: null,
        monto_promesa: null,
        facturas: [],
    }
}

export type ResultadoPromesaFixture = Schema<'PortalPromesaSolicitada'>['resultado']

/** `rechazada` es por cupo del periodo (cambiar la fecha no sirve); `rechazada_fecha`, por el plazo. */
export type EscenarioResultadoFixture = ResultadoPromesaFixture | 'rechazada_fecha'

const MOTIVOS: Record<ResultadoPromesaFixture, string> = {
    aprobada: 'Tu promesa de pago fue aprobada.',
    rechazada: 'Ya usaste las promesas de pago disponibles para este periodo. Comunícate con nosotros para acordar una fecha de pago.',
    pendiente_aprobacion: 'Un asesor revisará tu solicitud y te avisaremos cuando quede aprobada.',
}

/** Respuesta de `POST /portal/promesas` con el resultado pedido: cubre todo lo vencido (Q350.00). */
export function promesaSolicitadaFixture(
    escenario: EscenarioResultadoFixture,
    datos: { vence_el: string },
): Schema<'PortalPromesaSolicitada'> {
    const resultado: ResultadoPromesaFixture = escenario === 'rechazada_fecha' ? 'rechazada' : escenario
    return {
        id: 88,
        resultado,
        // 23:59:59 de Guatemala (UTC−6) = 05:59:59 UTC del día siguiente.
        vence_en: new Date(`${datos.vence_el}T23:59:59-06:00`).toISOString(),
        monto: '350.00',
        facturas: facturasCubiertasFixture(),
        motivo: escenario === 'rechazada_fecha' ? 'La fecha de pago debe estar dentro de los próximos 3 días.' : MOTIVOS[resultado],
        corregible: escenario === 'rechazada_fecha',
        servicio_estado: resultado === 'aprobada' ? 'activo' : null,
    }
}
