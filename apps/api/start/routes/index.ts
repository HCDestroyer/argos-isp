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
import lealtad from '#start/routes/lealtad'
import inventario from '#start/routes/inventario'
import monitoreo from '#start/routes/monitoreo'
import apariencia from '#start/routes/apariencia'
import extractosBancarios from '#start/routes/extractos_bancarios'
import irisProspectos from '#start/routes/iris_prospectos'
import equiposIris from '#start/routes/equipos_iris'
import facturasIris from '#start/routes/facturas_iris'

export const registroRutas: Ruta[] = [
    ...core,
    ...network,
    ...billing,
    ...ledger,
    ...extractosBancarios,
    ...fiscal,
    ...lealtad,
    ...inventario,
    ...portal,
    ...notify,
    ...integraciones,
    ...irisProspectos,
    ...equiposIris,
    ...facturasIris,
    ...monitoreo,
    ...apariencia,
]
