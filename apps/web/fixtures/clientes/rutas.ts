import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, normalizar, numeroQuery, paginar } from '../comun'

type Cliente = Schema<'Cliente'>

/** Igual que la API: nombre, NIT/CUI, teléfono, móvil, user_ppp o IP de alguno de sus servicios. */
function coincide(cliente: Cliente, q: string): boolean {
    const texto = normalizar(q.trim())
    if (!texto) {
        return true
    }
    const campos = [cliente.nombre, cliente.nit_cui, cliente.telefono, cliente.movil]
    if (campos.some(campo => normalizar(campo).includes(texto))) {
        return true
    }
    return bd.servicios.some(servicio => servicio.cliente_id === cliente.id
        && (normalizar(servicio.user_ppp).includes(texto) || servicio.ipv4 === q.trim()))
}

export const rutasClientes: RutasFixture = {
    'GET /api/v1/clientes': conPermiso('clientes.ver', (solicitud) => {
        const q = solicitud.query.get('q') ?? ''
        const zona = numeroQuery(solicitud, 'zona_id')
        const filas = bd.clientes
            .filter(cliente => zona === undefined || cliente.zona_id === zona)
            .filter(cliente => coincide(cliente, q))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
