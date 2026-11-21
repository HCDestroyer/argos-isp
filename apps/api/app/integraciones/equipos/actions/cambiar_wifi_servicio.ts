import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { LimiteExcedido } from '#core/limite_ventana'
import { configDeEmpresa, gestionDe } from '#integraciones/equipos/configuracion'
import {
    EquipoSinGestion,
    VerificacionRequerida,
    descubrirEquipo,
    equipoGestionado,
    validarWifi,
} from '#integraciones/equipos/equipos'
import { encolarEquipos } from '#integraciones/equipos/cola'

/** Métodos de verificación del titular (§12.4). */
export const METODOS_ASISTENTE = ['codigo_telefono', 'codigo_correo', 'datos_titular'] as const
export const METODOS_PERSONA = [...METODOS_ASISTENTE, 'presencial', 'llamada_verificada'] as const

/** Vigencia de la verificación del asistente de IA (§12.4). */
export const VIGENCIA_VERIFICACION_IA_MIN = 10
/** Tope de cambios de Wi-Fi por servicio en el día de Guatemala, sumando todos los actores (§12.4). */
export const CAMBIOS_WIFI_POR_DIA = 3

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
    /** `Idempotency-Key` de la petición (la pone la ruta) */
    idempotency_key?: string | null
}

export interface SalidaCambiarWifi {
    solicitud_id: number
    estado: 'en_proceso'
}

/**
 * `servicios.cambiar_wifi` (`POST /servicios/:id/wifi`, contrato Iris 0.9.0 §12.4, A35).
 *
 * - Valida el cuerpo (`422 wifi_invalido`) y la `verificacion` del titular con las reglas del actor
 *   de §7.1 (`422 verificacion_requerida`).
 * - El equipo debe estar gestionado por el ACS de la empresa (GenieACS probado y el equipo con su id
 *   en el ACS, del aprovisionamiento o descubierto por la serie o MAC del comodato): si no,
 *   `409 equipo_sin_gestion`.
 * - Tope: **3 cambios por servicio en el día de Guatemala**, sumando todos los actores (cuentan los
 *   aceptados que no fallaron), con el servicio bloqueado: `429 demasiados_cambios_wifi` con
 *   `Retry-After` hasta la medianoche de Guatemala.
 * - Guarda el pedido con SSID y clave **cifrados** (se borran al resolverse) y la verificación
 *   completa; la auditoría lleva la clave como `***`. El worker la aplica (`equipos.aplicar_wifi`)
 *   y emite `equipo.wifi_resuelto`; con `aplicado`, notify avisa al titular.
 */
export default class CambiarWifiServicio extends DomainAction<EntradaCambiarWifi, SalidaCambiarWifi> {
    readonly nombre = 'servicios.cambiar_wifi'
    protected override readonly camposEntradaOcultos = ['clave']

    protected async handle(input: EntradaCambiarWifi, t: Transaccion): Promise<SalidaCambiarWifi> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('empresa_id', 'cliente_id')
            .first()) as { empresa_id: number; cliente_id: number } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
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

        const config = await configDeEmpresa(empresaId, t.trx)
        if (!gestionDe(config).tr069) {
            throw new EquipoSinGestion(
                null,
                'La empresa no tiene el ACS (GenieACS) configurado y probado en Argos',
            )
        }
        const equipo =
            (await equipoGestionado(input.servicio_id, t.trx)) ??
            (await descubrirEquipo(input.servicio_id, empresaId, config, t.trx))
        if (!equipo?.acs_device_id) {
            throw new EquipoSinGestion(
                null,
                'El equipo de este servicio no está registrado en el ACS (TR-069)',
            )
        }

        const ahora = DateTime.now().setZone('America/Guatemala')
        const inicioDia = ahora.startOf('day')
        const conteo = (await t.trx
            .from('integraciones.wifi_solicitudes')
            .where('servicio_id', input.servicio_id)
            .whereNot('estado', 'fallido')
            .where('created_at', '>=', inicioDia.toUTC().toJSDate())
            .count('* as n')
            .first()) as { n: string | number }
        if (Number(conteo.n) >= CAMBIOS_WIFI_POR_DIA) {
            throw new LimiteExcedido(
                'demasiados_cambios_wifi',
                'Demasiados cambios de Wi-Fi',
                `El Wi-Fi de este servicio ya se cambió ${CAMBIOS_WIFI_POR_DIA} veces hoy; vuelve a intentarlo mañana`,
                Math.max(1, Math.ceil(inicioDia.plus({ days: 1 }).diff(ahora).as('seconds'))),
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('integraciones.wifi_solicitudes')
            .insert({
                empresa_id: empresaId,
                servicio_id: input.servicio_id,
                cliente_id: Number(servicio.cliente_id),
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
                idempotency_key: input.idempotency_key ?? null,
                cambia_ssid: Boolean(input.ssid),
                cambia_clave: Boolean(input.clave),
                ssid_cifrado: input.ssid ? cifrar(input.ssid) : null,
                clave_cifrada: input.clave ? cifrar(input.clave) : null,
                verificacion: JSON.stringify({
                    metodo: v.metodo,
                    verificado_en: v.verificado_en.toISOString(),
                    cliente_id: Number(v.cliente_id),
                    actor: t.ctx.iris?.actor ?? null,
                }),
                proximo_intento_en: new Date(),
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.anotarAuditoria({ solicitud_id: id })
        t.alConfirmar(() => encolarEquipos('wifi', id))
        return { solicitud_id: id, estado: 'en_proceso' }
    }
}
