import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Avisos fiscales a contabilidad (A6, contrato de localización fiscal §14): `libro.integridad_rota`,
 * `dte.rechazado`, `fel.contingencia_cambiada` y `nota_credito.anulada` van por Telegram al chat del
 * equipo y por correo a contabilidad. `correo_contabilidad` es la lista de direcciones (separadas
 * por coma) de la configuración de canales global o de la empresa; null = sin correo a contabilidad
 * (el envío queda `fallido` con el motivo, visible en el panel).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE notify.configuracion_canales
                ADD COLUMN correo_contabilidad text
                    CHECK (correo_contabilidad IS NULL OR length(correo_contabilidad) BETWEEN 3 AND 1000)
        `)
    }

    async down() {
        this.schema.raw('ALTER TABLE notify.configuracion_canales DROP COLUMN IF EXISTS correo_contabilidad')
    }
}
