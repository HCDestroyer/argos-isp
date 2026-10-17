import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'

type Empresa = Schema<'EmpresaGrupo'>

/** Campos editables, como `crearEmpresaValidator` / `editarEmpresaValidator` (A1). */
const TEXTOS = ['razon_social', 'nombre_comercial', 'direccion_fiscal', 'municipio', 'departamento', 'telefono', 'telefono_alterno', 'whatsapp', 'correo', 'sitio_web', 'horario', 'instrucciones_pago', 'color_marca'] as const
const REGIMENES = ['sujeto_pagos_trimestrales', 'retencion_definitiva', 'pequeno_contribuyente'] as const

/** NIT con dígito verificador (`1234567-8`, `123456-K`) o CUI de 13 dígitos. */
const NIT = /^(\d{4,12}-?[\dK]|\d{13})$/i
const COLOR = /^#[0-9a-f]{6}$/i
/** Como la API: PNG o SVG de hasta 512 KB. */
export const LOGO_MAX_BYTES = 512 * 1024

/** Empresas que el usuario de la sesión puede ver: todas con alcance global, si no las suyas. */
export function empresasDelUsuario(solicitud: SolicitudFixture): number[] | null {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    if (!usuario || usuario.alcance_global) {
        return null
    }
    return (usuario.empresas ?? []).map(e => e.id)
}

function errores(cuerpo: Record<string, unknown>, creando: boolean): NonNullable<Problem['errors']> {
    const lista: NonNullable<Problem['errors']> = []
    const nit = cuerpo.nit
    if (creando || 'nit' in cuerpo) {
        if (typeof nit !== 'string' || !NIT.test(nit.trim())) {
            lista.push({ field: 'nit', message: 'NIT con dígito verificador (1234567-8) o CUI de 13 dígitos', rule: 'nit' })
        }
    }
    for (const campo of ['razon_social', 'nombre_comercial'] as const) {
        if ((creando || campo in cuerpo) && (typeof cuerpo[campo] !== 'string' || !(cuerpo[campo] as string).trim())) {
            lista.push({ field: campo, message: 'Es obligatorio', rule: 'required' })
        }
    }
    if (typeof cuerpo.correo === 'string' && cuerpo.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.correo)) {
        lista.push({ field: 'correo', message: 'Correo no válido', rule: 'email' })
    }
    if (typeof cuerpo.color_marca === 'string' && cuerpo.color_marca && !COLOR.test(cuerpo.color_marca)) {
        lista.push({ field: 'color_marca', message: 'Color #RRGGBB', rule: 'regex' })
    }
    if (cuerpo.regimen_isr !== undefined && cuerpo.regimen_isr !== null && !REGIMENES.includes(cuerpo.regimen_isr as typeof REGIMENES[number])) {
        lista.push({ field: 'regimen_isr', message: 'Régimen no válido', rule: 'enum' })
    }
    return lista
}

function nitOcupado(nit: unknown, salvo?: number): boolean {
    return typeof nit === 'string' && bd.empresas.some(e => e.activa && e.id !== salvo && e.nit?.toUpperCase() === nit.trim().toUpperCase())
}

function aplicar(empresa: Empresa, cuerpo: Record<string, unknown>): void {
    for (const campo of TEXTOS) {
        if (campo in cuerpo) {
            const valor = cuerpo[campo]
            const limpio = typeof valor === 'string' ? valor.trim() : null
            if (campo === 'razon_social' || campo === 'nombre_comercial') {
                empresa[campo] = limpio ?? ''
            }
            else {
                empresa[campo] = limpio || null
            }
        }
    }
    if ('nit' in cuerpo && typeof cuerpo.nit === 'string') {
        empresa.nit = cuerpo.nit.trim().toUpperCase()
    }
    if ('regimen_isr' in cuerpo) {
        empresa.regimen_isr = (cuerpo.regimen_isr ?? null) as Empresa['regimen_isr']
    }
    if ('codigo_establecimiento' in cuerpo) {
        empresa.codigo_establecimiento = typeof cuerpo.codigo_establecimiento === 'number' ? cuerpo.codigo_establecimiento : null
    }
}

