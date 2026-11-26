import type { RutasFixture } from '~/utils/fetchFixtures'
import { rutasAjustesOperacionPm } from './ajustes'
import { rutasBancosOrigen } from './bancosOrigen'
import { rutasImpresionCaja } from './cajas'
import { rutasCorreosExternos } from './correosExternos'
import { rutasEnviosReportes } from './envios'
import { rutasEquiposIntegracion } from './equipos'
import { rutasIntentosRecuperacion } from './intentos'
import { rutasPanelFinanciero } from './panelFinanciero'
import { rutasRecuperacion } from './recuperacion'

/** Rutas de los «Pendientes del backend» que el panel ya usa (ajustes, catálogos y verificaciones). */
export const rutasOperacionPm: RutasFixture = {
    ...rutasRecuperacion,
    ...rutasAjustesOperacionPm,
    ...rutasBancosOrigen,
    ...rutasCorreosExternos,
    ...rutasEnviosReportes,
    ...rutasEquiposIntegracion,
    ...rutasIntentosRecuperacion,
    ...rutasImpresionCaja,
    ...rutasPanelFinanciero,
}
