import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { empresaRequerida } from './comun'
import { DEFINICIONES_AJUSTES, FABRICA_AJUSTES, type ValorAjuste } from './datos'

type Errores = NonNullable<Problem['errors']>

/** Como `verAjustesOperacion` (A1): efectivo = empresa (si la clave lo admite) → global → fábrica. */
function vistaAjustes(empresaId: number | null): Schema<'AjustesOperacion'> {
    const global = { ...bd.operacionPm.ajustesGlobal }
    const empresa = empresaId ? { ...(bd.operacionPm.ajustesEmpresa[empresaId] ?? {}) } : {}
    const efectivo: Record<string, ValorAjuste> = {}
    for (const def of DEFINICIONES_AJUSTES) {
        efectivo[def.clave] = (def.por_empresa ? empresa[def.clave] : undefined) ?? global[def.clave] ?? FABRICA_AJUSTES[def.clave] ?? false
    }
    return { empresa_id: empresaId, efectivo, global, empresa, fabrica: { ...FABRICA_AJUSTES }, definiciones: DEFINICIONES_AJUSTES }
}

/** Como `validarAjuste` (A1): 422 por clave con `valores.<clave>`. */
function validar(clave: string, valor: unknown, conEmpresa: boolean): Errores {
    const campo = `valores.${clave}`
    const def = DEFINICIONES_AJUSTES.find(d => d.clave === clave)
    if (!def) {
        return [{ field: campo, message: `El ajuste ${clave} no existe`, rule: 'clave' }]
    }
    if (conEmpresa && !def.por_empresa) {
        return [{ field: campo, message: `El ajuste ${clave} solo es global`, rule: 'global' }]
    }
    if (valor === null) {
        return []
    }
    if (def.tipo === 'booleano') {
        return typeof valor === 'boolean' ? [] : [{ field: campo, message: 'Debe ser verdadero o falso', rule: 'boolean' }]
    }
    if (def.tipo === 'entero') {
        if (typeof valor !== 'number' || !Number.isInteger(valor)) {
            return [{ field: campo, message: 'Debe ser un número entero', rule: 'number' }]
        }
        return valor < (def.min ?? 0) || valor > (def.max ?? 0) ? [{ field: campo, message: `Debe estar entre ${def.min} y ${def.max}`, rule: 'range' }] : []
    }
    return typeof valor === 'string' && (def.opciones ?? []).includes(valor) ? [] : [{ field: campo, message: `Debe ser uno de: ${(def.opciones ?? []).join(', ')}`, rule: 'enum' }]
}

function empresaPedida(valor: unknown): number | null | 'invalida' {
    if (valor === undefined || valor === null || valor === '') {
        return null
    }
    const id = Number(valor)
    return Number.isInteger(id) && bd.empresas.some(e => e.id === id) ? id : 'invalida'
}

