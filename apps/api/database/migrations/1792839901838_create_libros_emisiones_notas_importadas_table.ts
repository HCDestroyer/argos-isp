import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Observación del auditor sobre H48/H62: las notas de crédito sobre facturas importadas salen en el
 * libro de ventas desde 28ee679. Un libro emitido antes no las traía, y no cambia: esas notas van
 * como fila de ajuste en el primer mes sin un libro así (`libroVentasLegal`).
 *
 * `notas_importadas` dice si la emisión ya trae esas notas. Las emisiones que existen quedan en NULL
 * (emitidas con la regla anterior; la tabla es de solo inserción y aquí no se actualiza ninguna
 * fila); las nuevas, `true` por defecto.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE fiscal.libros_emisiones ADD COLUMN notas_importadas boolean;
            ALTER TABLE fiscal.libros_emisiones ALTER COLUMN notas_importadas SET DEFAULT true;
            COMMENT ON COLUMN fiscal.libros_emisiones.notas_importadas IS
                'true: la emisión incluye las notas de crédito sobre facturas importadas; NULL: emitida antes (van como ajuste al primer mes sin emisión así)';
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE fiscal.libros_emisiones DROP COLUMN IF EXISTS notas_importadas;`)
    }
}
