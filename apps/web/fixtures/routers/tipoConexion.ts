import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { ipEnCidr, ipv4ANumero } from '~/utils/red'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { claveGenerada, MENSAJE_API_PPPOE_LOCAL } from '../servicios/rutas'
import { conCorteTunel } from './corteTunel'

/**
 * Tipo de conexión por router (`contratos/tipo-conexion-router.md`, A1): la vista previa y el cambio
 * con sus servicios, como `vistaPreviaTipoConexion` y `CambiarTipoConexionRouter`
 * (`apps/api/app/network/tipo_conexion_router.ts`), con los mismos textos.
 */

type Tipo = Schema<'Router'>['tipo_conexion']
type Vista = Schema<'VistaPreviaTipoConexion'>
type ServicioVista = Vista['servicios'][number]
type Errores = NonNullable<Problem['errors']>

const TIPOS: readonly Tipo[] = ['pppoe', 'ip_estatica', 'dhcp_fija']
export const ETIQUETA_TIPO_FIXTURE: Record<Tipo, string> = { pppoe: 'PPPoE', ip_estatica: 'IP estática', dhcp_fija: 'DHCP fija' }
const MAXIMO_SERVICIOS_LISTADOS = 50

export function esTipoFixture(valor: unknown): valor is Tipo {
    return typeof valor === 'string' && (TIPOS as readonly string[]).includes(valor)
}

/** Qué cambia y qué le falta a cada servicio no retirado del router si pasa a `tipo` (`analizarServiciosRouter`). */
export function analizarServiciosRouter(routerId: number, tipoActual: Tipo, tipo: Tipo): ServicioVista[] {
    const conRedes = bd.redesIpv4.some(r => r.router_id === routerId)
    return bd.servicios
        .filter(s => s.router_id === routerId && s.estado !== 'retirado')
        .sort((a, b) => a.id - b.id)
        .map((s) => {
            const actual = s.tipo_conexion ?? 'pppoe'
            const cambia = actual !== tipo
            const faltan: ServicioVista['faltan'] = []
            const seCompleta: ServicioVista['se_completa'] = []
            const mensajes: string[] = []
            if (cambia) {
                if (tipo === 'pppoe') {
                    seCompleta.push('credenciales')
                    if (s.amarre_ip_mac) {
                        seCompleta.push('amarre_ip_mac')
                    }
                }
                else {
                    if (bd.planes.find(p => p.id === s.plan_id)?.dual_stack === 'v6') {
                        faltan.push('plan')
                        mensajes.push('Su plan es solo IPv6 y un servicio sin PPPoE necesita IPv4: cámbiale el plan')
                    }
                    if (!s.ipv4) {
                        if (conRedes) {
                            seCompleta.push('ipv4')
                        }
                        else {
                            faltan.push('ipv4')
                            mensajes.push('No tiene IPv4 y el router no tiene redes IPv4 de las que asignarle una: agrega una red al router')
                        }
                    }
                    if (s.ipv6_modo === 'radius_servicio' || s.ipv6_modo === 'radius_pool') {
                        seCompleta.push('ipv6_modo')
                    }
                    if (tipo === 'dhcp_fija' && !s.mac) {
                        faltan.push('mac')
                        mensajes.push('DHCP fija necesita la MAC del equipo: complétala en el servicio')
                    }
                }
            }
            return {
                servicio_id: s.id,
                cliente_id: s.cliente_id,
                cliente_nombre: bd.clientes.find(c => c.id === s.cliente_id)?.nombre ?? s.cliente_nombre ?? '',
                user_ppp: s.user_ppp,
                estado: s.estado,
                tipo_conexion: actual,
                difiere_del_router: actual !== tipoActual,
                cambia,
                faltan,
                se_completa: seCompleta,
                mensajes,
            }
        })
}

function sinCredencialesApi(router: Schema<'Router'>, tipo: Tipo): boolean {
    return tipo === 'pppoe' && router.modo_seguridad === 'api' && !(router.api_usuario && router.tiene_api_password)
}