export const rutasAjustesOperacionPm: RutasFixture = {
    'GET /api/v1/ajustes-operacion': conPermiso('ajustes_operacion.ver', (solicitud) => {
        const empresa = empresaPedida(solicitud.query.get('empresa_id'))
        if (empresa === 'invalida') {
            return datosInvalidos([{ field: 'empresa_id', message: 'La empresa no existe', rule: 'exists' }])
        }
        return { status: 200, cuerpo: vistaAjustes(empresa) }
    }),

    'PUT /api/v1/ajustes-operacion': conPermiso('ajustes_operacion.editar', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const empresa = empresaPedida(cuerpo.empresa_id)
        if (empresa === 'invalida') {
            return datosInvalidos([{ field: 'empresa_id', message: 'La empresa no existe', rule: 'exists' }])
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (empresa === null && !usuario?.alcance_global) {
            return problemaTipado(403, 'sin_permiso', 'Sin permiso', 'Los ajustes globales requieren alcance global')
        }
        const valores = typeof cuerpo.valores === 'object' && cuerpo.valores !== null && !Array.isArray(cuerpo.valores) ? cuerpo.valores as Record<string, unknown> : null
        if (!valores) {
            return datosInvalidos([{ field: 'valores', message: 'El campo valores es obligatorio', rule: 'required' }])
        }
        const errores = Object.entries(valores).flatMap(([clave, valor]) => validar(clave, valor, empresa !== null))
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const destino = empresa === null ? bd.operacionPm.ajustesGlobal : (bd.operacionPm.ajustesEmpresa[empresa] ??= {})
        for (const [clave, valor] of Object.entries(valores)) {
            if (valor === null) {
                Reflect.deleteProperty(destino, clave)
            }
            else {
                destino[clave] = valor as ValorAjuste
            }
        }
        registrarAccion(solicitud, 'ajustes_operacion.editar', { tipo: 'ajustes_operacion', id: empresa ?? 0 }, cuerpo)
        return { status: 200, cuerpo: vistaAjustes(empresa) }
    }),

    'GET /api/v1/ajustes-cobro': conPermiso('ajustes_cobro.ver', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        return { status: 200, cuerpo: ajustesCobroDe(empresa.id) }
    }),

    'PUT /api/v1/ajustes-cobro': conPermiso('ajustes_cobro.editar', conIdempotencia((solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const { version, asientos_requieren_aprobacion: aprobacion, pausa_tope_dias: tope } = cuerpo
        const errores: Errores = []
        if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
            errores.push({ field: 'version', message: 'El campo version es obligatorio', rule: 'required' })
        }
        if (aprobacion !== undefined && typeof aprobacion !== 'boolean') {
            errores.push({ field: 'asientos_requieren_aprobacion', message: 'Debe ser verdadero o falso', rule: 'boolean' })
        }
        if (tope !== undefined && (typeof tope !== 'number' || !Number.isInteger(tope) || tope < 1 || tope > 365)) {
            errores.push({ field: 'pausa_tope_dias', message: 'El campo pausa_tope_dias debe estar entre 1 y 365', rule: 'range' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const actual = ajustesCobroDe(empresa.id)
        if (version !== actual.version) {
            return versionCambiada()
        }
        const nuevo: Schema<'AjustesCobro'> = {
            ...actual,
            ...(typeof aprobacion === 'boolean' ? { asientos_requieren_aprobacion: aprobacion } : {}),
            ...(typeof tope === 'number' ? { pausa_tope_dias: tope } : {}),
            version: actual.version + 1,
            updated_by: solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null,
            updated_at: ahora(),
        }
        bd.operacionPm.ajustesCobro[empresa.id] = nuevo
        registrarAccion(solicitud, 'ajustes_cobro.editar', { tipo: 'ajustes_cobro', id: empresa.id }, cuerpo)
        return { status: 200, cuerpo: nuevo }
    })),

    'GET /api/v1/panel-financiero/ajustes': conPermiso('panel_financiero.ver', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        return { status: 200, cuerpo: panelDe(empresa.id) }
    }),

    'PUT /api/v1/panel-financiero/ajustes': conPermiso('panel_financiero.configurar', conIdempotencia((solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const { dias_baja: dias, version } = cuerpoObjeto(solicitud)
        if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 1 || dias > 365) {
            return datosInvalidos([{ field: 'dias_baja', message: 'El campo dias_baja debe estar entre 1 y 365', rule: 'range' }])
        }
        const actual = panelDe(empresa.id)
        if (version !== actual.version) {
            return versionCambiada()
        }
        const nuevo: Schema<'AjustesPanelFinanciero'> = { empresa_id: empresa.id, dias_baja: dias, fabrica: false, version: actual.version + 1 }
        bd.operacionPm.panelFinanciero[empresa.id] = nuevo
        registrarAccion(solicitud, 'panel_financiero.configurar', { tipo: 'panel_financiero', id: empresa.id }, { dias_baja: dias })
        return { status: 200, cuerpo: nuevo }
    })),
}

function ajustesCobroDe(empresaId: number): Schema<'AjustesCobro'> {
    return bd.operacionPm.ajustesCobro[empresaId] ?? {
        empresa_id: empresaId,
        asientos_requieren_aprobacion: false,
        pausa_tope_dias: 90,
        version: 0,
        updated_by: null,
        updated_at: null,
    }
}

function panelDe(empresaId: number): Schema<'AjustesPanelFinanciero'> {
    return bd.operacionPm.panelFinanciero[empresaId] ?? { empresa_id: empresaId, dias_baja: 60, fabrica: true, version: 1 }
}
