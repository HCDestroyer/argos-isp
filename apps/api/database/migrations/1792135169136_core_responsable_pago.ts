import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Responsable de pago (decisión del PM, día 4): `core.clientes.responsable_pago_id` apunta al
 * cliente que paga por este (la casa de la mamá o del hijo, a nombre del familiar).
 *
 * - Un cliente tiene como máximo un responsable; un responsable puede tener varios dependientes.
 * - CHECK: nadie es su propio responsable.
 * - Un solo nivel: un dependiente no puede ser responsable de otro y un responsable no puede
 *   tener responsable. Así no hay ciclos (A→B y B→A exigiría que A fuese dependiente y
 *   responsable a la vez). La acción lo valida con 422 bloqueando las dos filas; el trigger
 *   `clientes_responsable_un_nivel` lo garantiza ante cualquier otro camino de escritura.
 * - FK sin cascada (`ON DELETE RESTRICT`): retirar servicios o quedarse sin servicios activos no
 *   toca la relación, y un cliente con dependientes no se puede borrar mientras los tenga.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.clientes
                ADD COLUMN responsable_pago_id bigint
                    REFERENCES core.clientes (id) ON DELETE RESTRICT,
                ADD CONSTRAINT clientes_responsable_no_si_mismo
                    CHECK (responsable_pago_id IS NULL OR responsable_pago_id <> id);
            CREATE INDEX clientes_responsable_pago
                ON core.clientes (responsable_pago_id) WHERE responsable_pago_id IS NOT NULL;

            CREATE FUNCTION core.clientes_responsable_un_nivel() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.responsable_pago_id IS NULL THEN
                    RETURN NEW;
                END IF;
                IF EXISTS (
                    SELECT 1 FROM core.clientes
                     WHERE id = NEW.responsable_pago_id AND responsable_pago_id IS NOT NULL
                ) THEN
                    RAISE EXCEPTION 'El responsable de pago % tiene a su vez un responsable',
                        NEW.responsable_pago_id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'clientes_responsable_un_nivel';
                END IF;
                IF EXISTS (SELECT 1 FROM core.clientes WHERE responsable_pago_id = NEW.id) THEN
                    RAISE EXCEPTION 'El cliente % es responsable de pago de otros y no puede tener responsable',
                        NEW.id
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'clientes_responsable_un_nivel';
                END IF;
                RETURN NEW;
            END
            $$;
            CREATE TRIGGER clientes_responsable_un_nivel
                BEFORE INSERT OR UPDATE OF responsable_pago_id ON core.clientes
                FOR EACH ROW EXECUTE FUNCTION core.clientes_responsable_un_nivel();
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS clientes_responsable_un_nivel ON core.clientes;
            DROP FUNCTION IF EXISTS core.clientes_responsable_un_nivel();
            ALTER TABLE core.clientes
                DROP CONSTRAINT IF EXISTS clientes_responsable_no_si_mismo,
                DROP COLUMN IF EXISTS responsable_pago_id;
        `)
    }
}
