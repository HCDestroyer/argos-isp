import type { Schema } from '@argosisp/contracts'
import plantillasJson from './plantillas.json'
import recordatoriosJson from './recordatorios.json'

type Configuracion = Schema<'ConfiguracionNotificaciones'>

/** Avisos encendidos, como la configuración por defecto de A6. */
export const AVISOS_TODOS: Configuracion['avisos'] = {
    factura: true,
    vencimiento: true,
    recordatorio: true,
    corte: true,
    pago: true,
    promesa: true,
    comprobante: true,
    lealtad: true,
}

/**
 * Global sin guardar (`origen: entorno`, `version: 0`): muestra lo que rige, las variables de
 * entorno del laboratorio. Los secretos salen como `***` (hay uno) o `null`.
 */
export const configuracionGlobal: Configuracion = {
    id: null,
    empresa_id: null,
    hereda: false,
    origen: 'entorno',
    sembrada_desde_entorno: false,
    correo: {
        activo: true,
        host: 'smtp.argosnet.gt',
        puerto: 587,
        tls: 'auto',
        usuario: 'no-responder@argosnet.gt',
        password: '***',
        remitente: 'no-responder@argosnet.gt',
        nombre_visible: 'ArgosNet',
        contabilidad: 'contabilidad@argosnet.gt',
    },
    telegram: {
        clientes_activo: false,
        alertas_activo: true,
        token: null,
        bot_id: null,
        bot_nombre: null,
        chat_equipo: null,
        webhook_secreto: null,
        webhook_ruta: null,
    },
    avisos: { ...AVISOS_TODOS },
    version: 0,
    created_at: null,
    updated_at: null,
}

/** Una empresa sin fila: hereda la global (`origen: sin_configurar`). */
export function configuracionSinFila(empresaId: number, global: Configuracion): Configuracion {
    return {
        ...structuredClone(global),
        id: null,
        empresa_id: empresaId,
        hereda: true,
        origen: 'sin_configurar',
        sembrada_desde_entorno: false,
        version: 0,
        created_at: null,
        updated_at: null,
    }
}

/** Plantillas de `notify_plantillas_seeder` como las devuelve `GET /notificaciones/plantillas` (A6). */
export const plantillasNotificacion: Schema<'PlantillaNotificacion'>[] = plantillasJson as Schema<'PlantillaNotificacion'>[]

/** Los tres recordatorios de pago del seed (−3, 0 y +3 días a las 09:00). */
export const recordatoriosPago: Schema<'RecordatorioPago'>[] = recordatoriosJson

const enviado = (id: number, extra: Partial<Schema<'EnvioNotificacion'>>): Schema<'EnvioNotificacion'> => ({
    id,
    cliente_id: 1,
    origen: `outbox:${100 + id}`,
    evento: 'factura.emitida',
    canal: 'correo',
    destino: 'maria.perez@correo.gt',
    asunto: 'Tu factura de octubre 2026',
    cuerpo: 'Hola María José Pérez López, tu factura de octubre 2026 por Q 175.00 vence el 15/10/2026.',
    estado: 'enviado',
    error: null,
    motivo: null,
    empresa_id: 1,
    intentos: 1,
    proveedor_id: `<${id}@argosisp.local>`,
    fallback_de: null,
    enviado_en: `2026-10-0${Math.min(id, 9)}T15:00:05.000Z`,
    created_at: `2026-10-0${Math.min(id, 9)}T15:00:00.000Z`,
    updated_at: `2026-10-0${Math.min(id, 9)}T15:00:05.000Z`,
    ...extra,
})

/** Registro de envíos (`notify.envios`): enviado, fallido con su error, omitido con motivo y el respaldo por correo. */
export const enviosNotificacion: Schema<'EnvioNotificacion'>[] = [
    enviado(1, {}),
    enviado(2, { cliente_id: 2, evento: 'recordatorio.1', canal: 'telegram', destino: '555001122', asunto: null, cuerpo: 'Juan Carlos, tu factura vence en 3 días.', origen: 'recordatorio:1:factura:2', proveedor_id: '9921' }),
    enviado(3, { cliente_id: 2, evento: 'servicio.estado_cambiado', canal: 'telegram', destino: '555001122', asunto: null, cuerpo: null, estado: 'fallido', error: 'Telegram: 403 Forbidden: bot was blocked by the user', intentos: 5, proveedor_id: null, enviado_en: null }),
    enviado(4, { cliente_id: 2, evento: 'servicio.estado_cambiado', canal: 'correo', destino: 'juan.ramirez@correo.gt', asunto: 'Tu servicio fue suspendido', fallback_de: 3 }),
    enviado(5, { cliente_id: 4, evento: 'promesa.creada', canal: 'correo', destino: 'ana.morales@correo.gt', asunto: null, cuerpo: null, estado: 'omitido', motivo: 'Aviso «promesa.creada» apagado en la configuración de la empresa', intentos: 0, proveedor_id: null, enviado_en: null }),
]
