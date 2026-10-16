import { writeFile } from 'node:fs/promises'
import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace aaa:verificar-router <router_id>`: lista previa a migrar un router al nuevo RADIUS
 * (semana 3). Verifica registros `aaa:user:*`, secreto RADIUS, planes con perfil y `user_ppp`
 * duplicados, e imprime un informe en Markdown. Sale con 1 si algo impide migrar.
 * Lógica en `app/network/sesiones/verificacion_migracion.ts`; uso en `services/aaa/RUNBOOK.md`.
 */
export default class AaaVerificarRouter extends BaseCommand {
    static commandName = 'aaa:verificar-router'
    static description =
        'Verifica que un router está listo para autenticar contra el nuevo aaa (informe Markdown)'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({ description: 'id del router (network.routers.id)' })
    declare routerId: string

    @flags.string({ description: 'Escribe el informe en este archivo además de imprimirlo' })
    declare salida?: string

    async run() {
        const id = Number(this.routerId)
        if (!Number.isInteger(id) || id <= 0) {
            this.logger.error('router_id debe ser un entero positivo')
            this.exitCode = 2
            return
        }
        const { verificarMigracionRouter, informeMarkdown } =
            await import('#network/sesiones/verificacion_migracion')
        const informe = await verificarMigracionRouter(id)
        const markdown = informeMarkdown(informe)
        if (this.salida) await writeFile(this.salida, markdown)
        process.stdout.write(markdown)
        this.exitCode = informe.listo ? 0 : 1
    }
}
