import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { enmascarar } from '#shared/enmascarar'
import { verificarVersion } from '#shared/version'
import { ConHistorial } from '#core/eliminacion'
import { routerEliminable } from '#network/eliminacion'

export interface EntradaEliminarRouter {
    id: number
    version: number
}

export interface SalidaEliminarRouter {
    id: number
    eliminado: true
}

/** Tablas que dependen solo del router; se borran con él (en este orden). */
const DEPENDIENTES = [
    'network.planes_routers',
    'network.routers_contacto',
    'network.routers_migracion_aaa',
    // conexión WireGuard (`contratos/conexion-routers.md`); ON DELETE CASCADE, se borra explícita
    'network.routers_conexion',
] as const

/**
 * Elimina un router que nunca se usó (`contratos/eliminar.md`). Con servicios (también retirados),
 * sesiones, historial, asignaciones en sus redes o pools, comandos enviados al equipo, bodegas o
 * alcances de usuarios responde 422 `router_con_historial` con lo que lo impide: ese router se
 * desactiva (`PUT /routers/:id` con `activo: false`).
 *
 * Borra sus redes IPv4, sus bloques y pools IPv6 (sin asignaciones), sus `planes_routers`, su
 * contacto, su migración AAA y su conexión WireGuard. `audit.acciones` guarda la foto
 * (credenciales como `***`). Emite `router.eliminado` (FreeRADIUS regenera clientes) y, si tenía
 * túnel registrado, antes `router.conexion_eliminada` (el agente WireGuard quita el peer).
 */
export default class EliminarRouter extends DomainAction<EntradaEliminarRouter, SalidaEliminarRouter> {
    readonly nombre = 'routers.eliminar'

    protected async handle(input: EntradaEliminarRouter, t: Transaccion): Promise<SalidaEliminarRouter> {
        const id = input.id
        t.fijarEntidad('router', id)
        const fila = (await t.trx
            .from('network.routers')
            .where('id', id)
            .forUpdate()
            .select('*', t.trx.raw('host(nas_ip) AS nas_ip_texto'))
            .first()) as (Record<string, unknown> & { nas_ip_texto: string | null }) | null
        if (!fila) throw new NoEncontrado(`El router ${id} no existe`)
        const empresaId = fila.empresa_sugerida_id === null ? null : Number(fila.empresa_sugerida_id)
        t.fijarEmpresa(empresaId)
        verificarVersion('router', id, Number(fila.version), input.version)

        const { motivos } = await routerEliminable(id, fila.nas_ip_texto, t.trx)
        if (motivos.length > 0) {
            throw new ConHistorial(
                'router_con_historial',
                `El router ${id} tiene historial y no se puede eliminar; desactívalo (activo: false)`,
                motivos,
            )
        }

        const bloques = await t.trx.from('network.ipv6_bloques').where('router_id', id)
        const bloqueIds = bloques.map((b) => Number(b.id))
        const foto: Record<string, unknown> = {
            router: { ...fila, nas_ip_texto: undefined },
            redes_ipv4: await t.trx.from('network.redes_ipv4').where('router_id', id),
            ipv6_bloques: bloques,
            ipv6_pools: bloqueIds.length
                ? await t.trx.from('network.ipv6_pools').whereIn('bloque_id', bloqueIds)
                : [],
        }
        // Con túnel registrado, el `wireguard-agente` y los clientes de FreeRADIUS lo sacan con
        // `router.conexion_eliminada` (lo que ya escuchan al desactivarlo).
        const tunel = await t.trx
            .from('network.routers_conexion')
            .where('router_id', id)
            .whereNotNull('public_key')
            .first()
        const existentes = new Set<string>()
        for (const tabla of DEPENDIENTES) {
            const r = (await t.trx.rawQuery('SELECT to_regclass(?) IS NOT NULL AS existe', [tabla])) as {
                rows: Array<{ existe: boolean }>
            }
            if (!r.rows[0]?.existe) continue
            existentes.add(tabla)
            foto[tabla.replace('network.', '')] = await t.trx.from(tabla).where('router_id', id)
        }
        foto.ids_externos = await t.trx
            .from('core.ids_externos')
            .where({ entidad_tipo: 'router', entidad_id: id })
        t.anotarAuditoria({ foto: enmascarar(foto) as Record<string, unknown> })

        if (bloqueIds.length) await t.trx.from('network.ipv6_pools').whereIn('bloque_id', bloqueIds).delete()
        await t.trx.from('network.ipv6_bloques').where('router_id', id).delete()
        await t.trx.from('network.redes_ipv4').where('router_id', id).delete()
        for (const tabla of DEPENDIENTES) {
            if (existentes.has(tabla)) await t.trx.from(tabla).where('router_id', id).delete()
        }
        await t.trx.from('core.ids_externos').where({ entidad_tipo: 'router', entidad_id: id }).delete()
        await t.trx.from('network.routers').where('id', id).delete()

        const antes: Record<string, unknown> = { ...fila }
        delete antes.nas_ip_texto
        await t.registrarCambios({ tipo: 'router', id }, antes, null)
        if (tunel) await t.emit('router.conexion_eliminada', { router_id: id, empresa_id: empresaId })
        await t.emit('router.eliminado', { router_id: id, empresa_id: empresaId })
        return { id, eliminado: true }
    }
}
