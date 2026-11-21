import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import type { EstadoServicioConPendiente } from '#shared/eventos'
import { verificarVersion } from '#shared/version'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { TOLERANCIA_RELOJ_MS, normalizarPlanta, type PlantaServicio } from '#core/instalacion'
import {
    PlanNoPermitido,
    asignarIpPendiente,
    bloquearServicio,
    esServicioDeIris,
    planDisponibleEnRouter,
    registrarOrigenIris,
    tieneAsignaciones,
} from '#core/instalacion_iris'
import { registrarTramo } from '#network/historial'

export interface EntradaActivarInstalacion {
    id: number
    /**
     * versión leída (opcional en esta acción, contrato Iris 0.3.1): si viene y no coincide, 409. Sin
     * ella protegen la máquina de estados (solo sale de `pendiente_instalacion`) y la `Idempotency-Key`.
     */
    version?: number
    /** cuándo quedó instalado; sin él, ahora. Ni futuro ni antes de la creación del servicio. */
    instalado_en?: Date
    /** sistema y documento que pidió la activación (`iris_orden` + id de la orden) */
    origen_tipo?: string
    origen_id?: string
    /** referencia de planta (pedido A9 de Iris); se guarda tal cual, sin validar contra nada */
    planta?: PlantaServicio
}

/**
 * `servicios.activar_instalacion` (`POST /servicios/:id/activar-instalacion`,
 * `contratos/instalacion.md` §2): pasa un servicio de `pendiente_instalacion` a `activo`.
 *
 * - Fija `instalado_en` (inicio de la facturación) y, si estaba vacía, `fecha_instalacion` (día en
 *   Guatemala; la usa la antigüedad de lealtad).
 * - Con `planta` (pedido A9, contrato Iris 0.2.0) guarda la referencia de planta en
 *   `core.servicios.planta` (diff en `audit.cambios`); sin ella no toca la columna.
 * - Emite `servicio.estado_cambiado` (`de: pendiente_instalacion`, `a: activo`, `motivo: instalacion`,
 *   con `origen_tipo`/`origen_id` si vienen) y deja el diff en `audit.cambios`.
 * - Después del COMMIT reescribe `aaa:user:<user_ppp>` (ya con `estado: activo`). RouterOS (A2) lo
 *   aplica por el evento, como cualquier cambio de estado.
 * - `version` es opcional (pedido de Iris 0.3.1: su cola reintenta con los mismos bytes y una
 *   versión leída al encolar queda vieja). Si viene y no coincide: 409 `conflicto_version`. Sin
 *   ella la acción se protege sola: el `FOR UPDATE` y la máquina de estados (solo sale de
 *   `pendiente_instalacion`), y la misma `Idempotency-Key` devuelve la respuesta guardada.
 * - Estado distinto de pendiente: 409 `servicio_no_pendiente` (otra persona ya lo activó o lo
 *   retiró: conflicto con el estado actual, de negocio, no se reintenta). Se revisa antes que la
 *   versión, así una clave nueva sobre un servicio ya activo recibe el motivo real.
 * - Fecha futura o anterior al alta: 422 en `instalado_en`.
 *
 * - Iris 0.10.0 (§3.4.1, A38): si el servicio no reservó IP en sitio, el IPAM la asigna aquí con el
 *   router final (`asignacion.cambiada`; sin IP libre, 422 `sin_ip_disponible`). El plan debe estar
 *   asignado a ese router (si no, 422 `plan_no_permitido`, §3.4.5). Con `origen_tipo`/`origen_id`
 *   sobre un servicio de Iris, la orden queda registrada (alcance de §3.4).
 *
 * El estado no lo decide esta acción por facturas: es el hecho de la instalación, como `retirar`.
 */
export default class ActivarInstalacionServicio extends DomainAction<
    EntradaActivarInstalacion,
    ServicioVista
