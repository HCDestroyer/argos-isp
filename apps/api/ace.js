/*
|--------------------------------------------------------------------------
| Punto de entrada JavaScript para los comandos ace
|--------------------------------------------------------------------------
|
| Registra el hook de ts-node (swc) para importar TypeScript en desarrollo.
| En producción (build/) se usa directamente `node ace` sobre JS compilado.
|
*/
import 'ts-node-maintained/register/esm'
await import('./bin/console.js')
