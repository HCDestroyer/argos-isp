import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'
import { instalarPaquete, paqueteDePais } from '#fiscal/instalador'
import { CUENTAS_PAQUETE_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * A3 · Localización fiscal, fase 2 (`contratos/localizacion-fiscal.md` §3.2, §3.3 y §11, con los
 * ajustes del estudio de Odoo: impuestos como entidad, cuadrículas, flujo de efectivo y reinicio
 * anual; la numeración de diarios va en otra rama, `a3/hallazgos-auditor`).
 *
 * `ledger` (solo DDL; ninguna fila de asientos ni movimientos cambia):
 *  - `cuentas.tipo` admite `patrimonio`; `pais char(2) DEFAULT 'GT'` y el único pasa a
 *    (`pais`, `codigo`). Columnas `contracuenta`, `naturaleza` (generada: deudora en activo y
 *    gasto, acreedora en pasivo, patrimonio e ingreso, al revés en las contracuentas),
 *    `reinicia_anual` (generada: ingresos y gastos), `auxiliar_proveedor`, `categoria_fiscal`,
 *    `libro_inventario` y `categoria_flujo`.
 *  - `movimientos.impuesto_codigo` + `cuadricula`: etiqueta de impuesto de la partida.
 *
 * Schema `fiscal` (A3): `localizaciones`, `instalaciones`, `parametros` (catálogo),
 * `parametros_valores`, `impuestos`, `impuestos_versiones`, `establecimientos` y `frases`. Las de
 * solo inserción rechazan UPDATE, DELETE y TRUNCATE por trigger y por `REVOKE` al rol de la app.
 *
 * Al final instala `gt-2026.1` en cada empresa existente (contrato §11.2). Aditivo e idempotente.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(SQL_LEDGER)
        this.schema.raw(SQL_FISCAL)

        // gt-2026.1 en cada empresa existente (contrato §11.2)
        this.defer(async (cliente) => {
            const hoy = DateTime.now().setZone('America/Guatemala').toISODate()!
            const empresas = (await cliente
                .from('core.empresas')
                .orderBy('id')
                .select('id', 'pais')) as Array<{ id: number; pais: string }>
            for (const empresa of empresas) {
                await instalarPaquete(cliente, paqueteDePais(empresa.pais.trim()), Number(empresa.id), {
                    instaladaPor: null,
                    hoy,
                })
            }
            // categoría de flujo de las cuentas que ya existían (columna nueva del catálogo; las del
            // paquete la traen al insertarse). Ningún asiento ni movimiento cambia.
            for (const cuenta of CUENTAS_PAQUETE_GT) {
                if (!cuenta.categoria_flujo) continue
                await cliente
                    .from('ledger.cuentas')
                    .where({ pais: 'GT', codigo: cuenta.codigo })
                    .whereNull('categoria_flujo')
                    .update({ categoria_flujo: cuenta.categoria_flujo })
            }
        })
    }

    async down() {
        this.schema.raw(SQL_DOWN)
    }
}

const SQL_LEDGER = `
    ALTER TABLE ledger.cuentas DROP CONSTRAINT cuentas_tipo_check;
    ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_tipo_check
        CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'));
    ALTER TABLE ledger.cuentas
        ADD COLUMN pais char(2) NOT NULL DEFAULT 'GT',
        ADD COLUMN contracuenta boolean NOT NULL DEFAULT false,
        ADD COLUMN auxiliar_proveedor boolean NOT NULL DEFAULT false,
        ADD COLUMN categoria_fiscal text CHECK (categoria_fiscal IN (
            'no_deducible', 'limite_parientes', 'limite_exterior', 'limite_viaticos',
            'donacion_ong', 'publicidad', 'depreciacion'
        )),
        ADD COLUMN libro_inventario boolean NOT NULL DEFAULT false,
        ADD COLUMN categoria_flujo text
            CHECK (categoria_flujo IN ('efectivo', 'operacion', 'inversion', 'financiamiento'));
    ALTER TABLE ledger.cuentas
        ADD COLUMN naturaleza text GENERATED ALWAYS AS (
            CASE WHEN (tipo IN ('activo', 'gasto')) <> contracuenta THEN 'deudora' ELSE 'acreedora' END
        ) STORED,
        ADD COLUMN reinicia_anual boolean GENERATED ALWAYS AS (tipo IN ('ingreso', 'gasto')) STORED;
    ALTER TABLE ledger.cuentas DROP CONSTRAINT cuentas_codigo_key;
    ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_pais_codigo_key UNIQUE (pais, codigo);

    ALTER TABLE ledger.movimientos
        ADD COLUMN impuesto_codigo text,
        ADD COLUMN cuadricula text,
        ADD CONSTRAINT movimientos_cuadricula_completa
            CHECK ((impuesto_codigo IS NULL) = (cuadricula IS NULL));

`