> {
    readonly nombre = 'servicios.activar_instalacion'

    protected async handle(input: EntradaActivarInstalacion, t: Transaccion): Promise<ServicioVista> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .forUpdate()
            .select('estado', 'empresa_id', 'version', 'created_at', 'fecha_instalacion')
            .first()) as {
            estado: EstadoServicioConPendiente
            empresa_id: number
            version: number
            created_at: Date
            fecha_instalacion: Date | null
        } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        const empresaId = Number(fila.empresa_id)
        t.fijarEmpresa(empresaId)
        if (fila.estado !== 'pendiente_instalacion') {
            throw new Conflicto(
                `El servicio ${input.id} no está pendiente de instalación (está ${fila.estado}): ya se activó o se retiró`,
                'servicio_no_pendiente',
                'El servicio no está pendiente de instalación',
            )
        }
        if (input.version !== undefined) {
            verificarVersion('servicio', input.id, Number(fila.version), input.version)
        }

        const ahora = new Date()
        const instaladoEn = input.instalado_en ?? ahora
        if (instaladoEn.getTime() > ahora.getTime() + TOLERANCIA_RELOJ_MS) {
            throw new ValidacionFallida([
                {
                    field: 'instalado_en',
                    rule: 'no_futura',
                    message: 'La fecha de instalación no puede ser futura',
                },
            ])
        }
        if (instaladoEn.getTime() < new Date(fila.created_at).getTime()) {
            throw new ValidacionFallida([
                {
                    field: 'instalado_en',
                    rule: 'posterior_al_alta',
                    message: 'La fecha de instalación no puede ser anterior a la creación del servicio',
                },
            ])
        }
        // un instante "adelantado" dentro de la tolerancia se guarda como ahora (nunca futuro)
        const efectivo = instaladoEn.getTime() > ahora.getTime() ? ahora : instaladoEn

        // JS tiene milisegundos y Postgres microsegundos: el instante del alta tal cual (o truncado a
        // ms) quedaría <= created_at y la facturación lo tomaría por un servicio nacido activo
        // (`activadoDesdePendienteSql` de `#billing/configuracion` exige instalado_en > created_at).
        // Se guarda al menos 1 µs después del alta; al operador no le cambia nada.
        // Iris 0.10.0 §3.4.5: el plan debe seguir siendo aplicable en el router final
        const servicio = (await bloquearServicio(t.trx, input.id))!
        if (!(await planDisponibleEnRouter(t.trx, servicio.plan_id, servicio.router_id))) {
            throw new PlanNoPermitido(
                'El plan del servicio no está asignado a su router: cámbialo antes de activar',
            )
        }
        // A38: el pendiente sin reserva recibe aquí su IPv4 y sus prefijos (422 sin_ip_disponible)
        const marca = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .select('ip_al_activar')
            .first()) as {
            ip_al_activar: boolean
        }
        const asignar = marca.ip_al_activar && !(await tieneAsignaciones(t.trx, input.id))
        const asignaciones = asignar ? await asignarIpPendiente(t.trx, servicio) : null
        // Alcance de §3.4: la orden queda registrada para un servicio que ya era de Iris
        if (input.origen_tipo && input.origen_id && (await esServicioDeIris(t.trx, input.id))) {
            await registrarOrigenIris(t.trx, input.id, {
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
            })
        }

        const instalado = `greatest(?::timestamptz, created_at + interval '1 microsecond')`
        const antes = await verServicio(input.id, t.trx)
        await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .update({
                estado: 'activo',
                ip_reservada_en: null,
                ip_al_activar: false,
                instalado_en: t.trx.knexRawQuery(instalado, [efectivo.toISOString()]),
                ...(input.planta ? { planta: JSON.stringify(normalizarPlanta(input.planta)) } : {}),
                ...(fila.fecha_instalacion === null
                    ? {
                          fecha_instalacion: t.trx.knexRawQuery(
                              `(${instalado} AT TIME ZONE 'America/Guatemala')::date`,
                              [efectivo.toISOString()],
                          ),
                      }
                    : {}),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await verServicio(input.id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antes, despues)
        await t.emit('servicio.estado_cambiado', {
            servicio_id: input.id,
            empresa_id: empresaId,
            de: 'pendiente_instalacion',
            a: 'activo',
            motivo: 'instalacion',
            ...(input.origen_tipo ? { origen_tipo: input.origen_tipo } : {}),
            ...(input.origen_id ? { origen_id: input.origen_id } : {}),
        })
        if (asignaciones) {
            await registrarTramo(t.trx, input.id, 'activacion')
            await t.emit('asignacion.cambiada', {
                servicio_id: input.id,
                empresa_id: empresaId,
                ipv4: asignaciones.ipv4 ? [asignaciones.ipv4] : [],
                prefijo_enlace_v6: asignaciones.prefijo_enlace_v6,
                prefijo_delegado_v6: asignaciones.prefijo_delegado_v6,
                inicio: new Date().toISOString(),
                fin: null,
            })
        }
        refrescarAaaAlConfirmar(t, { servicioId: input.id })
        return despues
    }
}
