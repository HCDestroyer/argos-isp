import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    auditableRouter,
    avisarRadius,
    CAMPOS_RADIUS_EDICION,
    columnasRouter,
    exigirCaValida,
    exigirNasIpSiRadius,
    exigirZona,
    type DatosRouter,
} from '#network/actions/crear_router'
import { exigirSinPppoe } from '#network/modo_seguridad'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import { exigirEmpresaActiva } from '#core/empresas'
import { extremoApi, exigirRouterUnico } from '#network/routers_duplicados'
import type { CampoCatalogoCambiado } from '#shared/eventos'

export interface EntradaEditarRouter extends DatosRouter {
    id: number
    version: number
    /** borra la clave de la API (en la edición, `api_password` vacía o null no cambia nada) */
    quitar_api_password?: boolean
    /** borra el secreto RADIUS (en la edición, `radius_secret` vacío o null no cambia nada) */
    quitar_radius_secret?: boolean
}

/**
 * Un router con túnel registrado que se desactiva sale de los peers (`router.conexion_eliminada`);
 * al reactivarlo vuelve (`router.conexion_registrada`). El `wireguard-agente` relee la lista.
 */
async function avisarTunel(t: Transaccion, router: RouterVista) {
    const conexion = (await t.trx
        .from('network.routers_conexion')
        .where('router_id', router.id)
        .whereNotNull('public_key')
        .select(t.trx.knexRawQuery('host(ip_tunel) AS ip_tunel'))
        .first()) as { ip_tunel: string } | null
    if (!conexion) return
    if (router.activo) {
        await t.emit('router.conexion_registrada', {
            router_id: router.id,
            empresa_id: router.empresa_sugerida_id,
            ip_tunel: conexion.ip_tunel,
        })
    } else {
        await t.emit('router.conexion_eliminada', {
            router_id: router.id,
            empresa_id: router.empresa_sugerida_id,
        })
    }
}

/**
 * Credenciales en la edición (pedido del PM, 28 oct): el panel deja el campo vacío para "no
 * cambiar" (el bodyparser convierte `""` en null), así que null tampoco cambia nada. Quitar una
 * credencial es explícito, con `quitar_*`; pedir las dos cosas a la vez es 422.
 */
