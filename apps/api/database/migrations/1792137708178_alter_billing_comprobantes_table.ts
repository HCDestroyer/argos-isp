import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · comprobantes de depósito (día 4, tanda 2). La tabla `billing.comprobantes` existía desde el
 * día 1 sin uso (ninguna acción la escribía). Ahora un comprobante nace **antes** del pago: el
 * cliente (portal) o un operador (panel) lo sube, queda `pendiente` y, al aprobarlo, `RegistrarPago`
 * crea el pago y el comprobante queda ligado a `pago_id`.
 *
 *  - `pago_id` pasa a ser opcional (solo los aprobados lo tienen; único).
 *  - Datos del depósito: cliente, servicio opcional, método bancario, cuenta propia de destino,
 *    banco de origen (transferencia y ACH), referencia, monto, fecha del depósito.
 *  - El archivo vive en `COMPROBANTES_DIR` (nunca en la base): `archivo` es la ruta relativa,
 *    con su tipo verificado por contenido y su tamaño (máximo 5 MB).
 *  - Una referencia pendiente es única por (método, cuenta bancaria, referencia), la misma clave
 *    que `billing.pagos_metodo_referencia`; al rechazarse, la referencia queda libre.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.comprobantes
                ALTER COLUMN pago_id DROP NOT NULL,
                ADD COLUMN cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                ADD COLUMN servicio_id bigint REFERENCES core.servicios (id),
                ADD COLUMN metodo text NOT NULL
                    CHECK (metodo IN ('deposito', 'transferencia', 'ach', 'remesa')),
                ADD COLUMN cuenta_bancaria_id bigint NOT NULL REFERENCES billing.cuentas_bancarias (id),
                ADD COLUMN banco_origen_id bigint REFERENCES billing.bancos (id),
                ADD COLUMN referencia text NOT NULL CHECK (length(referencia) > 0),
                ADD COLUMN monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                ADD COLUMN fecha_deposito date NOT NULL,
                ADD COLUMN archivo_tipo text NOT NULL
                    CHECK (archivo_tipo IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
                ADD COLUMN archivo_tamano integer NOT NULL
                    CHECK (archivo_tamano > 0 AND archivo_tamano <= 5242880),
                ADD COLUMN archivo_nombre text,
                ADD COLUMN canal text NOT NULL CHECK (canal IN ('portal', 'panel')),
                ADD COLUMN nota text,
                ADD COLUMN registrado_por bigint REFERENCES core.usuarios (id),
                ADD COLUMN verificado_en timestamptz,
                ADD CONSTRAINT comprobantes_banco_origen CHECK (
                    metodo NOT IN ('transferencia', 'ach') OR banco_origen_id IS NOT NULL
                ),
                ADD CONSTRAINT comprobantes_revision CHECK (
                    (estado = 'pendiente' AND pago_id IS NULL AND verificado_en IS NULL)
                    OR (estado = 'aprobado' AND pago_id IS NOT NULL AND verificado_en IS NOT NULL)
                    OR (estado = 'rechazado' AND pago_id IS NULL AND motivo_rechazo IS NOT NULL
                        AND verificado_en IS NOT NULL)
                );

            DROP INDEX IF EXISTS billing.comprobantes_pago;
            CREATE UNIQUE INDEX comprobantes_pago ON billing.comprobantes (pago_id) WHERE pago_id IS NOT NULL;
            CREATE UNIQUE INDEX comprobantes_referencia_pendiente
                ON billing.comprobantes (metodo, cuenta_bancaria_id, referencia)
                WHERE estado = 'pendiente';
            CREATE INDEX comprobantes_cliente ON billing.comprobantes (cliente_id, id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.comprobantes_cliente;
            DROP INDEX IF EXISTS billing.comprobantes_referencia_pendiente;
            DROP INDEX IF EXISTS billing.comprobantes_pago;
            ALTER TABLE billing.comprobantes
                DROP CONSTRAINT IF EXISTS comprobantes_revision,
                DROP CONSTRAINT IF EXISTS comprobantes_banco_origen,
                DROP COLUMN IF EXISTS verificado_en,
                DROP COLUMN IF EXISTS registrado_por,
                DROP COLUMN IF EXISTS nota,
                DROP COLUMN IF EXISTS canal,
                DROP COLUMN IF EXISTS archivo_nombre,
                DROP COLUMN IF EXISTS archivo_tamano,
                DROP COLUMN IF EXISTS archivo_tipo,
                DROP COLUMN IF EXISTS fecha_deposito,
                DROP COLUMN IF EXISTS monto,
                DROP COLUMN IF EXISTS referencia,
                DROP COLUMN IF EXISTS banco_origen_id,
                DROP COLUMN IF EXISTS cuenta_bancaria_id,
                DROP COLUMN IF EXISTS metodo,
                DROP COLUMN IF EXISTS servicio_id,
                DROP COLUMN IF EXISTS cliente_id;
            CREATE INDEX comprobantes_pago ON billing.comprobantes (pago_id);
            -- los comprobantes pendientes o rechazados no tienen pago: no se puede volver a NOT NULL
            DO $do$
            BEGIN
                ALTER TABLE billing.comprobantes ALTER COLUMN pago_id SET NOT NULL;
            EXCEPTION WHEN not_null_violation THEN
                RAISE NOTICE 'billing.comprobantes tiene filas sin pago_id; pago_id queda opcional';
            END
            $do$;
        `)
    }
}
