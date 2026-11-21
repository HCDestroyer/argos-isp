import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Identidad del titular (contrato Iris 0.10.0 §3.4.3, A41; decisión 5 del PM del 21 nov).
 *
 * `core.clientes_identidades`: la foto del documento (frente obligatorio, reverso opcional), su tipo
 * y número, el nombre como aparece en él y cómo se verificó. Es del cliente y vive en Argos:
 *
 * - **Cifrada en reposo**: el número, el nombre y las fotos van cifrados con AES-256-GCM
 *   (`#core/identidad`); para comparar sin descifrar se guardan huellas HMAC del número y del
 *   nombre normalizados.
 * - Solo la **vigente y la anterior** (`vigente`); al registrar una nueva se borra la más vieja.
 * - Se borran **12 meses después de retirado el cliente** (cron `identidades_vencidas`) y en el acto
 *   si el cliente se elimina (ON DELETE CASCADE, A39).
 * - `confirmada = false`: se registró sobre un cliente con historial que no tenía documento; no vale
 *   como `documento` de §7.5 ni como `datos_titular` de §12.4 hasta que el titular la confirme.
 * - Nunca sale por el portal, webhooks, eventos, logs ni MCP; solo `clientes.ver_identidad`, con
 *   cada vista auditada.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.clientes_identidades (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                cliente_id bigint NOT NULL REFERENCES core.clientes (id) ON DELETE CASCADE,
                version integer NOT NULL CHECK (version >= 1),
                vigente boolean NOT NULL DEFAULT true,
                documento_tipo text NOT NULL CHECK (documento_tipo IN ('dpi', 'pasaporte')),
                documento_cifrado text NOT NULL,
                documento_huella text NOT NULL,
                nombre_cifrado text NOT NULL,
                nombre_huella text NOT NULL,
                mayor_de_edad boolean NOT NULL CHECK (mayor_de_edad),
                coincide boolean NOT NULL,
                verificado_en timestamptz NOT NULL,
                metodo text NOT NULL CHECK (metodo IN ('foto_documento', 'revision_panel')),
                confirmada boolean NOT NULL DEFAULT true,
                frente bytea NOT NULL,
                frente_tipo text NOT NULL CHECK (frente_tipo IN ('image/jpeg', 'image/png')),
                reverso bytea,
                reverso_tipo text CHECK (reverso_tipo IN ('image/jpeg', 'image/png')),
                origen_tipo text,
                origen_id text,
                registrada_por bigint REFERENCES core.usuarios (id),
                iris_actor text,
                created_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (cliente_id, version),
                CHECK ((reverso IS NULL) = (reverso_tipo IS NULL))
            );
            CREATE UNIQUE INDEX clientes_identidades_vigente ON core.clientes_identidades (cliente_id) WHERE vigente;
            CREATE INDEX clientes_identidades_documento ON core.clientes_identidades (documento_tipo, documento_huella);

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON core.clientes_identidades TO argosisp_app;
                END IF;
            END
            $$;
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.clientes_identidades')
    }
}
