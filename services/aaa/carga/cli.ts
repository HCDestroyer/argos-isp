import { readFileSync } from 'node:fs'
import { reconexiones, type OpcionesCarga } from './generador.ts'

/**
 * Generador de carga como proceso propio, para que su bucle de eventos no compita con el de quien
 * mide (la prueba de `apps/api` corre la API y el worker de sesiones en su proceso).
 *
 *   node services/aaa/carga/cli.ts <opciones.json>
 *
 * `opciones.json` = `OpcionesCarga` de `generador.ts` (host, puertos, secret, nasIp, usuarios…).
 * Escribe el `ResultadoCarga` en JSON por stdout. Sirve también contra un FreeRADIUS de laboratorio.
 */
const ruta = process.argv[2]
if (!ruta) {
    console.error('uso: node services/aaa/carga/cli.ts <opciones.json>')
    process.exit(2)
}
const opciones = JSON.parse(readFileSync(ruta, 'utf8')) as OpcionesCarga
const resultado = await reconexiones(opciones)
process.stdout.write(`${JSON.stringify(resultado)}\n`)
