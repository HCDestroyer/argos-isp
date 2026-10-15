import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `pnpm importar --dry-run <directorio>` (desde la raíz) o `node ace importar:mikrowisp`:
 * importa desde un export de Mikrowisp (CSV, ver `app/importacion/README.md`). En seco no guarda
 * nada y produce el reporte de diferencias. Lógica en `app/importacion`.
 */
export default class ImportarMikrowisp extends BaseCommand {
    static commandName = 'importar:mikrowisp'
    static description = 'Importa clientes, routers, planes y servicios desde un export de Mikrowisp'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({
        description: 'Directorio con routers.csv, redes.csv, planes.csv, clientes.csv y servicios.csv',
    })
    declare directorio: string

    @flags.boolean({ description: 'En seco: todo en una transacción que se revierte', default: false })
    declare dryRun: boolean

    @flags.string({ description: 'Guardar el reporte completo en JSON en este archivo' })
    declare reporte?: string

    @flags.string({
        description: 'Modo IPv6 de los servicios: ninguno (por defecto) o plan',
        default: 'ninguno',
    })
    declare ipv6: string

    @flags.boolean({ description: 'No crear planes: solo mapear a planes que ya existen', default: false })
    declare soloPlanesExistentes: boolean

    async run() {
        const { leerDirectorio } = await import('#importacion/fuente')
        const { importarMikrowisp } = await import('#importacion/importador')
        const { formatearReporte } = await import('#importacion/reporte')

        if (this.ipv6 !== 'ninguno' && this.ipv6 !== 'plan') {
            this.logger.error('--ipv6 debe ser ninguno o plan')
            this.exitCode = 1
            return
        }
        // pnpm corre el script en apps/api: las rutas relativas son respecto de donde se llamó.
        const base = process.env.INIT_CWD ?? process.cwd()
        const directorio = resolve(base, this.directorio)

        const fuente = await leerDirectorio(directorio)
        const reporte = await importarMikrowisp(fuente, {
            dryRun: this.dryRun,
            ipv6: this.ipv6,
            soloPlanesExistentes: this.soloPlanesExistentes,
            directorio,
        })
        this.logger.log(formatearReporte(reporte))
        if (this.reporte) {
            const archivo = resolve(base, this.reporte)
            await writeFile(archivo, JSON.stringify(reporte, null, 2) + '\n')
            this.logger.info(`Reporte JSON en ${archivo}`)
        }
    }
}
