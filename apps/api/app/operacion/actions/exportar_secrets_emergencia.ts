import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { descifrar } from '#shared/cifrado'
import { paginaRegistrosAaa, type RegistroAaa } from '#core/aaa'
import { generarRscEmergencia, type ResumenRsc } from '#operacion/secrets_emergencia'

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
            },
        )
    }
}