function credencialesEditadas(input: EntradaEditarRouter): EntradaEditarRouter {
    const { quitar_api_password: quitarApi, quitar_radius_secret: quitarRadius, ...datos } = input
    const errores = []
    for (const [campo, quitar] of [
        ['api_password', quitarApi],
        ['radius_secret', quitarRadius],
    ] as const) {
        const valor = datos[campo]
        if (quitar && valor) {
            errores.push({
                field: campo,
                rule: 'quitar',
                message: `Manda ${campo} o quitar_${campo}, no los dos: no se puede cambiar y quitar a la vez`,
            })
        }
        if (quitar) datos[campo] = null
        else if (!valor) delete datos[campo]
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return datos
}

/**
 * 409 `router_duplicado` (`contratos/routers.md`) solo por lo que la edición cambia: el extremo de
 * la API, la `nas_ip`, o reactivar un router (entonces se revisa todo, también el serial). Así un
 * duplicado que ya existía se puede seguir editando hasta unirlo (`routers.unir`).
 */
async function exigirSinDuplicado(t: Transaccion, antes: RouterVista, datos: DatosRouter) {
    const despues = {
        id: antes.id,
        host: datos.host ?? antes.host,
        api_url: datos.api_url !== undefined ? datos.api_url : antes.api_url,
        nas_ip: datos.nas_ip !== undefined ? datos.nas_ip : antes.nas_ip,
        serial: antes.serial,
    }
    const activo = datos.activo ?? antes.activo
    const reactiva = activo && !antes.activo
    if (reactiva && antes.unido_a_id !== null) {
        throw new ReglaNegocio(
            `El router está unido al router ${antes.unido_a_id}: es el mismo equipo y no se reactiva`,
            'router_unido',
        )
    }
    await exigirRouterUnico(t.trx, despues, {
        api: activo && (reactiva || extremoApi(despues) !== extremoApi(antes)),
        nas_ip: despues.nas_ip !== antes.nas_ip,
        serial: reactiva,
    })
}

/**
 * Modo de seguridad (`app/network/modo_seguridad.ts`): un router que queda en `radius` necesita su
 * `nas_ip` (422 en `nas_ip`); pasar a `api` con servicios `pppoe` no retirados es 422
 * `servicios_pppoe_en_router` con la lista. La fila se toma con `FOR UPDATE` antes de revisar los
 * servicios: un alta de PPPoE simultánea (que la lee con `FOR SHARE`) espera o ya está contada.
 */
async function exigirModoSeguridad(t: Transaccion, antes: RouterVista, datos: DatosRouter) {
    const modo = datos.modo_seguridad ?? antes.modo_seguridad
    exigirNasIpSiRadius(modo, datos.nas_ip !== undefined ? datos.nas_ip : antes.nas_ip)
    if (modo === 'api' && antes.modo_seguridad !== 'api') await exigirSinPppoe(t.trx, antes.id)
}

/**
 * Edita un router (control optimista por `version`). Cambiar una credencial se audita como
 * campo cambiado con valor `***`, nunca en claro. Cambiar la capacidad del enlace emite
 * `router.control_cambiado` con `campos: ['capacidad']` (A2 recalcula el padre global). El
 * control de velocidad no se edita aquí: `CambiarControlVelocidad` (`routers.cambiar_control_velocidad`).
 * Renombrarlo, desactivarlo o reactivarlo, o cambiar sus coordenadas emite `catalogo.cambiado`
 * (`catalogo: 'router'`, `campos` con `nombre`, `activo` y/o `coordenadas`; contrato Iris 0.5.0,
 * pedido A15). También cuando `routers.unir` desactiva el absorbido (pasa por aquí).
 */
export default class EditarRouter extends DomainAction<EntradaEditarRouter, RouterVista> {
    readonly nombre = 'routers.editar'

    protected async handle(input: EntradaEditarRouter, t: Transaccion): Promise<RouterVista> {
        const { id, version, ...datos } = credencialesEditadas(input)
        t.fijarEntidad('router', id)
        await t.trx.from('network.routers').where('id', id).forUpdate().select('id')
        const antes = await verRouter(id, t.trx)
        if (datos.empresa_sugerida_id && datos.empresa_sugerida_id !== antes.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, datos.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        if (datos.zona_id !== antes.zona_id) await exigirZona(t.trx, datos.zona_id)
        exigirCaValida(datos.api_ca)
        await exigirModoSeguridad(t, antes, datos)
        await exigirSinDuplicado(t, antes, datos)
        await actualizarConVersion(t.trx, 'network.routers', id, version, columnasRouter(datos))
        const despues = await verRouter(id, t.trx)

        const a = auditableRouter(antes)
        const d = auditableRouter(despues)
        // Una credencial reemplazada por otra también es un cambio, aunque ambas estén "definidas".
        if (datos.api_password && a.api_password) a.api_password = 'anterior'
        if (datos.radius_secret && a.radius_secret) a.radius_secret = 'anterior'
        if (typeof datos.api_ca === 'string' && a.api_ca) a.api_ca = 'anterior'
        const cambiados = await t.registrarCambios({ tipo: 'router', id }, a, d)
        await avisarRadius(t, despues, cambiados, CAMPOS_RADIUS_EDICION)
        if (antes.activo !== despues.activo) await avisarTunel(t, despues)
        if (
            antes.capacidad_bajada_kbps !== despues.capacidad_bajada_kbps ||
            antes.capacidad_subida_kbps !== despues.capacidad_subida_kbps
        ) {
            await t.emit('router.control_cambiado', {
                router_id: id,
                de: despues.control_velocidad,
                a: despues.control_velocidad,
                capacidad_bajada_kbps: despues.capacidad_bajada_kbps,
                capacidad_subida_kbps: despues.capacidad_subida_kbps,
                campos: ['capacidad'],
                motivo: null,
            })
        }
        const camposCatalogo: CampoCatalogoCambiado[] = []
        if (despues.nombre !== antes.nombre) camposCatalogo.push('nombre')
        if (despues.activo !== antes.activo) camposCatalogo.push('activo')
        if (despues.coordenadas !== antes.coordenadas) camposCatalogo.push('coordenadas')
        if (camposCatalogo.length > 0) {
            await t.emit('catalogo.cambiado', {
                catalogo: 'router',
                id,
                empresa_id: despues.empresa_sugerida_id === null ? null : Number(despues.empresa_sugerida_id),
                campos: camposCatalogo,
            })
        }
        return despues
    }
}
