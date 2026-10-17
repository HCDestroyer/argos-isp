import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 3, tanda 2: importación neutral respecto al sistema de origen (Mikrowisp, SmartISP,
 * CSV…), decisión del PM.
 *
 *  - `origen` (texto libre, `^[a-z0-9_]{1,40}$`, como `core.ids_externos.sistema`) en
 *    `billing.facturas`, `billing.pagos` y `billing.saldos_iniciales`: de qué sistema vino el
 *    registro. Null en lo creado por ArgosIsp.
 *  - `clave_externa` (el `id_externo` del contrato) deja de ser única global: es única **por
 *    origen**. Dos sistemas pueden tener la misma factura 123.
 *  - Lo ya importado toma el origen del prefijo de su clave (`mikrowisp:pago:1` → `mikrowisp`);
 *    sin prefijo válido, `externo`. Las facturas de apertura toman el de su saldo inicial.
 */
/** Origen de una clave ya importada: su prefijo antes de `:` si es válido; si no, `externo`. */
function origenDe(columna: string): string {
    return `CASE WHEN position(':' in ${columna}) > 1 AND split_part(${columna}, ':', 1) ~ '^[a-z0-9_]{1,40}$'
                THEN split_part(${columna}, ':', 1) ELSE 'externo' END`
}

export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.saldos_iniciales ADD COLUMN origen text;
            UPDATE billing.saldos_iniciales SET origen = ${origenDe('clave_externa')};
            ALTER TABLE billing.saldos_iniciales
                ALTER COLUMN origen SET NOT NULL,
                ADD CONSTRAINT saldos_iniciales_origen CHECK (origen ~ '^[a-z0-9_]{1,40}$'),
                DROP CONSTRAINT saldos_iniciales_clave_externa_key,
                ADD CONSTRAINT saldos_iniciales_origen_clave UNIQUE (origen, clave_externa);

            ALTER TABLE billing.facturas ADD COLUMN origen text;
            UPDATE billing.facturas f SET origen = s.origen
              FROM billing.saldos_iniciales s
             WHERE s.factura_id = f.id;
            UPDATE billing.facturas SET origen = ${origenDe('clave_externa')}
             WHERE clave_externa IS NOT NULL AND origen IS NULL;
            ALTER TABLE billing.facturas
                ADD CONSTRAINT facturas_origen CHECK (origen ~ '^[a-z0-9_]{1,40}$'),
                ADD CONSTRAINT facturas_origen_clave CHECK ((origen IS NULL) = (clave_externa IS NULL));
            DROP INDEX billing.facturas_clave_externa;
            CREATE UNIQUE INDEX facturas_origen_clave_externa ON billing.facturas (origen, clave_externa)
                WHERE clave_externa IS NOT NULL;

            ALTER TABLE billing.pagos ADD COLUMN origen text;
            UPDATE billing.pagos SET origen = ${origenDe('clave_externa')} WHERE clave_externa IS NOT NULL;
            ALTER TABLE billing.pagos
                ADD CONSTRAINT pagos_origen CHECK (origen ~ '^[a-z0-9_]{1,40}$'),
                ADD CONSTRAINT pagos_origen_clave CHECK ((origen IS NULL) = (clave_externa IS NULL));
            DROP INDEX billing.pagos_clave_externa;
            CREATE UNIQUE INDEX pagos_origen_clave_externa ON billing.pagos (origen, clave_externa)
                WHERE clave_externa IS NOT NULL;
        `)
    }

    async down() {
        // con el mismo id en varios orígenes: el id vuelve a ser único global con su origen delante
        this.schema.raw(`
            UPDATE billing.pagos SET clave_externa = origen || ':' || clave_externa
             WHERE clave_externa IS NOT NULL AND clave_externa NOT LIKE origen || ':%';
            UPDATE billing.facturas SET clave_externa = origen || ':' || clave_externa
             WHERE clave_externa IS NOT NULL AND clave_externa NOT LIKE origen || ':%'
               AND clave_externa NOT LIKE 'apertura-%';
            UPDATE billing.facturas SET clave_externa = 'apertura-' || origen || ':' || substr(clave_externa, 10)
             WHERE clave_externa LIKE 'apertura-%' AND clave_externa NOT LIKE 'apertura-' || origen || ':%';
            UPDATE billing.saldos_iniciales SET clave_externa = origen || ':' || clave_externa
             WHERE clave_externa NOT LIKE origen || ':%';
            DROP INDEX IF EXISTS billing.pagos_origen_clave_externa;
            CREATE UNIQUE INDEX pagos_clave_externa ON billing.pagos (clave_externa) WHERE clave_externa IS NOT NULL;
            ALTER TABLE billing.pagos
                DROP CONSTRAINT IF EXISTS pagos_origen_clave,
                DROP CONSTRAINT IF EXISTS pagos_origen,
                DROP COLUMN IF EXISTS origen;

            DROP INDEX IF EXISTS billing.facturas_origen_clave_externa;
            CREATE UNIQUE INDEX facturas_clave_externa ON billing.facturas (clave_externa)
                WHERE clave_externa IS NOT NULL;
            ALTER TABLE billing.facturas
                DROP CONSTRAINT IF EXISTS facturas_origen_clave,
                DROP CONSTRAINT IF EXISTS facturas_origen,
                DROP COLUMN IF EXISTS origen;

            ALTER TABLE billing.saldos_iniciales
                DROP CONSTRAINT IF EXISTS saldos_iniciales_origen_clave,
                ADD CONSTRAINT saldos_iniciales_clave_externa_key UNIQUE (clave_externa),
                DROP CONSTRAINT IF EXISTS saldos_iniciales_origen,
                DROP COLUMN IF EXISTS origen;
        `)
    }
}
