import type { Schema } from '@argosisp/contracts'

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
