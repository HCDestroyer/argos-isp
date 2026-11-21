import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · equipos del cliente: cambio, revisión, garantía y no recuperados (contrato Iris 0.12.0 §3.10, A48).
 *
 * - `inventario.unidades.estado` admite `no_recuperada` (la declara una persona con
 *   `inventario.cobrar_equipo`; fuera de bodega y sin activo, como `dada_de_baja`). **Revisión y garantía
 *   no son estados nuevos de la fila**: son una unidad `en_reparacion` en su bodega (cuenta en sus
 *   existencias y en 1.1.14, como siempre), en garantía si tiene una fila abierta en
 *   `inventario.garantias`. Así los checks del libro de las unidades en bodega no cambian.
 * - `inventario.unidades_historial`: cada cambio del estado del equipo (los de §3.10: disponible,
 *   en_comodato, por_recuperar, revision, garantia, dada_de_baja, no_recuperada…), con motivo, servicio y
 *   orden. Solo inserción.
 * - `inventario.garantias`: el envío al proveedor (proveedor, RMA, vencimiento) y su resolución
 *   (reparada, reemplazada —con la serie y la MAC anteriores—, rechazada o baja).
 * - `inventario.intentos_recuperacion`: intentos de recuperar un equipo desde Iris (motivo, foto por id
 *   opaco, ubicación, técnico), uno por unidad y día (`dia` en Guatemala).
 * - `inventario.contactos_recuperacion`: contactos con el cliente registrados en Argos (alternativa al
 *   mínimo de técnicos distintos).
 * - `inventario.cobros_equipo`: la cola de aprobación de cobros de equipo («Equipo no devuelto» y los
 *   cobros propuestos sin monto desde un cambio de equipo).
 * - `inventario.cambios_equipo`: cada cambio de equipo (sale, entra, motivo, destino, orden).
 * - `inventario.configuracion.recuperacion_tecnicos_minimos` (2 de fábrica).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE inventario.unidades
                DROP CONSTRAINT unidades_estado_check,
                ADD CONSTRAINT unidades_estado_check CHECK (estado IN (
                    'disponible', 'en_comodato', 'por_recuperar', 'en_reparacion', 'vendida', 'dada_de_baja',
                    'anulada', 'devuelta_proveedor', 'entregada', 'no_recuperada'
                ));

            CREATE TABLE inventario.unidades_historial (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                de text,
                a text NOT NULL,
                motivo text,
                servicio_id bigint REFERENCES core.servicios (id),
                origen_externo_tipo text CHECK (origen_externo_tipo = 'iris_orden'),
                origen_externo_id text,
                actor_tipo text NOT NULL,
                actor_id bigint,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX unidades_historial_unidad ON inventario.unidades_historial (unidad_id, id);

            CREATE TABLE inventario.garantias (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                proveedor_id bigint REFERENCES ledger.proveedores (id),
                proveedor_nombre text,
                rma text CHECK (rma IS NULL OR length(btrim(rma)) BETWEEN 1 AND 100),
                vence_en date,
                enviada_en timestamptz,
                nota text,
                origen text NOT NULL CHECK (origen IN ('cambio_equipo', 'panel')),
                abierta_por bigint REFERENCES core.usuarios (id),
                abierta_en timestamptz NOT NULL DEFAULT now(),
                resultado text CHECK (resultado IN ('reparada', 'reemplazada', 'rechazada', 'baja')),
                resuelta_en timestamptz,
                resuelta_por bigint REFERENCES core.usuarios (id),
                serie_anterior text,
                mac_anterior text,
                version integer NOT NULL DEFAULT 1,
                CHECK ((resultado IS NULL) = (resuelta_en IS NULL)),
                CHECK (enviada_en IS NULL OR (rma IS NOT NULL AND vence_en IS NOT NULL
                    AND (proveedor_id IS NOT NULL OR proveedor_nombre IS NOT NULL)))
            );
            CREATE UNIQUE INDEX garantias_abierta ON inventario.garantias (unidad_id) WHERE resultado IS NULL;

            CREATE TABLE inventario.intentos_recuperacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                intento_n integer NOT NULL CHECK (intento_n >= 1),
                motivo text NOT NULL CHECK (motivo IN ('cliente_ausente', 'se_nego', 'equipo_perdido', 'otro')),
                foto_ref text CHECK (foto_ref IS NULL OR foto_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
                lat numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
                lng numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
                precision_m numeric(10, 2) NOT NULL CHECK (precision_m >= 0),
                nota text CHECK (nota IS NULL OR length(nota) <= 500),
                fecha timestamptz NOT NULL,
                dia date NOT NULL,
                recibido_en_iris timestamptz,
                actor_tecnico text,
                actor_tecnico_id bigint REFERENCES core.usuarios (id),
                origen_externo_tipo text CHECK (origen_externo_tipo = 'iris_orden'),
                origen_externo_id text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (unidad_id, intento_n),
                CHECK (motivo NOT IN ('se_nego', 'equipo_perdido') OR foto_ref IS NOT NULL)
            );
            CREATE UNIQUE INDEX intentos_recuperacion_dia ON inventario.intentos_recuperacion (unidad_id, dia);

            CREATE TABLE inventario.contactos_recuperacion (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                servicio_id bigint REFERENCES core.servicios (id),
                medio text NOT NULL CHECK (medio IN ('llamada', 'whatsapp', 'correo', 'visita', 'oficina', 'otro')),
                nota text NOT NULL CHECK (length(btrim(nota)) BETWEEN 3 AND 500),
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX contactos_recuperacion_unidad ON inventario.contactos_recuperacion (unidad_id);

            CREATE TABLE inventario.cambios_equipo (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                sale_unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                entra_unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                motivo text NOT NULL CHECK (motivo IN ('danado', 'actualizacion', 'garantia', 'otro')),
                destino_sale text NOT NULL CHECK (destino_sale IN ('funciona', 'revision', 'garantia', 'danado')),
                estado_sale text NOT NULL,
                nota text CHECK (nota IS NULL OR length(nota) <= 500),
                fecha timestamptz,
                recibido_en_iris timestamptz,
                actor_tecnico text,
                actor_tecnico_id bigint REFERENCES core.usuarios (id),
                origen_externo_tipo text CHECK (origen_externo_tipo = 'iris_orden'),
                origen_externo_id text,
                registrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CHECK (sale_unidad_id <> entra_unidad_id),
                CHECK (motivo NOT IN ('danado', 'garantia') OR destino_sale <> 'funciona')
            );

            CREATE TABLE inventario.cobros_equipo (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                unidad_id bigint NOT NULL REFERENCES inventario.unidades (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                origen text NOT NULL CHECK (origen IN ('cambio_equipo', 'no_recuperado')),
                cambio_id bigint REFERENCES inventario.cambios_equipo (id),
                motivo text,
                nota text CHECK (nota IS NULL OR length(nota) <= 500),
                estado text NOT NULL CHECK (estado IN ('propuesto', 'aprobado', 'rechazado')),
                monto numeric(14, 2) CHECK (monto IS NULL OR monto > 0),
                factura_id bigint REFERENCES billing.facturas (id),
                decidido_por bigint REFERENCES core.usuarios (id),
                decidido_en timestamptz,
                motivo_decision text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((estado = 'aprobado') = (monto IS NOT NULL AND factura_id IS NOT NULL)),
                CHECK ((estado = 'propuesto') = (decidido_en IS NULL)),
                CHECK ((origen = 'cambio_equipo') = (cambio_id IS NOT NULL))
            );
            CREATE INDEX cobros_equipo_estado ON inventario.cobros_equipo (empresa_id, estado, id);

            ALTER TABLE inventario.configuracion
                ADD COLUMN recuperacion_tecnicos_minimos integer NOT NULL DEFAULT 2
                    CHECK (recuperacion_tecnicos_minimos BETWEEN 1 AND 10);

            -- historial de partida: el estado de cada unidad viva hoy
            INSERT INTO inventario.unidades_historial (empresa_id, unidad_id, de, a, motivo, servicio_id, actor_tipo)
            SELECT u.empresa_id, u.id, NULL,
                   CASE WHEN u.estado = 'en_reparacion' THEN 'revision' ELSE u.estado END,
                   'estado_inicial', u.servicio_id, 'sistema'
              FROM inventario.unidades u;

            CREATE TRIGGER unidades_historial_sin_modificar BEFORE UPDATE OR DELETE ON inventario.unidades_historial
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER intentos_recuperacion_sin_modificar BEFORE UPDATE OR DELETE ON inventario.intentos_recuperacion
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER contactos_recuperacion_sin_modificar BEFORE UPDATE OR DELETE ON inventario.contactos_recuperacion
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cambios_equipo_sin_modificar BEFORE UPDATE OR DELETE ON inventario.cambios_equipo
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER garantias_sin_borrar BEFORE DELETE ON inventario.garantias
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER cobros_equipo_sin_borrar BEFORE DELETE ON inventario.cobros_equipo
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON inventario.unidades_historial, inventario.intentos_recuperacion,
                        inventario.contactos_recuperacion, inventario.cambios_equipo TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON inventario.garantias, inventario.cobros_equipo TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON inventario.unidades_historial, inventario.intentos_recuperacion,
                        inventario.contactos_recuperacion, inventario.cambios_equipo, inventario.garantias,
                        inventario.cobros_equipo FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventario TO argosisp_app;
                END IF;
            END $$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE inventario.configuracion DROP COLUMN IF EXISTS recuperacion_tecnicos_minimos;
            DROP TABLE IF EXISTS inventario.cobros_equipo;
            DROP TABLE IF EXISTS inventario.cambios_equipo;
            DROP TABLE IF EXISTS inventario.contactos_recuperacion;
            DROP TABLE IF EXISTS inventario.intentos_recuperacion;
            DROP TABLE IF EXISTS inventario.garantias;
            DROP TABLE IF EXISTS inventario.unidades_historial;
            ALTER TABLE inventario.unidades
                DROP CONSTRAINT unidades_estado_check,
                ADD CONSTRAINT unidades_estado_check CHECK (estado IN (
                    'disponible', 'en_comodato', 'por_recuperar', 'en_reparacion', 'vendida', 'dada_de_baja',
                    'anulada', 'devuelta_proveedor', 'entregada'
                )) NOT VALID;
        `)
    }
}
