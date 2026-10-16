import { mkdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `pnpm importar --dry-run <origen>` (desde la raíz) o `node ace importar:mikrowisp`:
 * importa desde Mikrowisp. `<origen>` es un volcado SQL de su base (`.sql`, ver
 * `app/importacion/mikrowisp_sql.ts`) o un directorio con un CSV por entidad (ver
 * `app/importacion/README.md`). En seco no guarda nada y produce el reporte de diferencias
 * (texto en pantalla; con `--salida`, también Markdown, CSV y JSON). Lógica en `app/importacion`.
 */
export default class ImportarMikrowisp extends BaseCommand {
    static commandName = 'importar:mikrowisp'
    static description =
        'Importa clientes, routers, planes, servicios, facturas pendientes y saldos desde un export de Mikrowisp'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({
        description:
            'Volcado SQL de la base de Mikrowisp (.sql) o directorio con routers.csv, planes.csv, clientes.csv y servicios.csv (y opcionales redes.csv, facturas.csv, saldos.csv y pagos.csv)',
    })
    declare directorio: string

    @flags.string({
        description:
            'Directorio donde guardar reporte.md, diferencias.csv y reporte.json (se crea si no existe)',
    })
    declare salida?: string

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

    @flags.number({
        description: 'Plantilla de facturación de los servicios nuevos (por defecto la única que exista)',
    })
    declare plantilla?: number

    async run() {
        const { leerDirectorio } = await import('#importacion/fuente')
        const { leerDumpMikrowisp } = await import('#importacion/mikrowisp_sql')
        const { reporteCsv, reporteMarkdown } = await import('#importacion/reporte_salidas')
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

        const info = await stat(directorio)
        const esDirectorio = info.isDirectory()
        const fuente = esDirectorio ? await leerDirectorio(directorio) : await leerDumpMikrowisp(directorio)
        const reporte = await importarMikrowisp(fuente, {
            dryRun: this.dryRun,
            ipv6: this.ipv6,
            soloPlanesExistentes: this.soloPlanesExistentes,
            plantillaId: this.plantilla,
            directorio,
        })
        this.logger.log(formatearReporte(reporte))
        if (this.reporte) {
            const archivo = resolve(base, this.reporte)
            await writeFile(archivo, JSON.stringify(reporte, null, 2) + '\n')
            this.logger.info(`Reporte JSON en ${archivo}`)
        }
        if (this.salida) {
            const dir = resolve(base, this.salida)
            await mkdir(dir, { recursive: true })
            await writeFile(resolve(dir, 'reporte.md'), reporteMarkdown(reporte))
            await writeFile(resolve(dir, 'diferencias.csv'), reporteCsv(reporte))
            await writeFile(resolve(dir, 'reporte.json'), JSON.stringify(reporte, null, 2) + '\n')
            this.logger.info(`Reporte en ${dir}: reporte.md, diferencias.csv y reporte.json`)
        }
    }
}
