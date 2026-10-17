import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace emergencia:secrets-ppp <router_id> --salida=<archivo.rsc>` (`pnpm emergencia:secrets-ppp`
 * desde la raíz): exporta los servicios PPPoE de un router como `/ppp secret` locales para cuando
 * `aaa` no responde. Uso en `docs/runbooks/aaa-caido.md`, paso 3; lógica en
 * `app/operacion/secrets_emergencia.ts`.
 *
 * Las contraseñas van **solo** al archivo (permisos 0600, no pisa uno existente salvo
 * `--sobrescribir`): el comando nunca las imprime ni las manda al log; en pantalla solo el resumen.
 */
export default class EmergenciaSecretsPpp extends BaseCommand {
    static commandName = 'emergencia:secrets-ppp'
    static description =
        'Exporta los servicios PPPoE de un router a un .rsc de /ppp secret de emergencia (cuando aaa no responde)'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({ description: 'id del router (network.routers.id)' })
    declare routerId: string

    @flags.string({ description: 'Archivo .rsc a escribir (permisos 0600)', required: true })
    declare salida: string

    @flags.string({
        description: 'Perfil del que copiar los de emergencia si el plan no tiene uno',
        default: 'default',
    })
    declare perfilBase: string

    @flags.string({ description: 'Perfil de corte del router para los suspendidos', default: 'suspendido' })
    declare perfilSuspendido: string

    @flags.boolean({ description: 'No exportar los servicios suspendidos', default: false })
    declare sinSuspendidos: boolean

    @flags.boolean({ description: 'Reemplazar el archivo si ya existe', default: false })
    declare sobrescribir: boolean

    async run() {
        const id = Number(this.routerId)
        if (!Number.isInteger(id) || id <= 0) {
            this.logger.error('router_id debe ser un entero positivo')
            this.exitCode = 2
            return
        }
        const { default: ExportarSecretsEmergencia } =
            await import('#operacion/actions/exportar_secrets_emergencia')
        const { contextoSistema } = await import('#shared/contexto')

        let salida
        try {
            salida = await new ExportarSecretsEmergencia().execute(
                {
                    router_id: id,
                    perfil_base: this.perfilBase,
                    perfil_suspendido: this.perfilSuspendido,
                    incluir_suspendidos: !this.sinSuspendidos,
                },
                contextoSistema('consola'),
            )
        } catch (error) {
            this.logger.error((error as Error).message)
            this.exitCode = 1
            return
        }

        const base = process.env.INIT_CWD ?? process.cwd()
        const archivo = resolve(base, this.salida)
        try {
            await writeFile(archivo, salida.rsc, { mode: 0o600, flag: this.sobrescribir ? 'w' : 'wx' })
        } catch (error) {
            const codigo = (error as NodeJS.ErrnoException).code
            this.logger.error(
                codigo === 'EEXIST'
                    ? `${archivo} ya existe; usa --sobrescribir o borra el anterior`
                    : `No se pudo escribir ${archivo} (${codigo ?? 'error'})`,
            )
            this.exitCode = 1
            return
        }

        const r = salida.resumen
        const estados = Object.entries(r.por_estado)
            .map(([estado, n]) => `${estado} ${n}`)
            .join(', ')
        this.logger.success(
            `Router ${r.router_id} ${r.router}: ${r.servicios} secrets (${estados || 'ninguno'}), ${r.perfiles.length} perfiles → ${archivo}`,
        )
        for (const o of r.omitidos) {
            this.logger.warning(`Omitido servicio ${o.servicio_id} (${o.user_ppp}): ${o.motivo}`)
        }
        this.logger.info('El archivo tiene contraseñas en claro: bórralo cuando ya no haga falta.')
    }
}
