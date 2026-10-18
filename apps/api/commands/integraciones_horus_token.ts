import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * `node ace integraciones:horus-token`: genera el token `atk_` de Horus desde la consola (seed
 * opcional para laboratorio o instalación sin panel). Llama a la misma acción que el panel
 * (`horus.generar_token`, actor `sistema`, canal `consola`): crea el usuario técnico "Horus"
 * la primera vez y muestra el token una sola vez. Revocar: panel o
 * `POST /api/v1/integraciones/horus/tokens/:id/revocar`.
 */
export default class IntegracionesHorusToken extends BaseCommand {
    static commandName = 'integraciones:horus-token'
    static description = 'Genera el token atk_ de la integración Horus (se muestra una sola vez)'

    static options: CommandOptions = {
        startApp: true,
    }

    @flags.string({ description: 'Nombre del token (por defecto "Horus Flow")' })
    declare nombre?: string

    @flags.array({ description: 'Restringir a estos routers (ids)' })
    declare routers?: string[]

    @flags.array({ description: 'Restringir a estas zonas (ids)' })
    declare zonas?: string[]

    async run() {
        const { default: GenerarTokenHorus } = await import('#core/actions/generar_token_horus')
        const { contextoSistema } = await import('#shared/contexto')
        const ids = (valores?: string[]) => {
            const lista = (valores ?? []).flatMap((v) => v.split(',')).map((v) => Number(v.trim()))
            if (lista.some((n) => !Number.isInteger(n) || n < 1)) {
                throw new Error('Los ids deben ser enteros positivos')
            }
            return lista.length > 0 ? lista : undefined
        }

        const salida = await new GenerarTokenHorus().execute(
            { nombre: this.nombre, routers: ids(this.routers), zonas: ids(this.zonas) },
            contextoSistema('consola'),
        )
        this.logger.success(
            `Token ${salida.datos.id} del usuario Horus (${salida.usuario_id}). Cópialo ahora:`,
        )
        console.log(salida.token)
    }
}