const SQL_FISCAL = `
    CREATE SCHEMA IF NOT EXISTS fiscal;

    CREATE TABLE fiscal.localizaciones (
        codigo text PRIMARY KEY,
        pais char(2) NOT NULL,
        version text NOT NULL CHECK (version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'),
        publicada_en date NOT NULL,
        checksum text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE fiscal.instalaciones (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        empresa_id bigint NOT NULL REFERENCES core.empresas (id),
        localizacion_codigo text NOT NULL REFERENCES fiscal.localizaciones (codigo),
        de_codigo text REFERENCES fiscal.localizaciones (codigo),
        instalada_en timestamptz NOT NULL DEFAULT now(),
        instalada_por bigint REFERENCES core.usuarios (id),
        resumen jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX instalaciones_empresa ON fiscal.instalaciones (empresa_id, id DESC);

    CREATE TABLE fiscal.parametros (
        pais char(2) NOT NULL,
        clave text NOT NULL,
        tipo text NOT NULL CHECK (tipo IN ('porcentaje', 'monto', 'entero', 'fecha', 'texto', 'enum', 'bool', 'json')),
        alcance char(1) NOT NULL CHECK (alcance IN ('N', 'G', 'E')),
        descripcion text NOT NULL,
        fuente text NOT NULL,
        confianza text NOT NULL CHECK (confianza IN (
            'alta', 'media-alta', 'media', 'baja-media', 'baja', 'no_verificado', 'diseno'
        )),
        confirmar_contador boolean NOT NULL DEFAULT false,
        opciones jsonb,
        minimo numeric(18, 6),
        maximo numeric(18, 6),
        accion text,
        derivado boolean NOT NULL DEFAULT false,
        tope_por_clave boolean NOT NULL DEFAULT false,
        localizacion_codigo text NOT NULL REFERENCES fiscal.localizaciones (codigo),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (pais, clave),
        CHECK (tipo <> 'enum' OR jsonb_typeof(opciones) = 'array')
    );

    CREATE TABLE fiscal.parametros_valores (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        pais char(2) NOT NULL,
        empresa_id bigint REFERENCES core.empresas (id),
        clave text NOT NULL,
        valor jsonb NOT NULL CHECK (jsonb_typeof(valor) <> 'null'),
        vigente_desde date NOT NULL,
        origen text NOT NULL CHECK (origen IN ('paquete', 'instalacion', 'usuario')),
        localizacion_codigo text REFERENCES fiscal.localizaciones (codigo),
        motivo text,
        creado_por bigint REFERENCES core.usuarios (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (pais, clave) REFERENCES fiscal.parametros (pais, clave),
        CONSTRAINT parametros_valores_paquete_global CHECK (origen <> 'paquete' OR empresa_id IS NULL),
        CONSTRAINT parametros_valores_instalacion_empresa CHECK (origen <> 'instalacion' OR empresa_id IS NOT NULL),
        CONSTRAINT parametros_valores_motivo CHECK (origen = 'paquete' OR length(trim(motivo)) > 0)
    );
    COMMENT ON COLUMN fiscal.parametros_valores.empresa_id IS 'null = valor global (origen usuario) o del paquete';
    CREATE UNIQUE INDEX parametros_valores_unico
        ON fiscal.parametros_valores (pais, empresa_id, clave, vigente_desde, origen) NULLS NOT DISTINCT;
    CREATE INDEX parametros_valores_empresa ON fiscal.parametros_valores (empresa_id, clave, vigente_desde);

    -- El valor respeta su definición: alcance N solo del paquete, E solo de una empresa, y
    -- minimo/maximo en porcentajes, montos y enteros (la acción valida lo mismo con 422).
    CREATE OR REPLACE FUNCTION fiscal.validar_parametro_valor() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
        d fiscal.parametros%ROWTYPE;
        v_numero numeric;
    BEGIN
        SELECT * INTO d FROM fiscal.parametros WHERE pais = NEW.pais AND clave = NEW.clave;
        IF d.alcance = 'N' AND NEW.origen <> 'paquete' THEN
            RAISE EXCEPTION 'El parámetro % lo fija la ley (alcance N): solo el paquete lo define', NEW.clave
                USING ERRCODE = 'check_violation', CONSTRAINT = 'parametro_no_editable';
        END IF;
        IF d.alcance = 'E' AND NEW.origen <> 'paquete' AND NEW.empresa_id IS NULL THEN
            RAISE EXCEPTION 'El parámetro % es de la empresa (alcance E): no admite valor global', NEW.clave
                USING ERRCODE = 'check_violation', CONSTRAINT = 'parametro_no_editable';
        END IF;
        IF d.tipo IN ('porcentaje', 'monto', 'entero') THEN
            v_numero := (NEW.valor #>> '{}')::numeric;
            IF (d.minimo IS NOT NULL AND v_numero < d.minimo) OR (d.maximo IS NOT NULL AND v_numero > d.maximo) THEN
                RAISE EXCEPTION 'Valor % fuera de rango para %', v_numero, NEW.clave
                    USING ERRCODE = 'check_violation', CONSTRAINT = 'parametro_fuera_de_rango';
            END IF;
        END IF;
        RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER parametros_valores_validar
        BEFORE INSERT ON fiscal.parametros_valores
        FOR EACH ROW EXECUTE FUNCTION fiscal.validar_parametro_valor();

    CREATE TABLE fiscal.impuestos (
        pais char(2) NOT NULL,
        codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9_]+$'),
        grupo text NOT NULL CHECK (grupo IN (
            'iva', 'retencion_iva', 'retencion_isr', 'isr', 'iso', 'pequeno_contribuyente'
        )),
        uso text NOT NULL CHECK (uso IN ('venta', 'compra', 'declaracion')),
        localizacion_codigo text NOT NULL REFERENCES fiscal.localizaciones (codigo),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (pais, codigo)
    );

    CREATE TABLE fiscal.impuestos_versiones (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        pais char(2) NOT NULL,
        codigo text NOT NULL,
        empresa_id bigint REFERENCES core.empresas (id),
        vigente_desde date NOT NULL,
        origen text NOT NULL CHECK (origen IN ('paquete', 'usuario')),
        nombre text NOT NULL,
        calculo text NOT NULL CHECK (calculo IN ('precio_incluido', 'sobre_base', 'sobre_impuesto', 'sobre_total')),
        base_impuesto text,
        tasa numeric(9, 6) NOT NULL CHECK (tasa BETWEEN -100 AND 100),
        incluido boolean NOT NULL,
        exigibilidad text NOT NULL CHECK (exigibilidad IN ('factura', 'pago')),
        cuenta_cuota text NOT NULL,
        cuenta_transicion text,
        cuadricula_base text NOT NULL,
        cuadricula_cuota text NOT NULL,
        descripcion text NOT NULL,
        fuente text NOT NULL,
        confianza text NOT NULL,
        confirmar_contador boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        localizacion_codigo text REFERENCES fiscal.localizaciones (codigo),
        motivo text,
        creado_por bigint REFERENCES core.usuarios (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (pais, codigo) REFERENCES fiscal.impuestos (pais, codigo),
        FOREIGN KEY (pais, base_impuesto) REFERENCES fiscal.impuestos (pais, codigo),
        CONSTRAINT impuestos_versiones_paquete_global CHECK (origen <> 'paquete' OR empresa_id IS NULL),
        CONSTRAINT impuestos_versiones_motivo CHECK (origen = 'paquete' OR length(trim(motivo)) > 0),
        CONSTRAINT impuestos_versiones_base CHECK ((calculo = 'sobre_impuesto') = (base_impuesto IS NOT NULL))
    );
    COMMENT ON COLUMN fiscal.impuestos_versiones.tasa IS 'por ciento con signo: las retenciones son negativas';
    CREATE UNIQUE INDEX impuestos_versiones_unico
        ON fiscal.impuestos_versiones (pais, codigo, empresa_id, vigente_desde, origen) NULLS NOT DISTINCT;

    -- una retención siempre resta y un impuesto nunca (Odoo: retención = impuesto negativo)
    CREATE OR REPLACE FUNCTION fiscal.validar_impuesto_version() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
        v_grupo text;
    BEGIN
        SELECT grupo INTO v_grupo FROM fiscal.impuestos WHERE pais = NEW.pais AND codigo = NEW.codigo;
        IF NEW.tasa <> 0 AND (v_grupo LIKE 'retencion%') <> (NEW.tasa < 0) THEN
            RAISE EXCEPTION 'Tasa % con signo incorrecto para % (grupo %)', NEW.tasa, NEW.codigo, v_grupo
                USING ERRCODE = 'check_violation', CONSTRAINT = 'impuesto_signo';
        END IF;
        RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER impuestos_versiones_validar
        BEFORE INSERT ON fiscal.impuestos_versiones
        FOR EACH ROW EXECUTE FUNCTION fiscal.validar_impuesto_version();

    CREATE TABLE fiscal.establecimientos (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        empresa_id bigint NOT NULL REFERENCES core.empresas (id),
        codigo integer NOT NULL CHECK (codigo > 0),
        nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
        direccion text,
        municipio text,
        departamento text,
        activo boolean NOT NULL DEFAULT true,
        por_defecto boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT establecimientos_codigo_unico UNIQUE (empresa_id, codigo),
        CONSTRAINT establecimientos_defecto_activo CHECK (NOT por_defecto OR activo)
    );
    COMMENT ON COLUMN fiscal.establecimientos.codigo IS 'código de establecimiento de la SAT (inv. C.2)';
    CREATE UNIQUE INDEX establecimientos_por_defecto ON fiscal.establecimientos (empresa_id) WHERE por_defecto;

    CREATE TABLE fiscal.frases (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        empresa_id bigint NOT NULL REFERENCES core.empresas (id),
        clave text NOT NULL,
        tipo_frase integer CHECK (tipo_frase > 0),
        escenario integer CHECK (escenario > 0),
        texto text NOT NULL CHECK (length(trim(texto)) > 0),
        tipos_dte text[] NOT NULL CHECK (cardinality(tipos_dte) > 0),
        origen text NOT NULL DEFAULT 'manual' CHECK (origen = 'manual'),
        activa boolean NOT NULL DEFAULT true,
        vigente_desde date NOT NULL,
        resolucion jsonb,
        confirmar_contador boolean NOT NULL DEFAULT false,
        fuente text,
        motivo text,
        creado_por bigint REFERENCES core.usuarios (id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT frases_unica UNIQUE (empresa_id, clave, vigente_desde)
    );
    COMMENT ON COLUMN fiscal.frases.activa IS 'false: la frase deja de aplicar desde vigente_desde';

    CREATE TRIGGER localizaciones_inmutable BEFORE UPDATE OR DELETE ON fiscal.localizaciones
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER localizaciones_sin_truncate BEFORE TRUNCATE ON fiscal.localizaciones
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER instalaciones_inmutable BEFORE UPDATE OR DELETE ON fiscal.instalaciones
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER instalaciones_sin_truncate BEFORE TRUNCATE ON fiscal.instalaciones
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER parametros_valores_inmutable BEFORE UPDATE OR DELETE ON fiscal.parametros_valores
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER parametros_valores_sin_truncate BEFORE TRUNCATE ON fiscal.parametros_valores
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER impuestos_inmutable BEFORE UPDATE OR DELETE ON fiscal.impuestos
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER impuestos_sin_truncate BEFORE TRUNCATE ON fiscal.impuestos
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER impuestos_versiones_inmutable BEFORE UPDATE OR DELETE ON fiscal.impuestos_versiones
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER impuestos_versiones_sin_truncate BEFORE TRUNCATE ON fiscal.impuestos_versiones
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER frases_inmutable BEFORE UPDATE OR DELETE ON fiscal.frases
        FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
    CREATE TRIGGER frases_sin_truncate BEFORE TRUNCATE ON fiscal.frases
        FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

    DO $do$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
            GRANT USAGE ON SCHEMA fiscal TO argosisp_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fiscal TO argosisp_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fiscal TO argosisp_app;
            REVOKE UPDATE, DELETE, TRUNCATE
                ON fiscal.localizaciones, fiscal.instalaciones, fiscal.parametros_valores, fiscal.frases,
                   fiscal.impuestos, fiscal.impuestos_versiones
                FROM argosisp_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA fiscal
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO argosisp_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA fiscal GRANT USAGE, SELECT ON SEQUENCES TO argosisp_app;
        END IF;
    END
    $do$;
`

