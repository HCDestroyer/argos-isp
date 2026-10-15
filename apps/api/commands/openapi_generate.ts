import { readFile, writeFile } from 'node:fs/promises'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace openapi:generate`: escribe `packages/contracts/openapi.json` desde el registro de rutas.
 * Luego `pnpm --filter @argosisp/contracts build` regenera los tipos (o `pnpm contracts:build`).
 */
export default class OpenapiGenerate extends BaseCommand {
    static commandName = 'openapi:generate'
    static description = 'Genera el OpenAPI 3.1 en packages/contracts/openapi.json'

    static options: CommandOptions = {
        startApp: true,
    }

    @flags.string({ description: 'Ruta de salida', default: '../../packages/contracts/openapi.json' })
    declare salida: string

    @flags.boolean({ description: 'No escribe; falla si el archivo actual difiere' })
    declare verificar: boolean

    async run() {
        const { construirOpenApi } = await import('#shared/openapi/documento')
        const contenido = await construirOpenApi()
        const destino = this.app.makePath(this.salida)

        if (this.verificar) {
            const actual = await readFile(destino, 'utf8').catch(() => '')
            if (actual !== contenido) {
                this.logger.error(`${this.salida} está desactualizado; corre pnpm contracts:build`)
                this.exitCode = 1
                return
            }
            this.logger.success(`${this.salida} está al día`)
            return
        }

        await writeFile(destino, contenido, 'utf8')
        this.logger.success(`OpenAPI escrito en ${this.salida}`)
    }
}
