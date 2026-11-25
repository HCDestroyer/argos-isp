import { DomainAction, type Transaccion } from '#shared/domain_action'
import { descifrar } from '#shared/cifrado'
import type { CausaAprovisionamiento } from '#shared/eventos'
import { configDeEmpresa, type ConfigEquipos } from '#integraciones/equipos/configuracion'
import { acsDeEmpresa, type AcsEmpresa } from '#integraciones/equipos/acs'
import { oltDeInstancia, perfilPara } from '#integraciones/equipos/smartolt_instancias'
import { ErrorEquipos } from '#integraciones/equipos/http'
import * as smartolt from '#integraciones/equipos/smartolt'
import * as genieacs from '#integraciones/equipos/genieacs'
import {
    ESPERAS_REINTENTO_S,
    estadoPaso,
    leerAprovisionamiento,
    marcarPaso,
    type FilaAprovisionamiento,
    type NombrePaso,
    type Paso,
} from '#integraciones/equipos/aprovisionamientos'
import { terminarFallido } from '#integraciones/equipos/actions/fallar_aprovisionamiento'

/** Tope de vueltas (reintentos de pasos y de la activación) antes de darlo por fallido. */
export const MAX_INTENTOS = ESPERAS_REINTENTO_S.length + 4

/** Un paso no se pudo hacer: con qué causa y si vale la pena reintentar solo. */
export class FalloPaso extends Error {
    constructor(
        readonly paso: NombrePaso,
        readonly causa: CausaAprovisionamiento,
        message: string,
        /** se reintenta solo (`ESPERAS_REINTENTO_S`) */
        readonly transitorio: boolean,
        /** `reintentable` del contrato si se da por perdido */
        readonly reintentable = transitorio,
    ) {
        super(message)
    }
}

export interface ResultadoPreparar {
    resultado: 'activar' | 'reintentar' | 'fallido' | 'omitido'
}

/**
 * `equipos.preparar_aprovisionamiento` (worker, actor sistema): hace los pasos `equipo` y `wifi` de
 * un aprovisionamiento (A32) con SmartOLT y GenieACS. Cada comando queda en `audit.red`.
 *
 * - **ONT** (SmartOLT): si la serie ya está autorizada con el id externo de Argos (`argos<servicio>`),
 *   el paso ya estaba hecho (reintento); con otro id externo → `equipo_en_uso`. Si no, la busca entre
 *   las no configuradas (`equipo_no_encontrado`, se reintenta: puede no haber encendido aún), toma el
 *   perfil de su OLT y plan (`perfil_sin_mapear`) y la autoriza en línea (`sin_puerto` si el PON está
 *   lleno; `olt_sin_respuesta` si SmartOLT no responde). Lee la señal al final, si puede.
 * - **ACS** (GenieACS), cuando el equipo es un router TR-069, cuando hay Wi-Fi inicial o cuando la
 *   empresa configura PPPoE por el ACS: busca el dispositivo por serie o MAC (`equipo_no_encontrado`
 *   si no contactó al ACS, se reintenta), y con `setParameterValues` pone PPPoE (paso `equipo`) y el
 *   Wi-Fi (paso `wifi`), en TR-098 o TR-181 según el modelo de datos del equipo (`acs_sin_respuesta`).
 * - Un fallo transitorio se reintenta a los 30 s, 1, 2 y 4 min (antes de los 10 min en que Iris
 *   consulta); después queda `fallido` con `reintentable: true`. Uno de negocio termina en el acto.
 * - Con los pasos listos devuelve `activar`: IP, comodato y activación los hace
 *   `equipos.activar_aprovisionamiento` en su propia transacción.
 */
export default class PrepararAprovisionamiento extends DomainAction<{ id: number }, ResultadoPreparar> {
    readonly nombre = 'equipos.preparar_aprovisionamiento'

