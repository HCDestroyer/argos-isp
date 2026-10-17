import { resolve } from 'node:path'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `pnpm importar:plantillas <directorio>` o `node ace importar:plantillas <directorio>`: deja las
 * plantillas CSV del origen `csv` (una por entidad, con encabezado y una fila de ejemplo) y un
 * `LEEME.md` con cada columna. No toca la base.
 */
export default class ImportarPlantillas extends BaseCommand {
    static commandName = 'importar:plantillas'
    static description = 'Genera las plantillas CSV vacías del importador (origen csv) con su LEEME'

    static options: CommandOptions = {
        startApp: false,
    }

    @args.string({ description: 'Directorio donde dejar las plantillas (se crea si no existe)' })
    declare directorio: string

    @flags.boolean({ description: 'Sobrescribir plantillas que ya existan', default: false })
    declare sobrescribir: boolean

    async run() {
        const { generarPlantillas } = await import('#importacion/origenes/csv')
        const base = process.env.INIT_CWD ?? process.cwd()
        const dir = resolve(base, this.directorio)
        try {
            const escritos = await generarPlantillas(dir, this.sobrescribir)
            this.logger.success(`${escritos.length} archivos en ${dir}`)
            for (const archivo of escritos) this.logger.log(`  ${archivo}`)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                this.logger.error(`Ya hay plantillas en ${dir}; usa --sobrescribir para reemplazarlas`)
                this.exitCode = 1
                return
            }
            throw error
        }
    }
}
