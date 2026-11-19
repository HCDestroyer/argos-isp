import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, empresaNoPermitida, idDe, noEncontrado, problemaTipado, registrarAccion } from '../comun'

/** `verContrasenaDefecto` de A5: nunca la contraseña; `version` 0 = nunca se configuró. */
function vistaDefecto(empresaId: number): Schema<'PortalContrasenaDefecto'> {
    const fila = bd.portalContrasenas.defecto[empresaId]
    return {
        empresa_id: empresaId,
        configurada: fila !== undefined,
        actualizada_en: fila?.actualizada_en ?? null,
        version: fila?.version ?? 0,
    }
}

/**
 * Empresas del cliente como `empresasDelCliente` de A5: las de sus servicios no retirados o, sin
 * servicios, la principal (1).
 */
function empresasDelCliente(clienteId: number): number[] {
    const empresas = new Set(bd.servicios.filter(s => s.cliente_id === clienteId && s.estado !== 'retirado').map(s => s.empresa_id ?? 1))
    return empresas.size ? [...empresas] : [1]
}

/** `verContrasenaPortalCliente` de A5 (`sesiones_cerradas` 0 en la lectura). */
function vistaCliente(clienteId: number): Schema<'ClienteContrasenaPortal'> {
    const propia = bd.portalContrasenas.propias[clienteId]
    return {
        cliente_id: clienteId,
        propia: propia !== undefined,
        actualizada_en: propia ?? null,
        defecto_configurada: empresasDelCliente(clienteId).some(id => bd.portalContrasenas.defecto[id] !== undefined),
        sesiones_cerradas: 0,
    }
}

/** Empresa activa como `resolverEmpresaActiva` (422 `empresa_requerida`, 403 `empresa_no_permitida`). */
function empresaActiva(solicitud: SolicitudFixture): { id: number } | { falla: RespuestaFixture } {
    const fuera = empresaNoPermitida(solicitud)
    if (fuera) {
        return { falla: fuera }
    }
    const id = empresaActivaDe(solicitud)
    return id === null
        ? { falla: problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa activa (X-Empresa-Id)') }
        : { id }
}

function clienteExistente(solicitud: SolicitudFixture): number | null {
    const id = idDe(solicitud)
    return id !== null && bd.clientes.some(c => c.id === id) ? id : null
}

/**
 * Contraseña del portal (A5, rama `agente/a5-portal-acceso`): la por defecto de la empresa activa
 * y, por cliente, si usa la propia y «Restaurar». Mismos permisos, errores y auditoría que la API.
 */
export const rutasPortalContrasena: RutasFixture = {
    'GET /api/v1/empresa/contrasena-portal': conPermiso('empresa.ver', (solicitud) => {
        const empresa = empresaActiva(solicitud)
        return 'falla' in empresa ? empresa.falla : { status: 200, cuerpo: vistaDefecto(empresa.id) }
    }),

    'PUT /api/v1/empresa/contrasena-portal': conPermiso('portal.configurar_contrasena_defecto', (solicitud) => {
        const { contrasena, version } = cuerpoObjeto(solicitud)
        const errores: NonNullable<Problem['errors']> = []
        if (typeof contrasena !== 'string') {
            errores.push({ field: 'contrasena', message: 'El campo contrasena es obligatorio', rule: 'required' })
        }
        else if (contrasena.length < 8) {
            errores.push({ field: 'contrasena', message: 'El campo contrasena debe tener al menos 8 caracteres', rule: 'minLength' })
        }
        else if (contrasena.length > 128) {
            errores.push({ field: 'contrasena', message: 'El campo contrasena no debe tener más de 128 caracteres', rule: 'maxLength' })
        }
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
            errores.push({ field: 'version', message: 'El campo version es obligatorio', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresa = empresaActiva(solicitud)
        if ('falla' in empresa) {
            return empresa.falla
        }
        const antes = vistaDefecto(empresa.id)
        if (antes.version !== version) {
            return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', `La empresa ${empresa.id} cambió en otra sesión; recarga y vuelve a intentar`)
        }
        bd.portalContrasenas.defecto[empresa.id] = { actualizada_en: ahora(), version: antes.version + 1 }
        registrarAccion(solicitud, 'portal.configurar_contrasena_defecto', { tipo: 'empresa', id: empresa.id }, { contrasena: '***', version })
        return { status: 200, cuerpo: vistaDefecto(empresa.id) }
    }),

    'GET /api/v1/clientes/:id/contrasena-portal': conPermiso('clientes.ver', (solicitud) => {
        const id = clienteExistente(solicitud)
        return id === null ? noEncontrado(`el cliente ${solicitud.params.id}`) : { status: 200, cuerpo: vistaCliente(id) }
    }),

    'POST /api/v1/clientes/:id/restaurar-contrasena-portal': conPermiso('clientes.restaurar_contrasena_portal', (solicitud) => {
        const id = clienteExistente(solicitud)
        if (id === null) {
            return noEncontrado(`el cliente ${solicitud.params.id}`)
        }
        const teniaPropia = bd.portalContrasenas.propias[id] !== undefined
        const cerradas = bd.portalContrasenas.sesiones[id] ?? 0
        const { propias, sesiones } = bd.portalContrasenas
        bd.portalContrasenas.propias = Object.fromEntries(Object.entries(propias).filter(([cliente]) => Number(cliente) !== id))
        bd.portalContrasenas.sesiones = Object.fromEntries(Object.entries(sesiones).filter(([cliente]) => Number(cliente) !== id))
        registrarAccion(solicitud, 'clientes.restaurar_contrasena_portal', { tipo: 'cliente', id }, { cliente_id: id, tenia_propia: teniaPropia, sesiones_cerradas: cerradas })
        return { status: 200, cuerpo: { ...vistaCliente(id), sesiones_cerradas: cerradas } }
    }),
}