    protected async handle(input: { id: number }, t: Transaccion): Promise<ResultadoPreparar> {
        const fila = await leerAprovisionamiento(input.id, t.trx, { bloquear: true })
        if (!fila || fila.estado !== 'en_proceso') return { resultado: 'omitido' }
        t.fijarEmpresa(fila.empresa_id)
        t.fijarEntidad('aprovisionamiento', fila.id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', fila.servicio_id)
            .select('estado', 'plan_id', 'user_ppp', 'pass_ppp')
            .first()) as {
            estado: string
            plan_id: number
            user_ppp: string | null
            pass_ppp: string | null
        } | null
        if (!servicio || servicio.estado !== 'pendiente_instalacion') {
            await terminarFallido(t, fila, fila.pasos, {
                causa: 'servicio_no_pendiente',
                reintentable: false,
                detalle: `El servicio ya no está pendiente de instalación (está ${servicio?.estado ?? 'eliminado'})`,
            })
            return { resultado: 'fallido' }
        }
        if (fila.intentos >= MAX_INTENTOS) {
            await terminarFallido(t, fila, fila.pasos, {
                causa: 'otro',
                reintentable: true,
                detalle:
                    'No se pudo terminar después de varios intentos; revisa la bitácora y vuelve a intentarlo',
            })
            return { resultado: 'fallido' }
        }
        const config = await configDeEmpresa(fila.empresa_id, t.trx)
        const acs = await acsDeEmpresa(fila.empresa_id, t.trx)
        let pasos = fila.pasos
        const datos = {
            smartolt_external_id: fila.smartolt_external_id,
            acs_device_id: fila.acs_device_id,
            senal: fila.senal,
        }
        try {
            await this.revisarEnUso(t, fila)
            if (estadoPaso(pasos, 'equipo') === 'pendiente') {
                if (fila.equipo.tipo === 'ont') {
                    datos.smartolt_external_id = await this.autorizarOnt(
                        fila,
                        config,
                        Number(servicio.plan_id),
                    )
                }
                if (this.usaAcs(fila, acs)) {
                    const disp = await this.dispositivo(fila, acs)
                    datos.acs_device_id = disp.id
                    if (this.pppoePorAcs(fila, acs) && servicio.user_ppp && servicio.pass_ppp) {
                        const p = genieacs.PARAMETROS[disp.modelo_datos ?? 'tr098']
                        await this.aplicar(fila, acs, disp, 'equipo', [
                            [p.pppUsuario, servicio.user_ppp],
                            [p.pppClave, descifrar(servicio.pass_ppp)],
                        ])
                    }
                }
                pasos = marcarPaso(pasos, 'equipo', 'hecho')
            }
            if (estadoPaso(pasos, 'wifi') === 'pendiente') {
                const disp = await this.dispositivo(fila, acs)
                datos.acs_device_id = disp.id
                const p = genieacs.PARAMETROS[disp.modelo_datos ?? 'tr098']
                const valores: Array<[string, string]> = []
                if (fila.wifi_ssid_cifrado) valores.push([p.ssid, descifrar(fila.wifi_ssid_cifrado)])
                if (fila.wifi_clave_cifrada) valores.push([p.clave, descifrar(fila.wifi_clave_cifrada)])
                if (valores.length > 0) await this.aplicar(fila, acs, disp, 'wifi', valores)
                pasos = marcarPaso(pasos, 'wifi', 'hecho')
            }
            if (fila.equipo.tipo === 'ont' && datos.smartolt_external_id && config.smartolt && !datos.senal) {
                datos.senal = await smartolt
                    .senal(config.smartolt, datos.smartolt_external_id, fila.servicio_id)
                    .catch(() => null)
            }
        } catch (error) {
            if (!(error instanceof FalloPaso)) throw error
            return this.fallo(t, fila, pasos, datos, error)
        }

        await t.trx
            .from('integraciones.aprovisionamientos')
            .where('id', fila.id)
            .update({
                pasos: JSON.stringify(pasos),
                smartolt_external_id: datos.smartolt_external_id,
                acs_device_id: datos.acs_device_id,
                senal: datos.senal ? JSON.stringify(datos.senal) : null,
                intentos: fila.intentos + 1,
                // si la activación se cae sin respuesta (proceso caído), el cron la retoma en 1 min
                proximo_intento_en: new Date(Date.now() + 60_000),
                updated_at: new Date(),
            })
        return { resultado: 'activar' }
    }

    /** ¿El paso `equipo` pasa por el ACS? */
    private usaAcs(fila: FilaAprovisionamiento, acs: AcsEmpresa): boolean {
        return (
            fila.equipo.tipo === 'router_tr069' ||
            Boolean(fila.wifi_clave_cifrada || fila.wifi_ssid_cifrado) ||
            this.pppoePorAcs(fila, acs)
        )
    }

