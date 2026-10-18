/*
|--------------------------------------------------------------------------
| Registro completo de rutas /api/v1
|--------------------------------------------------------------------------
|
| Cada módulo exporta su lista desde `start/routes/<modulo>.ts`. Este registro lo usan el
| router (`start/routes.ts`) y el generador de OpenAPI.
|
*/
import type { Ruta } from '#shared/rutas'
import core from '#start/routes/core'
import network from '#start/routes/network'
import billing from '#start/routes/billing'
import ledger from '#start/routes/ledger'
import portal from '#start/routes/portal'
import notify from '#start/routes/notify'
import fiscal from '#start/routes/fiscal'
import integraciones from '#start/routes/integraciones'
import monitoreo from '#start/routes/monitoreo'

export const registroRutas: Ruta[] = [
    ...core,
    ...network,
    ...billing,
    ...ledger,
    ...fiscal,
    ...portal,
    ...notify,
    ...integraciones,
    ...monitoreo,
]
