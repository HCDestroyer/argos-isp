import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * GenieACS en un servidor aparte (decisión del PM): el NBI va detrás de un proxy HTTPS. Si su
 * certificado es de una autoridad propia, la empresa guarda el certificado raíz (PEM, público, no es
 * un secreto) en `genieacs_ca` y Argos confía en él solo para ese ACS.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`ALTER TABLE integraciones.equipos_config ADD COLUMN genieacs_ca text`)
    }

    async down() {
        this.schema.raw(`ALTER TABLE integraciones.equipos_config DROP COLUMN IF EXISTS genieacs_ca`)
    }
}
