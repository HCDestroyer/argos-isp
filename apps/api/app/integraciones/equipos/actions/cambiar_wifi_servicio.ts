import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import {
    EquipoSinGestion,
    VerificacionRequerida,
    gestionDeEmpresa,
    validarWifi,
} from '#integraciones/equipos/equipos'

/** Métodos de verificación del titular (§12.4). */
export const METODOS_ASISTENTE = ['codigo_telefono', 'codigo_correo', 'datos_titular'] as const
export const METODOS_PERSONA = [...METODOS_ASISTENTE, 'presencial', 'llamada_verificada'] as const

/** Vigencia de la verificación del asistente de IA (§12.4). */
export const VIGENCIA_VERIFICACION_IA_MIN = 10

export interface EntradaCambiarWifi {
    servicio_id: number
    ssid?: string | null
    clave?: string | null
    origen_tipo: 'iris_orden' | 'iris_ticket' | 'iris_conversacion'
    origen_id: string
    verificacion?: {
        metodo: string
        verificado_en: Date
        cliente_id: number
    } | null
}

/**
 * `servicios.cambiar_wifi` (`POST /servicios/:id/wifi`, contrato Iris 0.9.0 §12.4, A35).
 *
 * Valida el cuerpo (`422 wifi_invalido`) y la `verificacion` del titular con las reglas del actor de
 * §7.1 (`422 verificacion_requerida`: falta, método que no vale para ese actor, más de 10 min con el
 * asistente o `cliente_id` que no es el del servicio). Después responde `409 equipo_sin_gestion`:
 * Argos no tiene SmartOLT ni ACS (`#integraciones/equipos/equipos`) y no finge el cambio. La clave
 * nunca llega a la auditoría (`***`). No hay `equipo.wifi_resuelto` porque nunca se acepta un cambio;
 * el tope de 3 por día se cuenta cuando exista la integración (solo cuentan los aceptados).
 */
export default class CambiarWifiServicio extends DomainAction<EntradaCambiarWifi, never> {
    readonly nombre = 'servicios.cambiar_wifi'
    protected override readonly camposEntradaOcultos = ['clave']

    protected async handle(input: EntradaCambiarWifi, t: Transaccion): Promise<never> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('empresa_id', 'cliente_id')
            .first()) as { empresa_id: number | null; cliente_id: number } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = servicio.empresa_id === null ? null : Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        validarWifi({ ssid: input.ssid, clave: input.clave })

        const v = input.verificacion
        if (!v) {
            throw new VerificacionRequerida(
                'Falta `verificacion`: cómo se comprobó que quien pide es el titular',
            )
        }
        const asistente = t.ctx.iris?.actor === 'asistente_ia'
        const metodos: readonly string[] = asistente ? METODOS_ASISTENTE : METODOS_PERSONA
        if (!metodos.includes(v.metodo)) {
            throw new VerificacionRequerida(
                asistente
                    ? 'El asistente de IA solo verifica con un código al teléfono o al correo del cliente o con el documento del titular'
                    : 'Método de verificación desconocido',
            )
        }
        if (Number(v.cliente_id) !== Number(servicio.cliente_id)) {
            throw new VerificacionRequerida('La verificación no es del titular de este servicio')
        }
        if (asistente) {
            const minutos = DateTime.utc().diff(DateTime.fromJSDate(v.verificado_en)).as('minutes')
            if (minutos > VIGENCIA_VERIFICACION_IA_MIN || minutos < -1) {
                throw new VerificacionRequerida(
                    `La verificación tiene más de ${VIGENCIA_VERIFICACION_IA_MIN} minutos: vuelve a verificar al titular`,
                )
            }
        }

        // Sin SmartOLT ni ACS ningún equipo está gestionado (`gestionDeEmpresa` siempre false): hoy
        // termina aquí. Con la integración, aquí se registra la solicitud y se responde 202.
        const gestion = await gestionDeEmpresa(empresaId)
        if (gestion.ftth || gestion.tr069) {
            throw new Error('servicios.cambiar_wifi: gestión habilitada sin implementación')
        }
        throw new EquipoSinGestion()
    }
}
