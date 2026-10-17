import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'

export { usuarios } from './datos'

export const rutasUsuarios: RutasFixture = {
    'GET /api/v1/usuarios': conPermiso('usuarios.ver', solicitud => ({ status: 200, cuerpo: paginar(bd.usuarios, solicitud) })),

    /**
     * Como `AsignarEmpresasUsuario` (A1): `{ version, alcance_global, empresas? }`. Sin global hace
     * falta al menos una empresa activa (422); solo quien tiene alcance global lo da y nadie asigna
     * empresas fuera de su alcance (403 `empresa_no_permitida`).
     */
    'PUT /api/v1/usuarios/:id/empresas': conPermiso('usuarios.asignar_empresas', (solicitud) => {
        const usuario = bd.usuarios.find(u => u.id === idDe(solicitud))
        if (!usuario) {
            return noEncontrado('el usuario')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== usuario.version) {
            return versionCambiada()
        }
        const actor = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const global = cuerpo.alcance_global === true
        const pedidas = Array.isArray(cuerpo.empresas) ? cuerpo.empresas.filter((e): e is number => typeof e === 'number') : []
        if (global && !actor?.alcance_global) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'Solo quien tiene alcance global puede darlo')
        }
        if (!global) {
            if (!pedidas.length) {
                return datosInvalidos([{ field: 'empresas', message: 'Elige al menos una empresa', rule: 'required' }])
            }
            const invalida = pedidas.findIndex(id => !bd.empresas.some(e => e.id === id && e.activa))
            if (invalida >= 0) {
                return datosInvalidos([{ field: `empresas.${invalida}`, message: 'La empresa no existe o está inactiva', rule: 'exists' }])
            }
            const ajena = pedidas.find(id => !actor?.alcance_global && !(actor?.empresas ?? []).some(e => e.id === id))
            if (ajena !== undefined) {
                return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${ajena}`)
            }
        }
        usuario.alcance_global = global
        usuario.empresas = global ? [] : [...new Set(pedidas)].sort((a, b) => a - b)
        usuario.version += 1
        usuario.updated_at = ahora()
        registrarAccion(solicitud, 'usuarios.asignar_empresas', { tipo: 'usuario', id: usuario.id }, cuerpo)
        return { status: 200, cuerpo: usuario }
    }),
}