export function vistaPreviaTipo(router: Schema<'Router'>, tipo?: Tipo): Vista {
    const destino = tipo ?? router.tipo_conexion
    const servicios = analizarServiciosRouter(router.id, router.tipo_conexion, destino)
    const bloqueos: Vista['bloqueos'] = sinCredencialesApi(router, destino) ? [{ codigo: 'pppoe_local_requiere_api', mensaje: MENSAJE_API_PPPOE_LOCAL }] : []
    const cambian = servicios.filter(s => s.cambia)
    const conFaltantes = cambian.filter(s => s.faltan.length > 0).length
    return {
        router_id: router.id,
        router_version: router.version,
        tipo_actual: router.tipo_conexion,
        tipo: destino,
        aplicable: bloqueos.length === 0 && conFaltantes === 0,
        bloqueos,
        resumen: { servicios: servicios.length, cambian: cambian.length, con_faltantes: conFaltantes, difieren_del_router: servicios.filter(s => s.difiere_del_router).length },
        servicios,
    }
}

/** 422 `tipo_conexion_con_servicios` de `PUT /routers/:id` si algún servicio cambiaría (`exigirTipoSinServicios`). */
export function tipoConServicios(router: Schema<'Router'>, tipo: Tipo): RespuestaFixture | null {
    const cambian = analizarServiciosRouter(router.id, router.tipo_conexion, tipo).filter(s => s.cambia)
    if (!cambian.length) {
        return null
    }
    const total = cambian.length
    return problemaTipado(
        422,
        'tipo_conexion_con_servicios',
        'Regla de negocio',
        `El router tiene ${total} ${total === 1 ? 'servicio' : 'servicios'} que no ${total === 1 ? 'es' : 'son'} ${ETIQUETA_TIPO_FIXTURE[tipo]}. `
        + 'Para cambiar el tipo del router con servicios usa «Cambiar tipo de conexión» (POST /routers/:id/cambiar-tipo-conexion): '
        + 'muestra qué cambia y qué les falta, y los pasa uno por uno',
        cambian.slice(0, MAXIMO_SERVICIOS_LISTADOS).map(s => ({
            field: `servicios.${s.servicio_id}`,
            rule: 'tipo_conexion_con_servicios',
            message: `Servicio ${s.servicio_id} (${s.cliente_nombre}, ${ETIQUETA_TIPO_FIXTURE[s.tipo_conexion]})`,
        })),
    )
}

/** La siguiente IPv4 libre de las redes del router (sin red, broadcast ni gateway), como `asignarIpv4`. */
function ipv4Libre(routerId: number): string | null {
    const usadas = new Set(bd.servicios.map(s => s.ipv4).filter(Boolean))
    for (const red of bd.redesIpv4.filter(r => r.router_id === routerId)) {
        const [base = '', prefijo = '32'] = red.cidr.split('/')
        const inicio = ipv4ANumero(base) ?? 0
        const tamano = 2 ** (32 - Number(prefijo))
        for (let n = inicio + 2; n < inicio + tamano - 1; n++) {
            const ip = [24, 16, 8, 0].map(d => (n >>> d) & 255).join('.')
            if (ip !== red.gateway && !usadas.has(ip) && ipEnCidr(ip, red.cidr)) {
                return ip
            }
        }
    }
    return null
}

/** El servicio pasado a `tipo` como lo deja `EditarServicio` anidada. */
function pasarServicio(servicio: Schema<'Servicio'>, tipo: Tipo): Schema<'Servicio'> {
    const pppoe = tipo === 'pppoe'
    if (pppoe) {
        bd.clavesPpp[servicio.id] = claveGenerada(servicio.id)
    }
    else {
        bd.clavesPpp = Object.fromEntries(Object.entries(bd.clavesPpp).filter(([id]) => Number(id) !== servicio.id))
    }
    const radius = servicio.ipv6_modo === 'radius_servicio' || servicio.ipv6_modo === 'radius_pool'
    return {
        ...servicio,
        tipo_conexion: tipo,
        user_ppp: pppoe ? (servicio.user_ppp ?? `cliente${servicio.cliente_id}.${servicio.id}`) : null,
        amarre_ip_mac: pppoe ? false : (servicio.amarre_ip_mac ?? false),
        ipv4: servicio.ipv4 ?? (pppoe ? null : ipv4Libre(servicio.router_id)),
        ipv6_modo: !pppoe && radius ? 'ninguno' : servicio.ipv6_modo,
        prefijo_enlace_v6: !pppoe && radius ? null : servicio.prefijo_enlace_v6,
        prefijo_delegado_v6: !pppoe && radius ? null : servicio.prefijo_delegado_v6,
        servidor_pppoe_id: pppoe ? (servicio.servidor_pppoe_id ?? null) : null,
        local_address: pppoe ? (servicio.local_address ?? null) : null,
        local_address_derivado: pppoe ? (servicio.local_address_derivado ?? false) : false,
        version: servicio.version + 1,
        updated_at: ahora(),
    }
}

