import { DomainAction, type Transaccion } from '#shared/domain_action'
import ActivarInstalacionServicio from '#core/actions/activar_instalacion_servicio'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import { guardarEquipoGestionado } from '#integraciones/equipos/equipos'
import { leerAprovisionamiento, marcarPaso } from '#integraciones/equipos/aprovisionamientos'

/**
 * `equipos.activar_aprovisionamiento` (worker): último tramo de A32, en una sola transacción.
 *
 * 1. Comodato: si el equipo es una unidad `disponible` del inventario, `inventario.asignar_comodato`
 *    (desde la bodega del técnico de la orden, con el origen de Iris).
 * 2. IP y activación: `servicios.activar_instalacion` con el origen de la orden (asigna IP si el
 *    servicio no la reservó, pasa a `activo` y empieza el cobro mensual; emite sus eventos de siempre).
 * 3. Guarda el equipo gestionado del servicio (id externo de SmartOLT, id del ACS) para A33 y A35.
 * 4. `listo`, borra SSID y clave cifrados y emite `instalacion.aprovisionada`.
 *
 * Si algo de 1 o 2 falla, se revierte todo y el worker llama a `equipos.fallar_aprovisionamiento`.
 */
export default class ActivarAprovisionamiento extends DomainAction<{ id: number }, { estado: string }> {
    readonly nombre = 'equipos.activar_aprovisionamiento'

    protected async handle(input: { id: number }, t: Transaccion) {
        const fila = await leerAprovisionamiento(input.id, t.trx, { bloquear: true })
        if (!fila || fila.estado !== 'en_proceso') return { estado: fila?.estado ?? 'inexistente' }
        t.fijarEmpresa(fila.empresa_id)
        t.fijarEntidad('aprovisionamiento', fila.id)
        const origen =
            fila.origen_tipo === 'iris_orden' && fila.origen_id
                ? { origen_tipo: fila.origen_tipo, origen_id: fila.origen_id }
                : {}

        const unidadId = fila.equipo.unidad_id
        if (unidadId) {
            const u = (await t.trx
                .from('inventario.unidades')
                .where('id', unidadId)
                .select('estado')
                .first()) as {
                estado: string
            } | null
            if (u?.estado === 'disponible') {
                const origenIris =
                    fila.origen_tipo === 'iris_orden'
                        ? { origen_tipo: fila.origen_tipo, origen_id: fila.origen_id }
                        : { origen_tipo: null, origen_id: null }
                await new AsignarComodato().execute(
                    // 0.14.3: la bodega ya validada al aceptar (personal o de cuadrilla del técnico
                    // vinculado), sin volver a mirar el actor de Iris (con la orden cerrada es un agente)
                    fila.bodega_id !== null
                        ? {
                              servicio_id: fila.servicio_id,
                              unidad_id: unidadId,
                              bodega_id: fila.bodega_id,
                              ...origenIris,
                          }
                        : {
                              servicio_id: fila.servicio_id,
                              unidad_id: unidadId,
                              tecnico: fila.tecnico_id_externo
                                  ? { id_externo: fila.tecnico_id_externo }
                                  : null,
                              iris_actor: fila.iris_actor,
                              ...origenIris,
                          },
                    t.ctx,
                    { trx: t.trx },
                )
            }
        }
        const servicio = await new ActivarInstalacionServicio().execute(
            { id: fila.servicio_id, ...origen },
            t.ctx,
            { trx: t.trx },
        )
        const ahora = new Date()
        let pasos = marcarPaso(fila.pasos, 'ip', 'hecho', ahora)
        pasos = marcarPaso(pasos, 'activacion', 'hecho', ahora)

        if (fila.smartolt_external_id || fila.acs_device_id) {
            await guardarEquipoGestionado(t.trx, {
                servicio_id: fila.servicio_id,
                empresa_id: fila.empresa_id,
                tipo: fila.equipo.tipo,
                serie: fila.equipo.serie,
                mac: fila.equipo.mac,
                modelo: fila.equipo.modelo,
                unidad_id: unidadId,
                smartolt_external_id: fila.smartolt_external_id,
                smartolt_instancia_id: fila.smartolt_external_id ? fila.smartolt_instancia_id : null,
                acs_device_id: fila.acs_device_id,
                aprovisionamiento_id: fila.id,
            })
        }
        await t.trx
            .from('integraciones.aprovisionamientos')
            .where('id', fila.id)
            .update({
                estado: 'listo',
                pasos: JSON.stringify(pasos),
                causa: null,
                detalle: null,
                reintentable: false,
                wifi_ssid_cifrado: null,
                wifi_clave_cifrada: null,
                proximo_intento_en: null,
                terminado_en: ahora,
                updated_at: ahora,
            })
        await t.emit('instalacion.aprovisionada', {
            aprovisionamiento_id: fila.id,
            servicio_id: fila.servicio_id,
            empresa_id: fila.empresa_id,
            cliente_id: fila.cliente_id,
            origen_tipo: fila.origen_tipo,
            origen_id: fila.origen_id,
            idempotency_key: fila.idempotency_key,
            servicio_estado: String(servicio.estado),
            equipo: {
                tipo: fila.equipo.tipo,
                serie: fila.equipo.serie,
                mac: fila.equipo.mac,
                unidad_id: unidadId,
            },
            senal: fila.senal,
            activado_en: ahora.toISOString(),
        })
        return { estado: 'listo' }
    }
}
