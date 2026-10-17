import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `pnpm importar --origen=<mikrowisp|smartisp|csv> --fuente=<ruta> [--dry-run]` (desde la raíz) o
 * `node ace importar ...`: importa desde otro sistema. El adaptador del origen
 * (`app/importacion/origenes/`) traduce la fuente al formato canónico y el núcleo
 * (`app/importacion/importador.ts`) crea todo por las acciones de dominio. En seco no guarda nada
 * y produce el reporte de diferencias (texto en pantalla; con `--salida`, también Markdown, CSV y
 * JSON). `--empresa=<id|nit>` asigna todo a esa empresa (obligatoria con varias activas) y
 * `--excluir-tablas=radacct,logs` deja esas tablas fuera del archivo del origen. Detalle en `app/importacion/README.md` y `docs/runbooks/importacion.md`.
 */
export default class Importar extends BaseCommand {
    static commandName = 'importar'
    static description =
        'Importa clientes, routers, planes, servicios, facturas, saldos y pagos desde Mikrowisp, SmartISP o CSV'

    static options: CommandOptions = {
        startApp: true,
    }

    @flags.string({
        description:
            'Sistema de origen: mikrowisp (volcado .sql), smartisp (volcado .sql) o csv (directorio con un CSV por entidad)',
        required: true,
    })
    declare origen: string

    @flags.string({ description: 'Archivo (.sql) o directorio (csv) a importar', required: true })
    declare fuente: string

    @flags.string({
        description:
            'Solo con --origen=csv: nombre del sistema que exportó los CSV (clave de idempotencia; por defecto csv). Ej.: --sistema=wisphub',
    })
    declare sistema?: string

    @flags.boolean({ description: 'En seco: todo en una transacción que se revierte', default: false })
    declare dryRun: boolean

    @flags.string({
        description:
            'Directorio donde guardar reporte.md, diferencias.csv y reporte.json (se crea si no existe)',
    })
    declare salida?: string

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

    @flags.string({
        description:
            'Empresa (id o NIT) a la que se asigna todo lo importado. Obligatoria si hay varias empresas activas; con una sola, esa',
    })
    declare empresa?: string

    @flags.string({
        description:
            'Tablas del volcado que no se guardan en el archivo del origen, separadas por coma (p. ej. radacct,logs). Por defecto se archiva todo',
    })
    declare excluirTablas?: string

    async run() {
        const { esOrigen, leerOrigen, ORIGENES } = await import('#importacion/origenes/index')
        const { reporteCsv, reporteMarkdown } = await import('#importacion/reporte_salidas')
        const { importar } = await import('#importacion/importador')
        const { formatearReporte } = await import('#importacion/reporte')

        if (!esOrigen(this.origen)) {
            this.logger.error(`--origen debe ser ${ORIGENES.join(', ')}`)
            this.exitCode = 1
            return
        }
        if (this.sistema && this.origen !== 'csv') {
            this.logger.error('--sistema solo aplica a --origen=csv (los demás orígenes usan su nombre)')
            this.exitCode = 1
            return
        }
        if (this.ipv6 !== 'ninguno' && this.ipv6 !== 'plan') {
            this.logger.error('--ipv6 debe ser ninguno o plan')
            this.exitCode = 1
            return
        }
        // pnpm corre el script en apps/api: las rutas relativas son respecto de donde se llamó.
        const base = process.env.INIT_CWD ?? process.cwd()
        const ruta = resolve(base, this.fuente)

        let fuente
        try {
            fuente = await leerOrigen(this.origen, ruta)
        } catch (error) {
            this.logger.error((error as Error).message)
            this.exitCode = 1
            return
        }
        let reporte
        try {
            reporte = await importar(fuente, {
                sistema: this.sistema ?? this.origen,
                dryRun: this.dryRun,
                ipv6: this.ipv6,
                soloPlanesExistentes: this.soloPlanesExistentes,
                plantillaId: this.plantilla,
                fuente: ruta,
                empresa: this.empresa ?? null,
                excluirTablas: (this.excluirTablas ?? '')
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
            })
        } catch (error) {
            // p. ej. FilasSinContar: el cuadre por tabla no cerró y no se guardó nada
            this.logger.error((error as Error).message)
            this.exitCode = 1
            return
        }
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
