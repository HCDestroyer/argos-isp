import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    servidorParaAuditoria,
    verServidorPppoe,
    type EstadoRedAcceso,
    type ServidorPppoeVista,
} from '#network/red_acceso/consultas'
import {
    campo,
    emitirRedAcceso,
    exigirEmpresa,
    exigirPoolIpv6,
    exigirRedConGateway,
    exigirRouter,
    exigirUnico,
} from '#network/red_acceso/reglas'

export const AUTENTICACIONES_PPPOE = ['pap', 'chap', 'mschap1', 'mschap2'] as const
export type AutenticacionPppoe = (typeof AUTENTICACIONES_PPPOE)[number]

/** Lo que se puede indicar de un servidor PPPoE (alta y edición). */
export interface DatosServidorPppoe {
    nombre?: string
    vlan_id?: number | null
    interfaz?: string
    service_name?: string
    red_ipv4_id?: number | null
    ipv6_pool_enlace_id?: number | null
    ipv6_pool_delegacion_id?: number | null
    perfil_base?: string
    max_mtu?: number
    max_mru?: number
    mrru?: number | null
    autenticacion?: AutenticacionPppoe[]
    keepalive_timeout?: number
    una_sesion_por_host?: boolean
    max_sesiones?: number | null
    empresa_id?: number | null
    descripcion?: string | null
    activo?: boolean
}

export interface EntradaCrearServidorPppoe extends DatosServidorPppoe {
    router_id: number
    nombre: string
}

/**
 * Valida un servidor PPPoE completo (`contratos/red-acceso.md` §1 y §2) y devuelve su `interfaz`:
 * con VLAN, el nombre de la VLAN (del mismo router); sin VLAN, la interfaz indicada. Un servidor por
 * interfaz y por VLAN (409), nombre único en el router (409), red del router con gateway (422) y
 * obligatoria en lo administrado, pools IPv6 del router y del tipo correcto.
 */
export async function validarServidorPppoe(
    trx: TransactionClientContract,
    routerId: number,
    estado: EstadoRedAcceso,
    datos: DatosServidorPppoe & { nombre: string },
    exceptoId?: number,
): Promise<string> {
    let interfaz = datos.interfaz
    if (datos.vlan_id) {
        const vlan = (await trx
            .from('network.vlans')
            .where('id', datos.vlan_id)
            .select('router_id', 'nombre')
            .first()) as {
            router_id: number
            nombre: string
        } | null
        if (!vlan || Number(vlan.router_id) !== routerId) {
            throw campo('vlan_id', vlan ? 'La VLAN no es de este router' : 'La VLAN no existe', 'vlan')
        }
        if (interfaz && interfaz.toLowerCase() !== vlan.nombre.toLowerCase()) {
            throw campo(
                'interfaz',
                `Con VLAN, la interfaz del servidor es la de la VLAN («${vlan.nombre}»)`,
                'interfaz_vlan',
            )
        }
        interfaz = vlan.nombre
        await exigirUnico(
            trx,
            'network.servidores_pppoe',
            (q) => q.where('vlan_id', datos.vlan_id),
            'vlan_con_servidor',
            `La VLAN «${vlan.nombre}» ya tiene un servidor PPPoE (uno por VLAN)`,
            exceptoId,
        )
    }
    if (!interfaz) {
        throw campo('interfaz', 'Indica la VLAN o la interfaz donde escucha el servidor PPPoE', 'required')
    }
    await exigirUnico(
        trx,
        'network.servidores_pppoe',
        (q) => q.where('router_id', routerId).whereRaw('lower(interfaz) = lower(?)', [interfaz]),
        'interfaz_con_servidor',
        `La interfaz «${interfaz}» ya tiene un servidor PPPoE (uno por interfaz o VLAN)`,
        exceptoId,
    )
    await exigirUnico(
        trx,
        'network.servidores_pppoe',
        (q) => q.where('router_id', routerId).whereRaw('lower(nombre) = lower(?)', [datos.nombre]),
        'servidor_duplicado',
        `El router ya tiene un servidor PPPoE «${datos.nombre}»`,
        exceptoId,
    )
    if (datos.red_ipv4_id) {
        await exigirRedConGateway(trx, datos.red_ipv4_id, routerId)
    } else if (estado === 'administrado') {
        throw campo(
            'red_ipv4_id',
            'Un servidor PPPoE administrado necesita su red IPv4: de su gateway sale el local-address',
            'red_requerida',
        )
    }
    if (datos.ipv6_pool_enlace_id) {
        await exigirPoolIpv6(trx, datos.ipv6_pool_enlace_id, routerId, 'enlace', 'ipv6_pool_enlace_id')
    }
    if (datos.ipv6_pool_delegacion_id) {
        await exigirPoolIpv6(
            trx,
            datos.ipv6_pool_delegacion_id,
            routerId,
            'delegacion',
            'ipv6_pool_delegacion_id',
        )
    }
    if (
        datos.max_mru !== undefined &&
        datos.mrru !== undefined &&
        datos.mrru !== null &&
        datos.mrru < datos.max_mru
    ) {
        throw campo('mrru', 'El MRRU no puede ser menor que el max-mru', 'mrru')
    }
    return interfaz
}

/** Columnas de la tabla a partir de los datos (sin `undefined`). */
export function columnasServidor(datos: DatosServidorPppoe): Record<string, unknown> {
    const columnas: Record<string, unknown> = Object.fromEntries(
        Object.entries(datos).filter(([, v]) => v !== undefined),
    )
    if (datos.autenticacion) columnas.autenticacion = datos.autenticacion
    return columnas
}

/**
 * Crea un servidor PPPoE **administrado** en un router. A2 lo escribe en RouterOS (servidor con
 * `comment = argosisp:pppoe:<id>` y su perfil `argosisp-pppoe-<id>` con `local-address` = gateway de
 * la red) al recibir `red_acceso.cambiada`.
 */
export default class CrearServidorPppoe extends DomainAction<EntradaCrearServidorPppoe, ServidorPppoeVista> {
    readonly nombre = 'servidores_pppoe.crear'

    protected async handle(input: EntradaCrearServidorPppoe, t: Transaccion): Promise<ServidorPppoeVista> {
        await exigirRouter(t.trx, input.router_id)
        exigirEmpresa(t.ctx, input.empresa_id)
        const { router_id: routerId, ...datos } = input
        const interfaz = await validarServidorPppoe(t.trx, routerId, 'administrado', datos)
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.servidores_pppoe')
            .insert({
                ...columnasServidor(datos),
                router_id: routerId,
                interfaz,
                service_name: datos.service_name ?? datos.nombre,
                estado: 'administrado',
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('servidor_pppoe', id)
        t.fijarEmpresa(input.empresa_id ?? t.ctx.empresaId ?? null)
        const servidor = await verServidorPppoe(id, t.trx)
        await t.registrarCambios({ tipo: 'servidor_pppoe', id }, null, servidorParaAuditoria(servidor))
        await emitirRedAcceso(t, {
            router_id: routerId,
            empresa_id: servidor.empresa_id,
            entidad: 'servidor_pppoe',
            entidad_id: id,
            accion: 'creada',
            estado: 'administrado',
            campos: [],
        })
        return servidor
    }
}
