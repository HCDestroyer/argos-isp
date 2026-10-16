import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Configuración de la empresa (A5, tarea 9): datos de contacto e instrucciones de pago que muestran
 * `/corte`, el portal y los documentos (`{{empresa.*}}`). Una sola fila (`id = 1`); sin fila se usan
 * los valores por defecto (`app/portal/empresa.ts`) y la primera edición la crea.
 *
 * Las cuentas bancarias para depósito NO van aquí: su fuente única es `billing.cuentas_bancarias` (A3).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.empresa (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 200),
                nit text,
                direccion text,
                telefono text,
                telefono_alterno text,
                whatsapp text,
                correo text,
                horario text,
                instrucciones_pago text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.empresa')
    }
}
