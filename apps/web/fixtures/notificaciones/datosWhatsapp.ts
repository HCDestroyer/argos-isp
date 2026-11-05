import type { Schema } from '@argosisp/contracts'

type Contacto = NonNullable<Schema<'WhatsappCliente'>['contacto']>
type Consentimiento = Schema<'ConsentimientoWhatsapp'>

/** Permisos de contacto por WhatsApp (contrato Iris 0.6.0 §6.4, A6): lo que Argos sabe del registro de Iris. */
export interface WhatsappFixtures {
    /** Último estado por cliente (`notify.contacto_iris`). */
    contactos: Record<number, Contacto>
    /** Lo que Argos mandó a Iris (`notify.consentimientos_iris`). */
    consentimientos: Consentimiento[]
}

/** Cliente que aceptó en el panel (2) y uno que pidió la baja escribiendo BAJA en el chat de Iris (8). */
export const CLIENTE_ACEPTA_WHATSAPP = 2
export const CLIENTE_BAJA_IRIS = 8

export function whatsappInicial(): WhatsappFixtures {
    const ocurrido = '2026-10-01T16:00:00.000Z'
    return {
        contactos: {
            [CLIENTE_ACEPTA_WHATSAPP]: { estado: 'acepta', ocurrido_en: ocurrido, origen: 'argos_panel' },
            [CLIENTE_BAJA_IRIS]: { estado: 'baja', ocurrido_en: '2026-10-14T02:15:00.000Z', origen: 'iris_cliente' },
        },
        consentimientos: [{
            id: 1,
            empresa_id: 1,
            cliente_id: CLIENTE_ACEPTA_WHATSAPP,
            canal: 'whatsapp',
            estado: 'acepta',
            origen: 'argos_panel',
            ocurrido_en: ocurrido,
            idempotency_key: `argos:consentimiento:${CLIENTE_ACEPTA_WHATSAPP}:whatsapp:${ocurrido}`,
            entrega: 'enviado',
            intentos: 1,
            ultimo_error: null,
            enviado_en: ocurrido,
            consentimiento_id: 'cons-01',
            estado_vigente: 'acepta',
        }],
    }
}
