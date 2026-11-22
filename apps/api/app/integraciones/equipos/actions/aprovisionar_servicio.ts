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
import { iniciadoPor, pasosIniciales } from '#integraciones/equipos/aprovisionamientos'
import { encolarEquipos } from '#integraciones/equipos/cola'
import { CONTRATO_CAPACIDADES_EQUIPOS, CapacidadNoDisponible } from '#integraciones/equipos/capacidades'
import { conectorAdmite } from '#integraciones/iris/configuracion'
import { actorDesconocido, esActorIris, estadoVinculos, vinculosEnCarga } from '#inventario/vinculos_iris'
import { accesoDelTecnico } from '#inventario/cuadrillas'

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
    /** del token de Iris; el panel de Argos siempre guarda `argos_panel` (0.14.3) */
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

/** 409 `unidad_en_otra_bodega` de la 0.14.3: sin decir de qué bodega ni de qué empresa es. */
export class UnidadEnOtraBodega extends Conflicto {
    constructor() {
        super(
            'El equipo está en el inventario, pero no en una bodega permitida ni asignado a este servicio',
            'unidad_en_otra_bodega',
            'Unidad en otra bodega',
        )
    }
}

interface UnidadInventario {
    id: number
    empresa_id: number
    estado: string
    bodega_id: number | null
    servicio_id: number | null
}

/**
 * La unidad del equipo en **todo** el inventario (cualquier empresa), por `unidad_id`, `serie` o `mac`
 * (0.14.3). Sin `unidad_id`, solo unidades vivas; un `unidad_id` que no existe: 404.
 */
async function unidadEnInventario(
    trx: TransactionClientContract,
    equipo: EntradaAprovisionar['equipo'],
): Promise<UnidadInventario | null> {
    const q = trx.from('inventario.unidades')
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
    const fila = (await q
        .orderBy('id', 'desc')
        .select('id', 'empresa_id', 'estado', 'bodega_id', 'servicio_id')
        .first()) as UnidadInventario | null
    if (!fila) {
        if (equipo.unidad_id) throw new NoEncontrado(`La unidad ${equipo.unidad_id} no existe`)
        return null
    }
    const n = (v: number | null) => (v === null ? null : Number(v))
    return {
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        estado: fila.estado,
        bodega_id: n(fila.bodega_id),
        servicio_id: n(fila.servicio_id),
    }
}

/**
 * Reglas de la 0.14.3 (§12.2) para el equipo del inventario, al aceptar:
 *
 * - Con `tecnico`: su `id_externo` es un técnico **vinculado** (I1) en la empresa del servicio (si no,
 *   `403 actor_desconocido`; en la carga inicial, `409 vinculos_en_carga`). No se exige que el actor de
 *   Iris sea el técnico: con la orden cerrada lo pide un agente.
 * - La unidad: ya asignada al servicio (no hay comodato) o, con `tecnico`, `disponible` en su bodega
 *   personal o de una cuadrilla suya de esa empresa (el comodato sale de esa bodega al activar).
 *   Cualquier otro lugar, también otra empresa: `409 unidad_en_otra_bodega`, sin decir dónde.
 * - Un equipo que no está en el inventario: permitido, sin comodato.
 *
 * Devuelve la unidad (o null) y la bodega de la que sale el comodato (null si no hay comodato).
 */