    /**
     * PPPoE por el ACS: se decidió al aceptar (`equipo.pppoe_por_acs`, §4.3). Los pedidos aceptados antes
     * del lote 2 no lo traen: entonces vale el ajuste actual del ACS si está operativo.
     */
    private pppoePorAcs(fila: FilaAprovisionamiento, acs: AcsEmpresa): boolean {
        if (typeof fila.equipo.pppoe_por_acs === 'boolean') return fila.equipo.pppoe_por_acs
        return acs.operativo && acs.pppoePorAcs
    }

    /** La serie o la MAC ya están en otro servicio (inventario o equipo gestionado). */
    private async revisarEnUso(t: Transaccion, fila: FilaAprovisionamiento) {
        const { serie, mac, unidad_id: unidadId } = fila.equipo
        if (unidadId) {
            const u = (await t.trx
                .from('inventario.unidades')
                .where('id', unidadId)
                .select('estado', 'servicio_id')
                .first()) as { estado: string; servicio_id: number | null } | null
            if (
                u &&
                u.servicio_id !== null &&
                Number(u.servicio_id) !== fila.servicio_id &&
                u.estado === 'en_comodato'
            ) {
                throw new FalloPaso(
                    'equipo',
                    'equipo_en_uso',
                    'El equipo está en comodato en otro servicio',
                    false,
                )
            }
        }
        const otro = await t.trx
            .from('integraciones.equipos_servicio as e')
            .join('core.servicios as s', 's.id', 'e.servicio_id')
            .whereNot('e.servicio_id', fila.servicio_id)
            .whereNot('s.estado', 'retirado')
            .where((q) => {
                if (serie) q.orWhereRaw('upper(e.serie) = ?', [serie])
                if (mac) q.orWhere('e.mac', mac)
            })
            .select('e.servicio_id')
            .first()
        if ((serie || mac) && otro) {
            throw new FalloPaso(
                'equipo',
                'equipo_en_uso',
                'La serie o la MAC ya están en otro servicio',
                false,
            )
        }
    }

    private async autorizarOnt(
        fila: FilaAprovisionamiento,
        config: ConfigEquipos,
        planId: number,
    ): Promise<string> {
        const so = config.smartolt
        if (!so) {
            throw new FalloPaso(
                'equipo',
                'otro',
                'SmartOLT ya no está configurado en la empresa',
                false,
                true,
            )
        }
        const serie = fila.equipo.serie!
        const externo = smartolt.idExternoOnu(fila.servicio_id)
        try {
            const autorizadas = await smartolt.detallesPorSerie(so, serie, fila.servicio_id)
            const ya = autorizadas.find((o) => o.unique_external_id)
            if (ya?.unique_external_id === externo) return externo
            if (ya) {
                throw new FalloPaso(
                    'equipo',
                    'equipo_en_uso',
                    'La ONT ya está autorizada en SmartOLT para otro cliente',
                    false,
                )
            }
            const onu = await smartolt.buscarSinConfigurar(so, serie, fila.servicio_id)
            if (!onu) {
                throw new FalloPaso(
                    'equipo',
                    'equipo_no_encontrado',
                    'La ONT no aparece en la OLT: revisa que esté conectada y encendida',
                    true,
                )
            }
            const ref = config.smartoltInstanciaId
                ? await oltDeInstancia(config.smartoltInstanciaId, onu.olt_id)
                : null
            const perfil = ref ? await perfilPara(Number(ref.id), planId) : null
            if (!perfil) {
                throw new FalloPaso(
                    'equipo',
                    'perfil_sin_mapear',
                    `La OLT ${onu.olt_id} de SmartOLT no tiene perfil de autorización para el plan del servicio`,
                    false,
                )
            }
            const entrada: smartolt.EntradaAutorizar = {
                olt_id: onu.olt_id,
                pon_type: onu.pon_type,
                sn: onu.sn,
                board: onu.board,
                port: onu.port,
                authorization_preset_id: perfil.authorization_preset_id,
                onu_external_id: externo,
            }
            try {
                await smartolt.autorizar(so, entrada, fila.servicio_id)
            } catch (error) {
                if (
                    !(error instanceof smartolt.ErrorSmartOlt) ||
                    error.codigo !== 'specify_onu_type' ||
                    !onu.onu_type_name
                ) {
                    throw error
                }
                await smartolt.autorizar(so, { ...entrada, onu_type: onu.onu_type_name }, fila.servicio_id)
            }
            return externo
        } catch (error) {
            if (error instanceof FalloPaso) throw error
            if (error instanceof ErrorEquipos) {
                throw new FalloPaso('equipo', 'olt_sin_respuesta', error.message, error.transitorio, true)
            }
            if (error instanceof smartolt.ErrorSmartOlt) {
                const m = error.message
                if (/PON port is full/i.test(m)) throw new FalloPaso('equipo', 'sin_puerto', m, false)
                if (/preset/i.test(error.codigo ?? '')) {
                    throw new FalloPaso('equipo', 'perfil_sin_mapear', m, false)
                }
                if (/in progress|not responding|unable to process/i.test(m)) {
                    throw new FalloPaso('equipo', 'olt_sin_respuesta', m, true)
                }
                throw new FalloPaso('equipo', 'otro', m, false)
            }
            throw error
        }
    }

