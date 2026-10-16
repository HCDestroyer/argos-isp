import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace aaa:repoblar`: reescribe en Redis todas las claves `aaa:user:*` desde Postgres, por
 * lotes (pedido de A2: correr tras perder Redis). Idempotente y seguro con la API atendiendo: usa
 * el mismo SET condicionado por `version` que el write-through. `--forzar` escribe sin comparar
 * versiones: solo tras restaurar la base desde un respaldo (`contratos/aaa.md`).
 * Lógica en `repoblarAaa` (`app/core/aaa.ts`).
 */
export default class AaaRepoblar extends BaseCommand {
    static commandName = 'aaa:repoblar'
    static description = 'Reescribe en Redis todas las claves aaa:user:* desde Postgres, por lotes'

    static options: CommandOptions = {
        startApp: true,
    }

    @flags.number({ description: 'Servicios por lote (por defecto 500, máximo 5000)' })
    declare lote?: number

    @flags.boolean({
        description: 'Escribir sin comparar version (solo tras restaurar la base desde un respaldo)',
        default: false,
    })
    declare forzar: boolean

    async run() {
        const { repoblarAaa } = await import('#core/aaa')
        const lote = this.lote ?? 500
        if (!Number.isInteger(lote) || lote < 1 || lote > 5000) {
            this.logger.error('--lote debe ser un entero entre 1 y 5000')
            this.exitCode = 1
            return
        }

        const resumen = await repoblarAaa({
            lote,
            forzar: this.forzar,
            alAvanzar: (r) => this.logger.info(`lote ${r.lotes}: ${r.servicios} servicios leídos`),
        })

        this.logger.success(
            `aaa:repoblar: ${resumen.servicios} servicios (${resumen.lapidas} lápidas), ` +
                `${resumen.escritos} claves escritas, ${resumen.omitidos} omitidas por version mayor, ` +
                `${resumen.lotes} lotes en ${resumen.duracion_ms} ms` +
                (this.forzar ? ' (forzado)' : ''),
        )
        if (resumen.huerfanas.length > 0) {
            const muestra = resumen.huerfanas.slice(0, 20).join(', ')
            this.logger.warning(
                `${resumen.huerfanas.length} claves sin servicio PPPoE y sin lápida (no se borran): ${muestra}` +
                    (resumen.huerfanas.length > 20 ? ', …' : ''),
            )
        }
    }
}
