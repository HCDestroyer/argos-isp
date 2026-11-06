import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * URL de corte por empresa (pedido del PM, 6 nov; `contratos/control-velocidad.md` §10.6): si está, el
 * portal responde a las sondas de portal cautivo y a cualquier HTTP de un suspendido de esa empresa con
 * `302 Location: <url_corte>` en vez de su propia `/corte`. Su host entra en el walled garden
 * (`argos-walled`) de cada router. `http://` o `https://`; null = la página `/corte` del portal.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE core.empresas
                ADD COLUMN url_corte text,
                ADD CONSTRAINT empresas_url_corte_http CHECK (url_corte IS NULL OR url_corte ~* '^https{0,1}://[^/]+');
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE core.empresas
                DROP CONSTRAINT IF EXISTS empresas_url_corte_http,
                DROP COLUMN IF EXISTS url_corte;
        `)
    }
}
