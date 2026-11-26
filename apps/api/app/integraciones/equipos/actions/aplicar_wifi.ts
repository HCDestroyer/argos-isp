import { DomainAction, type Transaccion } from '#shared/domain_action'
import { descifrar } from '#shared/cifrado'
import { acsDeEmpresa } from '#integraciones/equipos/acs'
import { equipoGestionado } from '#integraciones/equipos/equipos'
import { ErrorEquipos } from '#integraciones/equipos/http'
import * as genieacs from '#integraciones/equipos/genieacs'
import { ESPERAS_REINTENTO_WIFI_S, type FilaWifi } from '#integraciones/equipos/aprovisionamientos'

type Causa = 'equipo_sin_gestion' | 'equipo_sin_respuesta' | 'rechazado_por_equipo' | 'otro'

export interface ResultadoAplicarWifi {
    resultado: 'aplicado' | 'fallido' | 'reintentar' | 'omitido'
}

/**
 * `equipos.aplicar_wifi` (worker, actor sistema): aplica un cambio de Wi-Fi aceptado (A35) con
 * `setParameterValues` en GenieACS y connection request.
 *
 * - Parámetros según el modelo de datos del equipo (TR-098 o TR-181, `genieacs.PARAMETROS`); si el
 *   ACS no lo deja ver, prueba TR-098 y, si el equipo la rechaza, TR-181.
 * - `aplicado` cuando el NBI responde 200 (la tarea corrió en la sesión). Si el equipo no abrió
 *   sesión a tiempo, la tarea se borra del ACS y se reintenta a los 20 s y 1 min; después `fallido`
 *   con `equipo_sin_respuesta`. Si el equipo la rechaza: `rechazado_por_equipo`.
 * - Al resolverse: borra SSID y clave cifrados, borra la última lectura del equipo y emite
 *   `equipo.wifi_resuelto` (sin SSID ni clave). Con `aplicado`, notify avisa al titular.
 */
export default class AplicarWifi extends DomainAction<{ id: number }, ResultadoAplicarWifi> {
    readonly nombre = 'equipos.aplicar_wifi'

    protected async handle(input: { id: number }, t: Transaccion): Promise<ResultadoAplicarWifi> {
        const fila = (await t.trx
            .from('integraciones.wifi_solicitudes')
            .where('id', input.id)
            .forUpdate()
            .first()) as FilaWifi | null
        if (!fila || fila.estado !== 'en_proceso') return { resultado: 'omitido' }
        const servicioId = Number(fila.servicio_id)
        const empresaId = Number(fila.empresa_id)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('solicitud_wifi', Number(fila.id))

        const config = await acsDeEmpresa(empresaId, t.trx)
        const equipo = await equipoGestionado(servicioId, empresaId, t.trx)
        if (!config.operativo || !config.genieacs || !equipo?.acs_device_id) {
            return this.resolver(t, fila, 'fallido', 'equipo_sin_gestion')
        }
        const acs = config.genieacs
        let causa: Causa | null = null
        let transitorio = false
        try {
            const disp = await genieacs.porId(acs, equipo.acs_device_id, servicioId)
            if (!disp) return this.resolver(t, fila, 'fallido', 'equipo_sin_gestion')
            const modelos: genieacs.ModeloDatos[] = disp.modelo_datos
                ? [disp.modelo_datos]
                : ['tr098', 'tr181']
            for (const modelo of modelos) {
                const p = genieacs.PARAMETROS[modelo]
                const valores: Array<[string, string]> = []
                if (fila.ssid_cifrado) valores.push([p.ssid, descifrar(fila.ssid_cifrado)])
                if (fila.clave_cifrada) valores.push([p.clave, descifrar(fila.clave_cifrada)])
                const r = await genieacs.tarea(acs, disp.id, genieacs.setParametros(valores), servicioId)
                if (r === 'aplicada') return this.resolver(t, fila, 'aplicado', null)
                causa = r === 'sin_respuesta' ? 'equipo_sin_respuesta' : 'rechazado_por_equipo'
                transitorio = r === 'sin_respuesta'
                if (r === 'sin_respuesta') break
            }
        } catch (error) {
            if (!(error instanceof ErrorEquipos)) throw error
            causa = error.status === 404 ? 'equipo_sin_gestion' : 'equipo_sin_respuesta'
            transitorio = error.transitorio
        }
        const espera = ESPERAS_REINTENTO_WIFI_S[fila.intentos]
        if (transitorio && espera !== undefined) {
            await t.trx
                .from('integraciones.wifi_solicitudes')
                .where('id', fila.id)
                .update({
                    intentos: fila.intentos + 1,
                    proximo_intento_en: new Date(Date.now() + espera * 1000),
                    updated_at: new Date(),
                })
            return { resultado: 'reintentar' }
        }
        return this.resolver(t, fila, 'fallido', causa ?? 'otro')
    }

    private async resolver(
        t: Transaccion,
        fila: FilaWifi,
        estado: 'aplicado' | 'fallido',
        causa: Causa | null,
    ): Promise<ResultadoAplicarWifi> {
        const ahora = new Date()
        await t.trx
            .from('integraciones.wifi_solicitudes')
            .where('id', fila.id)
            .update({
                estado,
                causa,
                ssid_cifrado: null,
                clave_cifrada: null,
                proximo_intento_en: null,
                intentos: fila.intentos + 1,
                resuelto_en: ahora,
                updated_at: ahora,
            })
        await t.trx.from('integraciones.equipos_lecturas').where('servicio_id', fila.servicio_id).delete()
        await t.emit('equipo.wifi_resuelto', {
            solicitud_id: Number(fila.id),
            servicio_id: Number(fila.servicio_id),
            empresa_id: Number(fila.empresa_id),
            cliente_id: Number(fila.cliente_id),
            origen_tipo: fila.origen_tipo,
            origen_id: fila.origen_id,
            idempotency_key: fila.idempotency_key,
            estado,
            causa,
        })
        return { resultado: estado }
    }
}
