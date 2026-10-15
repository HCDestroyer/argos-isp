import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `billing.plantillas_facturacion`: va antes de `core.servicios`, que la referencia.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.plantillas_facturacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                ciclo text NOT NULL DEFAULT 'dia_fijo' CHECK (ciclo IN ('dia_fijo', 'aniversario')),
                -- día de facturación para ciclo dia_fijo
                dia smallint CHECK (dia BETWEEN 1 AND 28),
                prorrateo boolean NOT NULL DEFAULT true,
                dias_gracia integer NOT NULL DEFAULT 0 CHECK (dias_gracia >= 0),
                facturas_para_limitar integer NOT NULL DEFAULT 1 CHECK (facturas_para_limitar >= 0),
                facturas_para_cortar integer NOT NULL DEFAULT 1 CHECK (facturas_para_cortar >= 1),
                mora_tipo text NOT NULL DEFAULT 'ninguna' CHECK (mora_tipo IN ('ninguna', 'fija', 'porcentaje')),
                mora_valor numeric(14, 2) NOT NULL DEFAULT 0 CHECK (mora_valor >= 0),
                mora_recurrente boolean NOT NULL DEFAULT false,
                -- hora local America/Guatemala en la que corre el corte de esta plantilla
                hora_corte time NOT NULL DEFAULT '08:00',
                certificar_al text NOT NULL DEFAULT 'nunca' CHECK (certificar_al IN ('emitir', 'pagar', 'nunca')),
                reglas_promesa jsonb NOT NULL DEFAULT '{}'::jsonb,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (ciclo <> 'dia_fijo' OR dia IS NOT NULL)
            );
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.plantillas_facturacion;`)
    }
}
