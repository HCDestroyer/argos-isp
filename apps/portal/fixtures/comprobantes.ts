/**
 * Comprobantes de depósito (tarea 5) para el modo fixtures y las pruebas, tipados contra el
 * contrato y con los mismos valores por defecto que devuelve la API.
 */
import type { Schema } from '@argosisp/contracts'

export const BANCOS_FIXTURE: Schema<'PortalBanco'>[] = [
    { id: 1, nombre: 'Banco Industrial' },
    { id: 2, nombre: 'Banrural' },
    { id: 3, nombre: 'BAM' },
    { id: 4, nombre: 'G&T Continental' },
]

export function comprobanteFixture(
    datos: Partial<Schema<'PortalComprobante'>> & { id: number },
): Schema<'PortalComprobante'> {
    return {
        servicio_id: 41,
        metodo: 'deposito',
        cuenta_destino: 'Banco Industrial · Monetaria Red Altiplano',
        banco_origen: null,
        referencia: '845120377',
        monto: '275.00',
        fecha_deposito: '2026-10-14',
        archivo_tipo: 'image/jpeg',
        archivo_nombre: 'boleta.jpg',
        estado: 'pendiente',
        motivo_rechazo: null,
        created_at: '2026-10-14T16:20:00.000Z',
        verificado_en: null,
        ...datos,
    }
}

export const COMPROBANTES_FIXTURE: Schema<'PortalComprobante'>[] = [
    comprobanteFixture({ id: 12 }),
    comprobanteFixture({
        id: 9,
        metodo: 'transferencia',
        cuenta_destino: 'Banrural · Ahorro Red Altiplano',
        banco_origen: 'BAM',
        referencia: 'TRX-55102',
        monto: '250.00',
        fecha_deposito: '2026-09-03',
        estado: 'rechazado',
        motivo_rechazo: 'La foto no deja leer la referencia. Súbela de nuevo, por favor.',
        created_at: '2026-09-03T21:05:00.000Z',
        verificado_en: '2026-09-04T14:00:00.000Z',
    }),
    comprobanteFixture({
        id: 6,
        referencia: '771203554',
        fecha_deposito: '2026-08-05',
        estado: 'aprobado',
        created_at: '2026-08-05T15:40:00.000Z',
        verificado_en: '2026-08-05T18:10:00.000Z',
    }),
]
