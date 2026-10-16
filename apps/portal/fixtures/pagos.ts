/**
 * Pago en línea en el modo fixtures y las pruebas (tipado contra el contrato). Los valores por
 * defecto son los que devuelve `POST /portal/pagos/iniciar` recién creado.
 */
import type { Schema } from '@argosisp/contracts'

export const PAGO_EN_LINEA_ID_FIXTURE = 42

export function pagoEnLineaFixture(cambios: Partial<Schema<'PortalPagoEnLinea'>> = {}): Schema<'PortalPagoEnLinea'> {
    return {
        id: PAGO_EN_LINEA_ID_FIXTURE,
        estado: 'pendiente',
        monto: '300.00',
        url_pago: `http://api.argosisp.local/api/v1/pasarela/falsa/falsa_${'0'.repeat(32)}`,
        expira_en: '2026-10-17T18:00:00.000Z',
        pagado_en: null,
        ...cambios,
    }
}
