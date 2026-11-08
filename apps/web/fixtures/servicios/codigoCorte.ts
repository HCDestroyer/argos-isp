import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, idDe, noEncontrado } from '../comun'

/**
 * Como `sincronizarCodigoCorte` (A5) al leer: un suspendido en un router en modo `codigo` tiene un código
 * abierto (reutiliza el que haya o abre uno); en cualquier otro estado, el abierto se cierra. En la API
 * lo hace `routeros` al escribir la regla; aquí basta con hacerlo al consultar.
 */
function sincronizar(servicio: Schema<'Servicio'>, modo: Schema<'Router'>['corte_identificacion']) {
    const abierto = bd.codigosCorte.find(c => c.servicio_id === servicio.id && c.cerrado_en === null)
    if (servicio.estado !== 'suspendido') {
        if (abierto) {
            abierto.cerrado_en = ahora()
        }
        return
    }
    if (!abierto && modo === 'codigo') {
        bd.codigosCorte.push({ servicio_id: servicio.id, creado_en: ahora(), cerrado_en: null })
    }
}

export const rutasCodigoCorte: RutasFixture = {
    /** `GET /servicios/:id/codigo-corte` (A5, `servicios.ver`): nunca el código. */
    'GET /api/v1/servicios/:id/codigo-corte': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        const modo = bd.routers.find(r => r.id === servicio.router_id)?.corte_identificacion ?? 'ip'
        sincronizar(servicio, modo)
        // El último código del servicio (el abierto o el cerrado más reciente), como `estadoCodigoCorte`.
        const ultimo = bd.codigosCorte
            .filter(c => c.servicio_id === servicio.id)
            .sort((a, b) => (b.creado_en ?? '').localeCompare(a.creado_en ?? ''))[0]
        const cuerpo: Schema<'CodigoCorteServicio'> = {
            servicio_id: servicio.id,
            corte_identificacion: modo,
            activo: Boolean(ultimo && ultimo.cerrado_en === null),
            creado_en: ultimo?.creado_en ?? null,
            cerrado_en: ultimo?.cerrado_en ?? null,
        }
        return { status: 200, cuerpo }
    }),
}
