import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `billing`: facturas, líneas, conceptos recurrentes, pagos, comprobantes y promesas.
 * Facturas y pagos no se editan ni se borran: se anulan con reverso (lo hace A3 en sus acciones).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.facturas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                -- primer día del periodo facturado
                periodo date NOT NULL,
                -- "servicio_id-periodo" (YYYY-MM-DD): impide duplicar la factura del periodo
                clave_unica text NOT NULL,
                emitida_en timestamptz NOT NULL DEFAULT now(),
                vence_en date NOT NULL,
                estado text NOT NULL DEFAULT 'emitida'
                    CHECK (estado IN ('emitida', 'parcial', 'pagada', 'vencida', 'anulada')),
                subtotal numeric(14, 2) NOT NULL CHECK (subtotal >= 0),
                iva numeric(14, 2) NOT NULL CHECK (iva >= 0),
                total numeric(14, 2) NOT NULL CHECK (total >= 0),
                pagado numeric(14, 2) NOT NULL DEFAULT 0 CHECK (pagado >= 0),
                reglas_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
                fel_uuid text,
                fel_serie text,
                fel_numero text,
                fel_estado text,
                fel_xml text,
                fel_error text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT facturas_clave_unica UNIQUE (clave_unica)
            );
            CREATE INDEX facturas_cliente ON billing.facturas (cliente_id);
            CREATE INDEX facturas_servicio_estado ON billing.facturas (servicio_id, estado);
            CREATE INDEX facturas_estado_vence ON billing.facturas (estado, vence_en);
            CREATE UNIQUE INDEX facturas_fel_uuid ON billing.facturas (fel_uuid) WHERE fel_uuid IS NOT NULL;

            CREATE TABLE billing.facturas_lineas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                concepto text NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('servicio', 'producto', 'mora', 'otro')),
                cantidad numeric(12, 3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
                precio_unitario numeric(14, 2) NOT NULL,
                gravable boolean NOT NULL DEFAULT true,
                iva numeric(14, 2) NOT NULL DEFAULT 0,
                total numeric(14, 2) NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX facturas_lineas_factura ON billing.facturas_lineas (factura_id);

            CREATE TABLE billing.conceptos_recurrentes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                nombre text NOT NULL,
                monto numeric(14, 2) NOT NULL,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX conceptos_recurrentes_servicio ON billing.conceptos_recurrentes (servicio_id);

            CREATE TABLE billing.pagos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                metodo text NOT NULL CHECK (metodo IN ('caja', 'pasarela', 'deposito', 'agente', 'debito')),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                comision numeric(14, 2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
                referencia text,
                caja_id bigint REFERENCES ledger.cajas (id),
                pasarela text,
                estado text NOT NULL DEFAULT 'registrado'
                    CHECK (estado IN ('registrado', 'pendiente_verificacion', 'anulado')),
                nota text,
                registrado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (metodo <> 'caja' OR caja_id IS NOT NULL)
            );
            -- la referencia (boleta, transacción de pasarela) no se repite por método
            CREATE UNIQUE INDEX pagos_metodo_referencia ON billing.pagos (metodo, referencia) WHERE referencia IS NOT NULL;
            CREATE INDEX pagos_cliente ON billing.pagos (cliente_id);
            CREATE INDEX pagos_caja ON billing.pagos (caja_id);
            CREATE INDEX pagos_estado ON billing.pagos (estado);

            CREATE TABLE billing.pagos_aplicaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX pagos_aplicaciones_pago ON billing.pagos_aplicaciones (pago_id);
            CREATE INDEX pagos_aplicaciones_factura ON billing.pagos_aplicaciones (factura_id);

            CREATE TABLE billing.comprobantes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                pago_id bigint NOT NULL REFERENCES billing.pagos (id),
                archivo text NOT NULL,
                estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
                verificado_por bigint REFERENCES core.usuarios (id),
                motivo_rechazo text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX comprobantes_pago ON billing.comprobantes (pago_id);
            CREATE INDEX comprobantes_pendientes ON billing.comprobantes (created_at) WHERE estado = 'pendiente';

            CREATE TABLE billing.promesas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                vence_en timestamptz NOT NULL,
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                -- pendiente_aprobacion y rechazada: resultados de la evaluación de reglas (A3)
                estado text NOT NULL DEFAULT 'activa' CHECK (estado IN (
                    'activa', 'cumplida', 'incumplida', 'cancelada', 'pendiente_aprobacion', 'rechazada'
                )),
                canal text NOT NULL CHECK (canal IN ('portal', 'ia', 'operador', 'supervisor')),
                aprobada_por bigint REFERENCES core.usuarios (id),
                reglas_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
                resultado_evaluacion jsonb,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            -- una sola promesa activa por servicio
            CREATE UNIQUE INDEX promesas_activa_servicio ON billing.promesas (servicio_id) WHERE estado = 'activa';
            CREATE INDEX promesas_cliente ON billing.promesas (cliente_id);
            CREATE INDEX promesas_estado_vence ON billing.promesas (estado, vence_en);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.promesas;
            DROP TABLE IF EXISTS billing.comprobantes;
            DROP TABLE IF EXISTS billing.pagos_aplicaciones;
            DROP TABLE IF EXISTS billing.pagos;
            DROP TABLE IF EXISTS billing.conceptos_recurrentes;
            DROP TABLE IF EXISTS billing.facturas_lineas;
            DROP TABLE IF EXISTS billing.facturas;
        `)
    }
}
