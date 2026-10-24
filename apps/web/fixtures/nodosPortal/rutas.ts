import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, registrarAccion } from '../comun'

const NOMBRE = /^[a-z0-9][a-z0-9-]{0,62}$/
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const rutasNodosPortal: RutasFixture = {
    'GET /api/v1/nodos-portal': conPermiso('nodos_portal.administrar', solicitud => ({ status: 200, cuerpo: paginar([...bd.nodosPortal].sort((a, b) => b.id - a.id), solicitud) })),

    /** Como `CrearNodoPortal` (A5): nombre con el patrón y único; el token `argn_` + 43 caracteres. */
    'POST /api/v1/nodos-portal': conPermiso('nodos_portal.administrar', (solicitud) => {
        const nombre = String(cuerpoObjeto(solicitud).nombre ?? '').trim()
        if (!NOMBRE.test(nombre)) {
            return datosInvalidos([{ field: 'nombre', message: 'El formato de nombre no es válido', rule: 'regex' }])
        }
        if (bd.nodosPortal.some(n => n.nombre === nombre)) {
            return datosInvalidos([{ field: 'nombre', message: `Ya existe el nodo ${nombre}`, rule: 'unique' }])
        }
        const nodo: Schema<'NodoPortal'> = { id: siguienteId(bd.nodosPortal), nombre, ultimo_uso: null, ultima_ip: null, revocado_en: null, creado_por: 1, created_at: ahora() }
        bd.nodosPortal.push(nodo)
        registrarAccion(solicitud, 'nodos_portal.administrar', { tipo: 'nodo_portal', id: nodo.id }, { nombre })
        const azar = crypto.getRandomValues(new Uint8Array(43))
        const token = `argn_${Array.from(azar, n => ALFABETO[n % ALFABETO.length]).join('')}`
        return { status: 201, cuerpo: { token, datos: nodo } }
    }),

    'POST /api/v1/nodos-portal/:id/revocar': conPermiso('nodos_portal.administrar', (solicitud) => {
        const nodo = bd.nodosPortal.find(n => n.id === idDe(solicitud))
        if (!nodo) {
            return noEncontrado('el nodo')
        }
        nodo.revocado_en ??= ahora()
        return { status: 200, cuerpo: nodo }
    }),
}