export const rutasEmpresas: RutasFixture = {
    'GET /api/v1/empresas': conPermiso('empresas.ver', (solicitud) => {
        const permitidas = empresasDelUsuario(solicitud)
        const activas = solicitud.query.get('activas') === 'true'
        const filas = bd.empresas
            .filter(e => permitidas === null || permitidas.includes(e.id))
            .filter(e => !activas || e.activa)
            .sort((a, b) => Number(b.principal) - Number(a.principal) || a.id - b.id)
        return { status: 200, cuerpo: filas }
    }),

    'GET /api/v1/empresas/:id': conPermiso('empresas.ver', (solicitud) => {
        const empresa = bd.empresas.find(e => e.id === idDe(solicitud))
        if (!empresa) {
            return noEncontrado('la empresa')
        }
        const permitidas = empresasDelUsuario(solicitud)
        if (permitidas && !permitidas.includes(empresa.id)) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${empresa.id}`)
        }
        return { status: 200, cuerpo: empresa }
    }),

    'POST /api/v1/empresas': conPermiso('empresas.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const lista = errores(cuerpo, true)
        if (lista.length) {
            return datosInvalidos(lista)
        }
        if (nitOcupado(cuerpo.nit)) {
            return problemaTipado(409, 'nit_duplicado', 'Conflicto', `Ya existe una empresa activa con el NIT ${String(cuerpo.nit).trim().toUpperCase()}`)
        }
        const momento = ahora()
        const empresa: Empresa = {
            id: siguienteId(bd.empresas),
            nit: null,
            razon_social: null,
            nombre_comercial: '',
            direccion_fiscal: null,
            municipio: null,
            departamento: null,
            telefono: null,
            telefono_alterno: null,
            whatsapp: null,
            correo: null,
            sitio_web: null,
            horario: null,
            instrucciones_pago: null,
            color_marca: null,
            regimen_isr: null,
            codigo_establecimiento: null,
            logo_url: null,
            logo_tipo: null,
            activa: true,
            principal: false,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        aplicar(empresa, cuerpo)
        bd.empresas.push(empresa)
        registrarAccion(solicitud, 'empresas.crear', { tipo: 'empresa', id: empresa.id }, cuerpo)
        return { status: 201, cuerpo: empresa }
    })),

    'PUT /api/v1/empresas/:id': conPermiso('empresas.editar', (solicitud) => {
        const empresa = bd.empresas.find(e => e.id === idDe(solicitud))
        if (!empresa) {
            return noEncontrado('la empresa')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== empresa.version) {
            return versionCambiada()
        }
        const lista = errores(cuerpo, false)
        if (lista.length) {
            return datosInvalidos(lista)
        }
        if ('nit' in cuerpo && nitOcupado(cuerpo.nit, empresa.id)) {
            return problemaTipado(409, 'nit_duplicado', 'Conflicto', `Ya existe una empresa activa con el NIT ${String(cuerpo.nit).trim().toUpperCase()}`)
        }
        aplicar(empresa, cuerpo)
        empresa.version += 1
        empresa.updated_at = ahora()
        registrarAccion(solicitud, 'empresas.editar', { tipo: 'empresa', id: empresa.id }, cuerpo)
        return { status: 200, cuerpo: empresa }
    }),

    'POST /api/v1/empresas/:id/desactivar': conPermiso('empresas.desactivar', conIdempotencia((solicitud) => {
        const empresa = bd.empresas.find(e => e.id === idDe(solicitud))
        if (!empresa) {
            return noEncontrado('la empresa')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== empresa.version) {
            return versionCambiada()
        }
        if (typeof cuerpo.motivo !== 'string' || !cuerpo.motivo.trim()) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe el motivo', rule: 'required' }])
        }
        if (empresa.principal) {
            return problemaTipado(422, 'empresa_principal', 'Regla de negocio', 'La empresa principal no se desactiva')
        }
        if (!empresa.activa) {
            return problemaTipado(422, 'empresa_inactiva', 'Regla de negocio', 'La empresa ya está inactiva')
        }
        const vigentes = bd.servicios.filter(s => s.empresa_id === empresa.id && s.estado !== 'retirado').length
        if (vigentes) {
            return problemaTipado(422, 'empresa_con_servicios', 'Regla de negocio', `La empresa tiene ${vigentes} servicios sin retirar: pásalos a otra empresa antes de desactivarla`)
        }
        empresa.activa = false
        empresa.version += 1
        empresa.updated_at = ahora()
        registrarAccion(solicitud, 'empresas.desactivar', { tipo: 'empresa', id: empresa.id }, cuerpo)
        return { status: 200, cuerpo: empresa }
    })),

    /** Multipart: `logo` (PNG o SVG, hasta 512 KB) + `version`, o `quitar=true`. */
    'POST /api/v1/empresas/:id/logo': conPermiso('empresas.cambiar_logo', (solicitud) => {
        const empresa = bd.empresas.find(e => e.id === idDe(solicitud))
        if (!empresa) {
            return noEncontrado('la empresa')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (Number(cuerpo.version) !== empresa.version) {
            return versionCambiada()
        }
        if (cuerpo.quitar === 'true' || cuerpo.quitar === true) {
            empresa.logo_url = null
            empresa.logo_tipo = null
        }
        else {
            const archivo = cuerpo.logo
            if (!(archivo instanceof Blob)) {
                return datosInvalidos([{ field: 'logo', message: 'Elige un archivo PNG o SVG', rule: 'required' }])
            }
            if (archivo.type !== 'image/png' && archivo.type !== 'image/svg+xml') {
                return datosInvalidos([{ field: 'logo', message: 'Solo PNG o SVG', rule: 'tipo' }])
            }
            if (archivo.size > LOGO_MAX_BYTES) {
                return datosInvalidos([{ field: 'logo', message: 'El logo pasa de 512 KB', rule: 'tamano' }])
            }
            empresa.logo_tipo = archivo.type
            empresa.logo_url = `/api/v1/empresas/${empresa.id}/logo?v=${(empresa.version + 1).toString(16)}`
        }
        empresa.version += 1
        empresa.updated_at = ahora()
        registrarAccion(solicitud, 'empresas.cambiar_logo', { tipo: 'empresa', id: empresa.id }, { quitar: !empresa.logo_url })
        return { status: 200, cuerpo: empresa }
    }),
}