const SQL_DOWN = `
    DO $do$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
            ALTER DEFAULT PRIVILEGES IN SCHEMA fiscal REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM argosisp_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA fiscal REVOKE USAGE, SELECT ON SEQUENCES FROM argosisp_app;
        END IF;
    END
    $do$;
    DROP SCHEMA IF EXISTS fiscal CASCADE;

    ALTER TABLE ledger.movimientos
        DROP CONSTRAINT IF EXISTS movimientos_cuadricula_completa,
        DROP COLUMN IF EXISTS cuadricula,
        DROP COLUMN IF EXISTS impuesto_codigo;

    -- las cuentas que agregó el paquete se quedan (pueden tener movimientos); el CHECK vuelve sin
    -- validar las filas de patrimonio
    ALTER TABLE ledger.cuentas DROP CONSTRAINT IF EXISTS cuentas_pais_codigo_key;
    ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_codigo_key UNIQUE (codigo);
    ALTER TABLE ledger.cuentas
        DROP COLUMN IF EXISTS naturaleza,
        DROP COLUMN IF EXISTS reinicia_anual,
        DROP COLUMN IF EXISTS categoria_flujo,
        DROP COLUMN IF EXISTS libro_inventario,
        DROP COLUMN IF EXISTS categoria_fiscal,
        DROP COLUMN IF EXISTS auxiliar_proveedor,
        DROP COLUMN IF EXISTS contracuenta,
        DROP COLUMN IF EXISTS pais;
    ALTER TABLE ledger.cuentas DROP CONSTRAINT IF EXISTS cuentas_tipo_check;
    ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_tipo_check
        CHECK (tipo IN ('activo', 'pasivo', 'ingreso', 'gasto')) NOT VALID;
`
