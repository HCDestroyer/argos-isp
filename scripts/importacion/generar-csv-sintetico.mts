/**
 * Regenera `scripts/importacion/sintetico-csv/` desde el volcado sintético de Mikrowisp
 * (estructura real `esquemas/mikrowisp6.sql` + `mikrowisp-sintetico.sql`): las mismas filas que
 * entrega el adaptador, escritas como CSV canónicos. La prueba `tests/importacion/origenes.spec.ts`
 * comprueba que el importador da el mismo reporte con los dos.
 *
 *   pnpm --filter @argosisp/api exec node --import ts-node-maintained/register/esm \
 *       ../../scripts/importacion/generar-csv-sintetico.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { escribirCsv } from '../../apps/api/app/importacion/csv.js'
import { COLUMNAS, ENTIDADES } from '../../apps/api/app/importacion/canonico.js'
import { ARCHIVOS } from '../../apps/api/app/importacion/origenes/csv.js'
import { filasDesdeDump } from '../../apps/api/app/importacion/origenes/mikrowisp.js'

const aqui = new URL('./', import.meta.url)
const volcado =
    readFileSync(new URL('esquemas/mikrowisp6.sql', aqui), 'utf8') +
    '\n' +
    readFileSync(new URL('mikrowisp-sintetico.sql', aqui), 'utf8')
const { filas } = filasDesdeDump(volcado, 'mikrowisp-sintetico.sql')

for (const entidad of ENTIDADES) {
    const columnas = COLUMNAS[entidad].map((c) => c.nombre)
    const contenido = escribirCsv(
        columnas,
        filas[entidad].filas.map((f) => f.valores),
    )
    writeFileSync(new URL(`sintetico-csv/${ARCHIVOS[entidad]}`, aqui), contenido)
    console.log(`${ARCHIVOS[entidad]}: ${filas[entidad].filas.length} filas`)
}