async function validarUnidad0143(
    t: Transaccion,
    input: EntradaAprovisionar,
    servicioId: number,
    empresaId: number,
): Promise<{ unidadId: number | null; bodegaId: number | null }> {
    let usuarioTecnico: number | null = null
    if (input.tecnico) {
        const idExterno = String(input.tecnico.id_externo).trim()
        const estado = await estadoVinculos(t.trx)
        const vinculo = /^\d{1,18}$/.test(idExterno)
            ? await t.trx
                  .from('inventario.tecnicos_iris')
                  .where({ empresa_id: empresaId, usuario_id: Number(idExterno), estado: 'vinculado' })
                  .select('id')
                  .first()
            : null
        if (!vinculo) {
            if (estado.enCarga) throw vinculosEnCarga()
            throw actorDesconocido(
                `El técnico ${idExterno} no tiene un vínculo de técnico conocido en la empresa del servicio`,
            )
        }
        usuarioTecnico = Number(idExterno)
    }
    const unidad = await unidadEnInventario(t.trx, input.equipo)
    if (!unidad) return { unidadId: null, bodegaId: null }
    if (unidad.servicio_id === servicioId && ['en_comodato', 'por_recuperar'].includes(unidad.estado)) {
        t.anotarAuditoria({ unidad_ya_asignada: unidad.id })
        return { unidadId: unidad.id, bodegaId: null }
    }
    if (usuarioTecnico === null || unidad.empresa_id !== empresaId || unidad.estado !== 'disponible') {
        throw new UnidadEnOtraBodega()
    }
    const acceso = await accesoDelTecnico(t.trx, usuarioTecnico, empresaId, new Date())
    if (unidad.bodega_id === null || !acceso.bodegas.includes(unidad.bodega_id)) {
        throw new UnidadEnOtraBodega()
    }
    return { unidadId: unidad.id, bodegaId: unidad.bodega_id }
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
 * - **0.14.3** (token de Iris con contrato ≥ 0.14.3): `validarUnidad0143` (técnico vinculado, unidad
 *   en su bodega o ya asignada, búsqueda en todo el inventario) y `wifi` sin la marca `wifi`:
 *   `422 capacidad_no_disponible`. Lo que pide el panel de Argos lleva `origen_tipo: argos_panel` y
 *   `origen_id: null` (`iniciado_por: argos`); el 409 dice `iniciado_por`.
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
        const deIris = await esActorIris(t)
        const reglas0143 = deIris && (await conectorAdmite(CONTRATO_CAPACIDADES_EQUIPOS, t.trx))
        // 0.14.3: lo que inicia el panel de Argos no es de una orden de Iris
        const origenTipo = deIris ? (input.origen_tipo ?? null) : 'argos_panel'
        const origenId = deIris ? (input.origen_id ?? null) : null
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
        if (input.wifi && !gestion.tr069) {
            throw reglas0143 ? new CapacidadNoDisponible() : new WifiNoDisponible()
        }
        if (!(await planDisponibleEnRouter(t.trx, Number(servicio.plan_id), Number(servicio.router_id)))) {
            throw new PlanNoPermitido(
                'El plan del servicio no está asignado a su router: cámbialo antes de activar',
            )
        }

        const enCurso = (await t.trx
            .from('integraciones.aprovisionamientos')
            .where('servicio_id', input.servicio_id)
            .where('estado', 'en_proceso')
            .select('id', 'origen_tipo')
            .first()) as { id: number; origen_tipo: string | null } | null
        if (enCurso) throw new AprovisionamientoEnCurso(Number(enCurso.id), iniciadoPor(enCurso.origen_tipo))

        // La unidad del inventario: si está disponible, el comodato debe poder salir de la bodega del
        // técnico (409 unidad_en_otra_bodega en el acto). Se simula y se revierte.
        let unidadId: number | null
        let bodegaComodato: number | null = null
        let simular: boolean
        if (reglas0143) {
            const r = await validarUnidad0143(t, input, input.servicio_id, empresaId)
            unidadId = r.unidadId
            bodegaComodato = r.bodegaId
            simular = r.bodegaId !== null
        } else {
            const unidad = await unidadDelEquipo(t.trx, empresaId, equipo)
            unidadId = unidad?.id ?? null
            simular = unidad?.estado === 'disponible'
        }
        if (unidadId !== null && simular) {
            // en un savepoint que siempre se revierte (otra conexión chocaría con el lock del servicio)
            const revertir = new Error('simulacion')
            try {
                await t.trx.transaction(async (sp) => {
                    await new AsignarComodato().execute(
                        bodegaComodato !== null
                            ? {
                                  servicio_id: input.servicio_id,
                                  unidad_id: unidadId,
                                  bodega_id: bodegaComodato,
                                  origen_tipo: origenTipo === 'iris_orden' ? origenTipo : null,
                                  origen_id: origenTipo === 'iris_orden' ? origenId : null,
                              }
                            : {
                                  servicio_id: input.servicio_id,
                                  unidad_id: unidadId,
                                  tecnico: input.tecnico ? { id_externo: input.tecnico.id_externo } : null,
                                  iris_actor: t.ctx.iris?.actor ?? null,
                                  origen_tipo: origenTipo === 'iris_orden' ? origenTipo : null,
                                  origen_id: origenTipo === 'iris_orden' ? origenId : null,
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
                origen_tipo: origenTipo,
                origen_id: origenId,
                idempotency_key: input.idempotency_key ?? null,
                pasos: JSON.stringify(pasosIniciales({ equipo: pasoEquipo, wifi: Boolean(input.wifi) })),
                equipo: JSON.stringify({
                    tipo: equipo.tipo,
                    serie: normalizarSerie(equipo.serie),
                    mac: normalizarMac(equipo.mac),
                    unidad_id: unidadId ?? (reglas0143 ? null : (equipo.unidad_id ?? null)),
                    modelo: equipo.modelo ?? null,
                    gestionado,
                }),
                planta: input.planta ? JSON.stringify(input.planta) : null,
                wireless: input.wireless ? JSON.stringify(input.wireless) : null,
                wifi_ssid_cifrado: input.wifi?.ssid ? cifrar(input.wifi.ssid) : null,
                wifi_clave_cifrada: input.wifi?.clave ? cifrar(input.wifi.clave) : null,
                tecnico_id_externo: input.tecnico?.id_externo ?? null,
                bodega_id: bodegaComodato,
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
