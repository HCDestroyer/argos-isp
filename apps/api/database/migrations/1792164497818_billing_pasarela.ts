import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 2: pasarela de pago en línea.
 *
 *  - `billing.pasarela_cobros`: cada intento de "Pagar en línea" (cobro creado en el proveedor,
 *    con su `id_proveedor` y `url_pago`). Al llegar el webhook de pago queda `pagado` con su
 *    `pago_id` (un pago `pasarela` por cobro).
 *  - `billing.pasarela_eventos`: cada webhook recibido, único por (proveedor, id del evento):
 *    un webhook repetido no registra otro pago.
 *  - `billing.pasarela_conciliaciones`: corridas de la conciliación diaria con sus diferencias.
 *  - `billing.pasarela_falsa`: el "lado del proveedor" del adaptador falso (laboratorio y
 *    pruebas). El adaptador real no lo usa.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.pasarela_cobros (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                proveedor text NOT NULL,
                id_proveedor text,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                facturas bigint[] NOT NULL DEFAULT '{}',
                estado text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'pagado', 'fallido', 'expirado')),
                url_pago text,
                expira_en timestamptz,
                canal text NOT NULL,
                creado_por bigint REFERENCES core.usuarios (id),
                pago_id bigint UNIQUE REFERENCES billing.pagos (id),
                monto_pagado numeric(14, 2),
                comision numeric(14, 2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
                pagado_en timestamptz,
                conciliado_en timestamptz,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (proveedor, id_proveedor),
                CHECK ((estado = 'pagado') = (pago_id IS NOT NULL))
            );
            CREATE INDEX pasarela_cobros_cliente ON billing.pasarela_cobros (cliente_id);
            CREATE INDEX pasarela_cobros_creado ON billing.pasarela_cobros (created_at);

            CREATE TABLE billing.pasarela_eventos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                proveedor text NOT NULL,
                id_evento text NOT NULL,
                id_proveedor text,
                estado text,
                payload jsonb NOT NULL,
                resultado jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (proveedor, id_evento)
            );

            CREATE TABLE billing.pasarela_conciliaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                proveedor text NOT NULL,
                fecha date NOT NULL,
                revisados integer NOT NULL,
                conciliados integer NOT NULL,
                diferencias jsonb NOT NULL DEFAULT '[]'::jsonb,
                cobros_conciliados bigint[] NOT NULL DEFAULT '{}',
                ejecutado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX pasarela_conciliaciones_fecha ON billing.pasarela_conciliaciones (fecha);

            CREATE TABLE billing.pasarela_falsa (
                id_proveedor text PRIMARY KEY,
                referencia text NOT NULL,
                monto numeric(14, 2) NOT NULL,
                estado text NOT NULL DEFAULT 'pendiente',
                monto_pagado numeric(14, 2),
                comision numeric(14, 2) NOT NULL DEFAULT 0,
                pagado_en timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.pasarela_falsa;
            DROP TABLE IF EXISTS billing.pasarela_conciliaciones;
            DROP TABLE IF EXISTS billing.pasarela_eventos;
            DROP TABLE IF EXISTS billing.pasarela_cobros;
        `)
    }
}
