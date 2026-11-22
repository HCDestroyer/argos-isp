import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { PlanNoPermitido, planDisponibleEnRouter } from '#core/instalacion_iris'
import { normalizarMac, normalizarSerie } from '#inventario/unidades'
import AsignarComodato from '#inventario/actions/asignar_comodato'
import { configDeEmpresa, gestionDe } from '#integraciones/equipos/configuracion'
import {
    AprovisionamientoEnCurso,
    AprovisionamientoNoDisponible,
    EquipoInvalido,
    WifiNoDisponible,
    validarWifi,
} from '#integraciones/equipos/equipos'
import { pasosIniciales } from '#integraciones/equipos/aprovisionamientos'
import { encolarEquipos } from '#integraciones/equipos/cola'

export interface EntradaAprovisionar {
    servicio_id: number
    equipo: {
        tipo: 'ont' | 'cpe_wireless' | 'router_tr069'
        serie?: string | null
        mac?: string | null
        unidad_id?: number | null
        modelo?: string | null
    }
    planta?: {
        olt?: string | null
        slot?: number | null
        pon?: number | null
        caja?: string | null
        puerto?: number | null
    } | null
    wireless?: { ap?: string | null; sector?: string | null } | null
    wifi?: { ssid?: string | null; clave?: string | null } | null
    tecnico?: { id_externo: string } | null
    origen_tipo?: 'iris_orden' | null
    origen_id?: string | null
    /** `Idempotency-Key` de la petición (la pone la ruta) */
    idempotency_key?: string | null
}

export interface SalidaAprovisionar {
    aprovisionamiento_id: number
    estado: 'en_proceso'
}

/** Unidad del inventario de la empresa con esa serie o MAC (o por su id), si la hay. */
export async function unidadDelEquipo(
    trx: TransactionClientContract,
    empresaId: number,
    equipo: EntradaAprovisionar['equipo'],
): Promise<{ id: number; estado: string; servicio_id: number | null } | null> {
    const q = trx.from('inventario.unidades').where('empresa_id', empresaId)
    if (equipo.unidad_id) {
        q.where('id', equipo.unidad_id)
    } else {
        const serie = normalizarSerie(equipo.serie)
        const mac = normalizarMac(equipo.mac)
        if (!serie && !mac) return null
        q.where((w) => {
            if (serie) w.orWhereRaw('upper(serie) = ?', [serie])
            if (mac) w.orWhere('mac', mac)
        }).whereNotIn('estado', ['dada_de_baja', 'no_recuperada'])
    }
    const fila = (await q.orderBy('id', 'desc').select('id', 'estado', 'servicio_id').first()) as {
        id: number
        estado: string
        servicio_id: number | null
    } | null
    if (!fila) {
        if (equipo.unidad_id) {
            throw new NoEncontrado(`La unidad ${equipo.unidad_id} no existe en esta empresa`)
        }
        return null
    }
    return {
        id: Number(fila.id),
        estado: fila.estado,
        servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
    }
}

/**
 * `servicios.aprovisionar` (`POST /servicios/:id/aprovisionar`, contrato Iris 0.9.0 §12.2, A32).
 *
 * Valida y **acepta**: el trabajo con SmartOLT y GenieACS lo hace el worker (`equipos:worker`) y el
 * resultado llega por `instalacion.aprovisionada` / `instalacion.fallida`.
 *
 * - `409 servicio_no_pendiente`, `422 equipo_invalido` (combinación de tipo, planta y wireless),
 *   `422 wifi_invalido`, `422 plan_no_permitido` (el plan ya no aplica al router).
 * - `422 aprovisionamiento_no_disponible` si la empresa no gestiona esa tecnología (ONT: SmartOLT
 *   probado; router TR-069: GenieACS probado; CPE: cualquiera de las dos) y `422 wifi_no_disponible`
 *   con `wifi` sin GenieACS probado.
 * - `409 aprovisionamiento_en_curso` (con `extensions.aprovisionamiento_id`) si ya hay uno.
 * - Si el equipo es una unidad `disponible` del inventario, simula el comodato (que la revierte):
 *   `409 unidad_en_otra_bodega` sale en el acto. El comodato real se hace al activar.
 * - Guarda el pedido con la clave Wi-Fi y el SSID **cifrados** (se borran al terminar); en la
 *   auditoría `wifi` va como `***`. Encola el trabajo al confirmar.
 */
export default class AprovisionarServicio extends DomainAction<EntradaAprovisionar, SalidaAprovisionar> {
    readonly nombre = 'servicios.aprovisionar'
    protected override readonly camposEntradaOcultos = ['wifi']

