import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, problemaTipado, registrarAccion } from '../comun'

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** Como `isIPv6` de Node para lo que prueba el panel: hex, `:` y a lo sumo un `::`. */
function esIpv6(valor: string): boolean {
    if (!/^[\da-f:]+$/i.test(valor) || (valor.match(/::/g) ?? []).length > 1) {
        return false
    }
    const grupos = valor.split(':').filter(g => g !== '')
    return grupos.every(g => g.length <= 4) && (valor.includes('::') ? grupos.length < 8 : grupos.length === 8)
}

const CAMPOS = ['portal_v4', 'portal_v6', 'portal_puerto', 'modo_suspension'] as const

/**
 * `GET`/`PUT /corte/configuracion` (A5, `ConfigurarPortalCorte`): solo cambia lo enviado, `null`
 * en las IPs las quita, 422 con el campo como VineJS y 409 `conflicto_version` si `version` cambió.
 */
export const rutasPortalCorte: RutasFixture = {
    'GET /api/v1/corte/configuracion': conPermiso('portal_corte.ver', () => ({ status: 200, cuerpo: bd.portalCorte })),

    'PUT /api/v1/corte/configuracion': conPermiso('portal_corte.configurar', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: NonNullable<Problem['errors']> = []
        const { version, portal_v4: v4, portal_v6: v6, portal_puerto: puerto, modo_suspension: modo } = cuerpo
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
            errores.push({ field: 'version', message: 'El campo version es obligatorio', rule: 'required' })
        }
        if (v4 !== undefined && v4 !== null && (typeof v4 !== 'string' || !IPV4.test(v4.trim()))) {
            errores.push({ field: 'portal_v4', message: 'El campo portal_v4 debe ser una dirección IP válida', rule: 'ipAddress' })
        }
        if (v6 !== undefined && v6 !== null && (typeof v6 !== 'string' || !esIpv6(v6.trim()))) {
            errores.push({ field: 'portal_v6', message: 'El campo portal_v6 debe ser una dirección IP válida', rule: 'ipAddress' })
        }
        if (puerto !== undefined && (typeof puerto !== 'number' || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535)) {
            errores.push({ field: 'portal_puerto', message: 'El campo portal_puerto debe estar entre 1 y 65535', rule: 'range' })
        }
        if (modo !== undefined && modo !== 'desconectar' && modo !== 'coa') {
            errores.push({ field: 'modo_suspension', message: 'El valor de modo_suspension no es válido', rule: 'enum' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const actual = bd.portalCorte
        if (version !== actual.version) {
            return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', 'La configuración del portal de corte cambió en otra sesión; recarga y vuelve a intentar')
        }
        const nueva: Schema<'PortalCorte'> = {
            ...actual,
            ...(v4 !== undefined ? { portal_v4: typeof v4 === 'string' && v4.trim() ? v4.trim() : null } : {}),
            ...(v6 !== undefined ? { portal_v6: typeof v6 === 'string' && v6.trim() ? v6.trim().toLowerCase() : null } : {}),
            ...(typeof puerto === 'number' ? { portal_puerto: puerto } : {}),
            ...(modo === 'desconectar' || modo === 'coa' ? { modo_suspension: modo } : {}),
            origen: 'configuracion',
            version: actual.version + 1,
            updated_at: ahora(),
        }
        const campos = CAMPOS.filter(c => nueva[c] !== actual[c])
        bd.portalCorte = nueva
        registrarAccion(solicitud, 'portal_corte.configurar', { tipo: 'portal_corte', id: 1 }, { ...cuerpo, campos })
        return { status: 200, cuerpo: nueva }
    }),
}
