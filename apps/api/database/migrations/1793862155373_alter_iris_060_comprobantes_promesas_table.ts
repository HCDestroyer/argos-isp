import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.6.0 §7 (pedidos A16, A17 y A18).
 *
 * `billing.comprobantes`:
 *  - canal `iris` (boletas que llegan por chat o llamada), con lo que Iris leyó de la foto
 *    (`leido_por`, `confianza`), por dónde llegó (`canal_contacto`) y las cabeceras de Iris
 *    (`iris_actor`, `iris_conversacion`). Con `canal = iris` las tres primeras son obligatorias.
 *  - `causa_rechazo` al rechazar (`no_aparece`, `monto_distinto`, `ilegible`, `falta_dato`,
 *    `duplicado`, `otro`); null en los rechazados antes de esta migración.
 *
 * `billing.promesas`:
 *  - `tipo`: `promesa` (todas las existentes) o `reconexion_temporal` (§7.3), ligada a un
 *    comprobante pendiente (`comprobante_id`, obligatorio solo en ese tipo y único).
 *  - `sistema_origen`: `iris` si la creó el usuario técnico Iris (notify no avisa al cliente,
 *    §9.2 #2); null en las demás. (`origen` ya existe: es el sistema de una promesa importada.)
 *
 * Sin asientos ni cambios en `ledger`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.comprobantes
                DROP CONSTRAINT IF EXISTS comprobantes_canal_check,
                ADD CONSTRAINT comprobantes_canal_check CHECK (canal IN ('portal', 'panel', 'iris')),
                ADD COLUMN leido_por text CHECK (leido_por IN ('ia', 'persona', 'cliente_dictado')),
                -- 0.000 a 1.000 como texto: no es dinero (las columnas numeric del libro son todas (14,2))
                ADD COLUMN confianza text CHECK (confianza ~ '^(0\\.[0-9]{3}|1\\.000)$'),
                ADD COLUMN canal_contacto text
                    CHECK (canal_contacto IN ('whatsapp', 'telegram', 'correo', 'llamada')),
                ADD COLUMN iris_actor text CHECK (length(iris_actor) BETWEEN 1 AND 80),
                ADD COLUMN iris_conversacion text CHECK (length(iris_conversacion) BETWEEN 1 AND 128),
                ADD COLUMN causa_rechazo text CHECK (causa_rechazo IN (
                    'no_aparece', 'monto_distinto', 'ilegible', 'falta_dato', 'duplicado', 'otro'
                )),
                ADD CONSTRAINT comprobantes_iris CHECK (
                    canal <> 'iris'
                    OR (leido_por IS NOT NULL AND canal_contacto IS NOT NULL AND iris_conversacion IS NOT NULL)
                ),
                ADD CONSTRAINT comprobantes_causa_rechazo CHECK (
                    causa_rechazo IS NULL OR estado = 'rechazado'
                );
            CREATE INDEX comprobantes_canal_estado ON billing.comprobantes (canal, estado, id);

            ALTER TABLE billing.promesas
                ADD COLUMN tipo text NOT NULL DEFAULT 'promesa'
                    CHECK (tipo IN ('promesa', 'reconexion_temporal')),
                ADD COLUMN comprobante_id bigint REFERENCES billing.comprobantes (id),
                ADD COLUMN sistema_origen text CHECK (sistema_origen IN ('iris')),
                ADD CONSTRAINT promesas_reconexion_comprobante CHECK (
                    (tipo = 'reconexion_temporal') = (comprobante_id IS NOT NULL)
                );
            CREATE UNIQUE INDEX promesas_comprobante ON billing.promesas (comprobante_id)
                WHERE comprobante_id IS NOT NULL;
            CREATE INDEX promesas_servicio_tipo ON billing.promesas (servicio_id, tipo, created_at);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS billing.promesas_servicio_tipo;
            DROP INDEX IF EXISTS billing.promesas_comprobante;
            ALTER TABLE billing.promesas
                DROP CONSTRAINT IF EXISTS promesas_reconexion_comprobante,
                DROP COLUMN IF EXISTS sistema_origen,
                DROP COLUMN IF EXISTS comprobante_id,
                DROP COLUMN IF EXISTS tipo;

            DROP INDEX IF EXISTS billing.comprobantes_canal_estado;
            ALTER TABLE billing.comprobantes
                DROP CONSTRAINT IF EXISTS comprobantes_causa_rechazo,
                DROP CONSTRAINT IF EXISTS comprobantes_iris,
                DROP COLUMN IF EXISTS causa_rechazo,
                DROP COLUMN IF EXISTS iris_conversacion,
                DROP COLUMN IF EXISTS iris_actor,
                DROP COLUMN IF EXISTS canal_contacto,
                DROP COLUMN IF EXISTS confianza,
                DROP COLUMN IF EXISTS leido_por;
            -- los comprobantes de Iris no caben en el CHECK anterior: pasan a panel
            UPDATE billing.comprobantes SET canal = 'panel' WHERE canal = 'iris';
            ALTER TABLE billing.comprobantes
                DROP CONSTRAINT IF EXISTS comprobantes_canal_check,
                ADD CONSTRAINT comprobantes_canal_check CHECK (canal IN ('portal', 'panel'));
        `)
    }
}