    private async dispositivo(
        fila: FilaAprovisionamiento,
        config: AcsEmpresa,
    ): Promise<genieacs.DispositivoAcs> {
        const acs = config.genieacs
        if (!acs || !config.operativo) {
            throw new FalloPaso(
                'equipo',
                'acs_sin_respuesta',
                'El ACS de la empresa está apagado o sin probar',
                false,
                true,
            )
        }
        try {
            const { serie, mac } = fila.equipo
            const disp =
                (fila.acs_device_id
                    ? await genieacs.porId(acs, fila.acs_device_id, fila.servicio_id)
                    : null) ??
                (serie ? await genieacs.porSerie(acs, serie, fila.servicio_id) : null) ??
                (mac ? await genieacs.porMac(acs, mac, fila.servicio_id) : null)
            if (!disp) {
                throw new FalloPaso(
                    'equipo',
                    'equipo_no_encontrado',
                    'El equipo todavía no contactó al ACS (TR-069): revisa que tenga la URL del ACS y salida a internet',
                    true,
                )
            }
            return disp
        } catch (error) {
            if (error instanceof ErrorEquipos) {
                throw new FalloPaso('equipo', 'acs_sin_respuesta', error.message, error.transitorio, true)
            }
            throw error
        }
    }

    private async aplicar(
        fila: FilaAprovisionamiento,
        config: AcsEmpresa,
        disp: genieacs.DispositivoAcs,
        paso: NombrePaso,
        valores: Array<[string, string]>,
    ) {
        let r: genieacs.ResultadoTarea
        try {
            r = await genieacs.tarea(
                config.genieacs!,
                disp.id,
                genieacs.setParametros(valores),
                fila.servicio_id,
            )
        } catch (error) {
            if (error instanceof ErrorEquipos) {
                if (error.status === 404) {
                    throw new FalloPaso(
                        paso,
                        'equipo_no_encontrado',
                        'El equipo ya no está registrado en el ACS',
                        true,
                    )
                }
                throw new FalloPaso(paso, 'acs_sin_respuesta', error.message, error.transitorio, true)
            }
            throw error
        }
        if (r === 'sin_respuesta') {
            throw new FalloPaso(paso, 'acs_sin_respuesta', 'El equipo no respondió al ACS a tiempo', true)
        }
        if (r === 'rechazada') {
            throw new FalloPaso(paso, 'otro', 'El equipo rechazó la configuración por TR-069', false)
        }
    }

    private async fallo(
        t: Transaccion,
        fila: FilaAprovisionamiento,
        pasos: Paso[],
        datos: { smartolt_external_id: string | null; acs_device_id: string | null; senal: unknown },
        error: FalloPaso,
    ): Promise<ResultadoPreparar> {
        const espera = ESPERAS_REINTENTO_S[fila.intentos]
        if (error.transitorio && espera !== undefined) {
            await t.trx
                .from('integraciones.aprovisionamientos')
                .where('id', fila.id)
                .update({
                    pasos: JSON.stringify(pasos),
                    smartolt_external_id: datos.smartolt_external_id,
                    acs_device_id: datos.acs_device_id,
                    intentos: fila.intentos + 1,
                    proximo_intento_en: new Date(Date.now() + espera * 1000),
                    // la causa es del resultado final (§12.2); mientras reintenta solo el detalle
                    causa: null,
                    detalle: `${error.message} (se reintenta en ${espera} s)`,
                    updated_at: new Date(),
                })
            return { resultado: 'reintentar' }
        }
        await terminarFallido(
            t,
            { ...fila, ...datos } as FilaAprovisionamiento,
            marcarPaso(pasos, error.paso, 'fallido'),
            {
                causa: error.causa,
                reintentable: error.reintentable,
                detalle: error.message,
            },
        )
        return { resultado: 'fallido' }
    }
}