    protected async handle(input: EntradaAprovisionar, t: Transaccion): Promise<SalidaAprovisionar> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('estado', 'empresa_id', 'cliente_id', 'plan_id', 'router_id')
            .first()) as {
            estado: string
            empresa_id: number
            cliente_id: number
            plan_id: number
            router_id: number
        } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        if (servicio.estado !== 'pendiente_instalacion') {
            throw new Conflicto(
                `El servicio ${input.servicio_id} no está pendiente de instalación (está ${servicio.estado})`,
                'servicio_no_pendiente',
                'El servicio no está pendiente de instalación',
            )
        }
        const { equipo } = input
        if (equipo.tipo === 'ont' && !equipo.serie) {
            throw new EquipoInvalido('Una ONT se identifica por su serie', [
                { field: 'equipo.serie', rule: 'requerido', message: 'La ONT necesita su serie' },
            ])
        }
        if (equipo.tipo === 'cpe_wireless' && !equipo.mac) {
            throw new EquipoInvalido('Un CPE o radio se identifica por su MAC', [
                { field: 'equipo.mac', rule: 'requerido', message: 'El CPE necesita su MAC' },
            ])
        }
        if (equipo.tipo === 'router_tr069' && !equipo.mac && !equipo.serie) {
            throw new EquipoInvalido('Un router TR-069 se identifica por su MAC o su serie', [
                { field: 'equipo.mac', rule: 'requerido', message: 'Manda la MAC o la serie' },
            ])
        }
        if (equipo.mac && !normalizarMac(equipo.mac)) {
            throw new EquipoInvalido('La MAC no tiene formato de MAC', [
                { field: 'equipo.mac', rule: 'formato', message: 'Seis pares hexadecimales' },
            ])
        }
        if (input.planta && equipo.tipo !== 'ont') {
            throw new EquipoInvalido('`planta` solo va con una ONT', [
                { field: 'planta', rule: 'combinacion', message: 'Solo con `equipo.tipo = ont`' },
            ])
        }
        if (input.wireless && equipo.tipo !== 'cpe_wireless') {
            throw new EquipoInvalido('`wireless` solo va con un CPE inalámbrico', [
                { field: 'wireless', rule: 'combinacion', message: 'Solo con `equipo.tipo = cpe_wireless`' },
            ])
        }
        if (input.wifi) validarWifi(input.wifi, 'wifi.')

        const config = await configDeEmpresa(empresaId, t.trx)
        const gestion = gestionDe(config)
        const disponible =
            equipo.tipo === 'ont'
                ? gestion.ftth
                : equipo.tipo === 'router_tr069'
                  ? gestion.tr069
                  : gestion.wireless
        if (!disponible) {
            throw new AprovisionamientoNoDisponible(
                equipo.tipo === 'ont'
                    ? 'La empresa no tiene SmartOLT configurado y probado en Argos: activa la instalación al cerrar la orden'
                    : equipo.tipo === 'router_tr069'
                      ? 'La empresa no tiene el ACS (GenieACS) configurado y probado en Argos'
                      : undefined,
            )
        }
        if (input.wifi && !gestion.tr069) throw new WifiNoDisponible()
        if (!(await planDisponibleEnRouter(t.trx, Number(servicio.plan_id), Number(servicio.router_id)))) {
            throw new PlanNoPermitido(
                'El plan del servicio no está asignado a su router: cámbialo antes de activar',
            )
        }

        const enCurso = (await t.trx
            .from('integraciones.aprovisionamientos')
            .where('servicio_id', input.servicio_id)
            .where('estado', 'en_proceso')
            .select('id')
            .first()) as { id: number } | null
        if (enCurso) throw new AprovisionamientoEnCurso(Number(enCurso.id))

        // La unidad del inventario: si está disponible, el comodato debe poder salir de la bodega del
        // técnico (409 unidad_en_otra_bodega en el acto). Se simula y se revierte.
        const unidad = await unidadDelEquipo(t.trx, empresaId, equipo)
        if (unidad && unidad.estado === 'disponible') {
            // en un savepoint que siempre se revierte (otra conexión chocaría con el lock del servicio)
            const revertir = new Error('simulacion')
            try {
                await t.trx.transaction(async (sp) => {
                    await new AsignarComodato().execute(
                        {
                            servicio_id: input.servicio_id,
                            unidad_id: unidad.id,
                            tecnico: input.tecnico ? { id_externo: input.tecnico.id_externo } : null,
                            iris_actor: t.ctx.iris?.actor ?? null,
                            origen_tipo: input.origen_tipo ?? null,
                            origen_id: input.origen_id ?? null,
                        },
                        t.ctx,
                        { trx: sp },
                    )
                    throw revertir
                })
            } catch (error) {
                if (error !== revertir) throw error
            }
        }

        // ¿Qué pasos aplican? Equipo: siempre salvo un CPE sin ACS (solo IP y activación).
        const usaAcs =
            equipo.tipo === 'router_tr069' || Boolean(input.wifi) || (config.pppoePorAcs && gestion.tr069)
        const pasoEquipo = equipo.tipo !== 'cpe_wireless' || usaAcs
        const gestionado = equipo.tipo === 'ont' || usaAcs
        const ahora = new Date()
        const [fila] = (await t.trx
            .insertQuery()
            .table('integraciones.aprovisionamientos')
            .insert({
                empresa_id: empresaId,
                servicio_id: input.servicio_id,
                cliente_id: Number(servicio.cliente_id),
                origen_tipo: input.origen_tipo ?? null,
                origen_id: input.origen_id ?? null,
                idempotency_key: input.idempotency_key ?? null,
                pasos: JSON.stringify(pasosIniciales({ equipo: pasoEquipo, wifi: Boolean(input.wifi) })),
                equipo: JSON.stringify({
                    tipo: equipo.tipo,
                    serie: normalizarSerie(equipo.serie),
                    mac: normalizarMac(equipo.mac),
                    unidad_id: unidad?.id ?? equipo.unidad_id ?? null,
                    modelo: equipo.modelo ?? null,
                    gestionado,
                }),
                planta: input.planta ? JSON.stringify(input.planta) : null,
                wireless: input.wireless ? JSON.stringify(input.wireless) : null,
                wifi_ssid_cifrado: input.wifi?.ssid ? cifrar(input.wifi.ssid) : null,
                wifi_clave_cifrada: input.wifi?.clave ? cifrar(input.wifi.clave) : null,
                tecnico_id_externo: input.tecnico?.id_externo ?? null,
                iris_actor: t.ctx.iris?.actor ?? null,
                proximo_intento_en: ahora,
                creado_por_tipo: t.ctx.actor.tipo,
                creado_por_id: t.ctx.actor.id,
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.anotarAuditoria({ aprovisionamiento_id: id })
        t.alConfirmar(() => encolarEquipos('aprovisionar', id))
        return { aprovisionamiento_id: id, estado: 'en_proceso' }
    }
}
