import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tipo de plan (decisión del PM, 19 oct): `residencial` (por defecto, también los planes que ya
 * existen), `empresarial` o `dedicado`. Solo informa y genera advertencias (`app/network/tipos_plan.ts`);
 * no cambia la velocidad ni la facturación.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.planes
                ADD COLUMN tipo text NOT NULL DEFAULT 'residencial'
                    CHECK (tipo IN ('residencial', 'empresarial', 'dedicado'));
            CREATE INDEX planes_tipo ON network.planes (tipo);
        `)
    }

    async down() {
        this.schema.raw('ALTER TABLE network.planes DROP COLUMN IF EXISTS tipo')
    }
}