export const rutasTipoConexion: RutasFixture = {
    'GET /api/v1/routers/:id/vista-previa-tipo-conexion': conPermiso('routers.ver', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const tipo = solicitud.query.get('tipo')
        if (tipo !== null && !esTipoFixture(tipo)) {
            return datosInvalidos([{ field: 'tipo', message: 'El valor de tipo no es válido', rule: 'enum' }])
        }
        return { status: 200, cuerpo: vistaPreviaTipo(router, tipo ?? undefined) }
    }),

    'POST /api/v1/routers/:id/cambiar-tipo-conexion': conPermiso('routers.cambiar_tipo_conexion', conIdempotencia((solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        if (!esTipoFixture(cuerpo.tipo_conexion)) {
            errores.push({ field: 'tipo_conexion', message: 'El tipo de conexión debe ser pppoe, ip_estatica o dhcp_fija', rule: 'enum' })
        }
        if (cuerpo.motivo !== undefined && (typeof cuerpo.motivo !== 'string' || cuerpo.motivo.trim().length < 3 || cuerpo.motivo.trim().length > 500)) {
            errores.push({ field: 'motivo', message: 'El motivo debe tener de 3 a 500 caracteres', rule: 'minLength' })
        }
        if (errores.length || !esTipoFixture(cuerpo.tipo_conexion)) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const tipo = cuerpo.tipo_conexion
        if (!router.activo) {
            return problemaTipado(422, 'router_inactivo', 'Regla de negocio', 'El router está desactivado')
        }
        if (sinCredencialesApi(router, tipo)) {
            return problemaTipado(422, 'pppoe_local_requiere_api', 'Regla de negocio', MENSAJE_API_PPPOE_LOCAL, [
                { field: 'tipo_conexion', rule: 'pppoe_local_requiere_api', message: MENSAJE_API_PPPOE_LOCAL },
            ])
        }
        const cambian = analizarServiciosRouter(router.id, router.tipo_conexion, tipo).filter(s => s.cambia)
        const incompletos = cambian.filter(s => s.faltan.length > 0)
        if (incompletos.length) {
            return problemaTipado(
                422,
                'tipo_conexion_servicios_incompletos',
                'Regla de negocio',
                `${incompletos.length} ${incompletos.length === 1 ? 'servicio quedaría' : 'servicios quedarían'} sin lo que ${ETIQUETA_TIPO_FIXTURE[tipo]} necesita. Complétalos (ver la vista previa) y vuelve a intentar`,
                incompletos.flatMap(s => s.faltan.map((falta, i) => ({
                    field: `servicios.${s.servicio_id}.${falta}`,
                    rule: 'tipo_conexion_servicios_incompletos',
                    message: `Servicio ${s.servicio_id} (${s.cliente_nombre}): ${s.mensajes[i] ?? ''}`,
                }))).slice(0, MAXIMO_SERVICIOS_LISTADOS),
            )
        }
        const de = router.tipo_conexion
        if (de !== tipo) {
            Object.assign(router, { tipo_conexion: tipo, version: router.version + 1, updated_at: ahora() })
        }
        for (const s of cambian) {
            const indice = bd.servicios.findIndex(x => x.id === s.servicio_id)
            const servicio = bd.servicios[indice]
            if (servicio) {
                bd.servicios[indice] = pasarServicio(servicio, tipo)
                registrarAccion(solicitud, 'servicios.editar', { tipo: 'servicio', id: servicio.id }, { tipo_conexion: tipo })
            }
        }
        registrarAccion(solicitud, 'routers.cambiar_tipo_conexion', { tipo: 'router', id: router.id }, cuerpo)
        const resultado: Schema<'ResultadoCambiarTipoConexion'> = { router: conCorteTunel(router), de, a: tipo, servicios: cambian.map(s => s.servicio_id) }
        return { status: 200, cuerpo: resultado }
    })),
}
