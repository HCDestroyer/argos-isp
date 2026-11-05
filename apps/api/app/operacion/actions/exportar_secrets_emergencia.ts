import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { descifrar } from '#shared/cifrado'
import { paginaRegistrosAaa, type RegistroAaa } from '#core/aaa'
import { generarRscEmergencia, type ResumenRsc } from '#operacion/secrets_emergencia'
import { leerRedGateway, type RedGateway } from '#network/routeros/local_address'

/**
 * `routers.exportar_secrets_emergencia` (solo consola: `node ace emergencia:secrets-ppp`): arma el
 * `.rsc` de secrets PPPoE de emergencia de un router para cuando `aaa` no responde
 * (`docs/runbooks/aaa-caido.md`). No cambia nada en la base.
 *
 * Se audita siempre, porque saca contraseñas PPPoE en claro: `audit.acciones` guarda quién, cuándo
 * y de qué router (la entrada), nunca el `.rsc` (la auditoría no guarda la salida). La salida
 * lleva el texto para que el comando lo escriba en un archivo 0600; el comando nunca lo imprime.
 */
export interface EntradaSecretsEmergencia {
    router_id: number
    /** perfil del que se copian los de emergencia si el plan no tiene uno (por defecto `default`) */
    perfil_base?: string
    /** perfil de corte del router (por defecto `suspendido`, el de `lab.rsc`) */
    perfil_suspendido?: string
    /** por defecto true */
    incluir_suspendidos?: boolean
}

export interface SalidaSecretsEmergencia {
    rsc: string
    resumen: ResumenRsc
}

/** Registros por página al recorrer los servicios PPPoE (`paginaRegistrosAaa` de A1). */
const PAGINA = 500

export default class ExportarSecretsEmergencia extends DomainAction<
    EntradaSecretsEmergencia,
    SalidaSecretsEmergencia
> {
    readonly nombre = 'routers.exportar_secrets_emergencia'

    protected async handle(
        input: EntradaSecretsEmergencia,
        t: Transaccion,
    ): Promise<SalidaSecretsEmergencia> {
        const router = (await t.trx
            .from('network.routers')
            .where('id', input.router_id)
            .select('id', 'nombre', t.trx.raw('host(nas_ip) AS nas_ip'))
            .first()) as { id: number; nombre: string; nas_ip: string | null } | null
        if (!router) throw new NoEncontrado(`No existe el router ${input.router_id}`)
        t.fijarEntidad('router', router.id)

        // Los mismos registros que entrega aaa (A1), de todos los routers: se filtra aquí.
        const registros: RegistroAaa[] = []
        let cursor: string | null = null
        do {
            const pagina = await paginaRegistrosAaa({ cursor, limit: PAGINA }, t.trx)
            registros.push(...pagina.data.filter((r) => r.router_id === router.id))
            cursor = pagina.nextCursor
        } while (cursor)

        // local-address = gateway de la red (network/routeros/local_address.ts), nunca el de `default`.
        const redes = (await t.trx
            .from('network.redes_ipv4')
            .where('router_id', router.id)
            .select(
                'id',
                'nombre',
                t.trx.raw('cidr::text AS cidr'),
                t.trx.raw('host(gateway) AS gateway'),
            )) as Array<{
            id: number
            nombre: string | null
            cidr: string
            gateway: string | null
        }>
        const porId = new Map<number, RedGateway>()
        const redesPool = new Map<string, RedGateway>()
        for (const f of redes) {
            const red = leerRedGateway({ red_id: f.id, cidr: f.cidr, gateway: f.gateway })
            if (!red) continue
            porId.set(red.red_id, red)
            if (f.nombre && !redesPool.has(f.nombre.toLowerCase())) redesPool.set(f.nombre.toLowerCase(), red)
        }
        const asignaciones = (await t.trx
            .from('network.ipv4_asignaciones as a')
            .join('core.servicios as s', 's.id', 'a.servicio_id')
            .where('s.router_id', router.id)
            .whereNull('a.fin')
            .select('a.servicio_id', 'a.red_id')) as Array<{ servicio_id: number; red_id: number }>
        const redesServicio = new Map<number, RedGateway>()
        for (const a of asignaciones) {
            const red = porId.get(Number(a.red_id))
            if (red) redesServicio.set(Number(a.servicio_id), red)
        }

        return generarRscEmergencia(
            { id: router.id, nombre: router.nombre, nas_ip: router.nas_ip },
            registros,
            (r) => {
                try {
                    return { clave: descifrar(r.pass_ppp) }
                } catch (error) {
                    return { error: (error as Error).message }
                }
            },
            {
                perfilBase: input.perfil_base?.trim() || 'default',
                perfilSuspendido: input.perfil_suspendido?.trim() || 'suspendido',
                incluirSuspendidos: input.incluir_suspendidos ?? true,
                generado: new Date().toISOString(),
                redesServicio,
                redesPool,
            },
        )
    }
}
