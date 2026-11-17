import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Reconexión temporal (decisión del PM, 17 nov 2026): `billing.promesas.motivo_reconexion` guarda
 * por qué Iris pidió la reconexión mientras caja revisa el comprobante: `fuera_de_horario` (de
 * siempre) o `sin_personal` (horario hábil, pero nadie de caja disponible). Solo las promesas de
 * tipo `reconexion_temporal` lo llevan; las demás quedan en null.
 *
 * Las reconexiones ya creadas toman el motivo de `resultado_evaluacion.reconexion_temporal.motivo`
 * (todas `fuera_de_horario`, el único que existía). Sin asientos ni cambios en `ledger`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.promesas
                ADD COLUMN motivo_reconexion text
                    CHECK (motivo_reconexion IN ('fuera_de_horario', 'sin_personal'));
            UPDATE billing.promesas
               SET motivo_reconexion = coalesce(
                       resultado_evaluacion -> 'reconexion_temporal' ->> 'motivo',
                       'fuera_de_horario'
                   )
             WHERE tipo = 'reconexion_temporal';
            ALTER TABLE billing.promesas
                ADD CONSTRAINT promesas_motivo_reconexion CHECK (
                    (tipo = 'reconexion_temporal') = (motivo_reconexion IS NOT NULL)
                );
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.promesas
                DROP CONSTRAINT IF EXISTS promesas_motivo_reconexion,
                DROP COLUMN IF EXISTS motivo_reconexion;
        `)
    }
}
