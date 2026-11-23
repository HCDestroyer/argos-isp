import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { hoyGuatemala } from '~/utils/cobro'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { avisoPcFiscal, tableroEmpresa } from '../tablero/rutas'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresasDeLista, problema, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { empresaRequerida } from './comun'
import { DEFINICIONES_AJUSTES, FABRICA_AJUSTES, type ValorAjuste } from './datos'

type Errores = NonNullable<Problem['errors']>
type Alertas = Schema<'AlertasPanel'>

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

    /**
     * Como `alertasPanel` (A3), solo con lo que el fixture sabe calcular: el límite del pequeño
     * contribuyente desde el bloque del tablero fiscal (con `fiscal.ver`) y `apagadas` de los ajustes.
     * Las revisiones del libro, FEL y vencimientos no se simulan: no van en `revisados` (nunca se
     * dan por buenas sin revisarlas).
     */
    'GET /api/v1/panel-financiero/alertas': conPermiso('panel_financiero.ver', (solicitud) => {
        const pedido = solicitud.query.get('empresas')
        if (pedido !== null && pedido !== '' && pedido !== 'todas') {
            return datosInvalidos([{ field: 'empresas', message: 'Valor no permitido', rule: 'enum' }])
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const hoy = hoyGuatemala()
        const revisados: Alertas['revisados'] = usuario?.permisos.includes('fiscal.ver') ? ['limite_pequeno_contribuyente'] : []
        const ids = empresasDeLista(solicitud) ?? bd.empresas.filter(e => e.activa).map(e => e.id)
        const empresas: Alertas['empresas'] = ids.map((id) => {
            const fila: Alertas['empresas'][number] = { empresa_id: id, empresa: bd.empresas.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`, alertas: [], errores: [], apagadas: [] }
            if (!revisados.includes('limite_pequeno_contribuyente')) {
                return fila
            }
            if (avisoPcApagado(id)) {
                fila.apagadas.push('limite_pequeno_contribuyente')
                return fila
            }
            const bloque = tableroEmpresa(id, hoy).bloques.pequeno_contribuyente
            if (bloque.estado === 'error' && bloque.error) {
                fila.errores.push({ tipo: 'limite_pequeno_contribuyente', error: bloque.error })
            }
            const pc = bloque.estado === 'ok' ? bloque.datos : null
            if (pc && (pc.umbral_alcanzado !== null || pc.supera_limite)) {
                const menor = pc.umbrales.map(u => new Decimal(u)).reduce((a, b) => (b.lt(a) ? b : a), new Decimal(100))
                const alcanzado = new Decimal(pc.umbral_alcanzado ?? '0')
                fila.alertas.push({
                    tipo: 'limite_pequeno_contribuyente',
                    nivel: pc.supera_limite || alcanzado.gt(menor) ? 'critico' : 'aviso',
                    titulo: pc.supera_limite ? 'Superó el límite anual del pequeño contribuyente' : `Lleva el ${pc.porcentaje} % del límite anual del pequeño contribuyente`,
                    detalle: pc.supera_limite ? String(pc.mensaje ?? '') : `Facturado en ${pc.anio}: Q${pc.acumulado} de Q${pc.limite}. Quedan Q${pc.disponible}.`,
                    datos: { ...pc },
                })
            }
            return fila
        })
        const cuerpo: Alertas = { hoy, generado_en: ahora(), revisados, empresas }
        return { status: 200, cuerpo }
    }),

    'PUT /api/v1/panel-financiero/ajustes': conPermiso('panel_financiero.configurar', conIdempotencia((solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const fila = bd.operacionPm.panelFinanciero[empresa.id]
        const antes = { dias_baja: fila?.dias_baja ?? DIAS_BAJA_FABRICA, aviso_pc_activo: fila?.aviso_pc_activo ?? true }
        const dias = cuerpo.dias_baja ?? antes.dias_baja
        if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 1 || dias > 365) {
            return datosInvalidos([{ field: 'dias_baja', message: 'El campo dias_baja debe estar entre 1 y 365', rule: 'range' }])
        }
        const avisoActivo = cuerpo.aviso_pc_activo ?? antes.aviso_pc_activo
        if (typeof avisoActivo !== 'boolean') {
            return datosInvalidos([{ field: 'aviso_pc_activo', message: 'El campo aviso_pc_activo debe ser verdadero o falso', rule: 'boolean' }])
        }
        if (cuerpo.version !== undefined && cuerpo.version !== (fila?.version ?? 1)) {
            return versionCambiada()
        }
        // Umbrales: como `normalizarUmbrales` y `EditarParametro` anidada (todo o nada, en la misma transacción).
        const hoy = hoyGuatemala()
        let nuevosUmbrales: string[] | null = null
        if (cuerpo.aviso_pc_umbrales !== undefined) {
            const lista = Array.isArray(cuerpo.aviso_pc_umbrales) ? cuerpo.aviso_pc_umbrales : []
            if (lista.length < 1 || lista.length > 5 || lista.some(u => typeof u !== 'string' || !/^\d{1,3}(\.\d{1,2})?$/.test(u.trim()))) {
                return datosInvalidos([{ field: 'aviso_pc_umbrales', message: 'De 1 a 5 porcentajes como "80.00"', rule: 'array' }])
            }
            const vistos = new Set<string>()
            for (const [i, u] of lista.entries()) {
                const n = new Decimal(String(u).trim())
                if (n.lte(0) || n.gt(100)) {
                    return datosInvalidos([{ field: `aviso_pc_umbrales.${i}`, message: 'Cada umbral es un porcentaje mayor que 0 y hasta 100', rule: 'range' }])
                }
                const texto = n.toFixed(2)
                if (vistos.has(texto)) {
                    return datosInvalidos([{ field: `aviso_pc_umbrales.${i}`, message: `El umbral ${texto} % está repetido`, rule: 'distinct' }])
                }
                vistos.add(texto)
            }
            const nuevos = [...vistos].sort((a, b) => new Decimal(a).comparedTo(new Decimal(b)))
            const vigentes = avisoPcFiscal(empresa.id, hoy).umbrales
            if (vigentes === null) {
                return problemaTipado(422, 'localizacion_no_instalada', 'Localización no instalada', `La empresa ${empresa.id} no tiene localización fiscal instalada (POST /fiscal/empresas/${empresa.id}/actualizar-localizacion)`, [{ field: 'empresa_id', message: 'Sin localización fiscal', rule: 'localizacion_no_instalada' }])
            }
            if (nuevos.join() !== vigentes.join()) {
                const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
                if (!usuario?.permisos.includes('fiscal.editar_parametros')) {
                    return problema(403, 'Prohibido', 'Cambiar los umbrales del aviso necesita además el permiso fiscal.editar_parametros')
                }
                const repetida = bd.fiscal.valores.find(v => v.clave === 'pc_alertas' && v.empresa_id === empresa.id && v.origen === 'usuario' && v.vigente_desde === hoy)
                if (repetida) {
                    return problemaTipado(409, 'vigencia_duplicada', 'Vigencia duplicada', `pc_alertas ya tiene un valor de la empresa con vigencia ${hoy} (${repetida.id}); use otra fecha`)
                }
                nuevosUmbrales = nuevos
            }
        }
        const campos = (['dias_baja', 'aviso_pc_activo'] as const).filter(c => antes[c] !== (c === 'dias_baja' ? dias : avisoActivo))
        if (campos.length) {
            bd.operacionPm.panelFinanciero[empresa.id] = { dias_baja: dias, aviso_pc_activo: avisoActivo, version: fila ? fila.version + 1 : 1 }
        }
        if (nuevosUmbrales) {
            const motivo = typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim() ? cuerpo.motivo.trim() : 'Umbrales del aviso de pequeño contribuyente (ajustes del panel financiero)'
            const valor = {
                id: siguienteId(bd.fiscal.valores),
                pais: 'GT',
                empresa_id: empresa.id,
                clave: 'pc_alertas',
                valor: nuevosUmbrales,
                vigente_desde: hoy,
                origen: 'usuario' as const,
                motivo,
                creado_por: solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null,
                created_at: ahora(),
                nivel: 'empresa' as const,
            }
            bd.fiscal.valores.push(valor)
            registrarAccion(solicitud, 'fiscal.editar_parametros', { tipo: 'parametro_fiscal', id: valor.id }, { clave: 'pc_alertas', valor: nuevosUmbrales, vigente_desde: hoy, motivo })
        }
        registrarAccion(solicitud, 'panel_financiero.configurar', { tipo: 'panel_financiero', id: empresa.id }, cuerpo)
        return { status: 200, cuerpo: panelDe(empresa.id) }
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

const DIAS_BAJA_FABRICA = 60

/** Como `verAjustesPanel` (A3): la fila de `billing.panel_ajustes` (o la de fábrica) y lo fiscal del aviso. */
function panelDe(empresaId: number): Schema<'AjustesPanelFinanciero'> {
    const fila = bd.operacionPm.panelFinanciero[empresaId]
    const fiscal = avisoPcFiscal(empresaId, hoyGuatemala())
    return {
        empresa_id: empresaId,
        dias_baja: fila?.dias_baja ?? DIAS_BAJA_FABRICA,
        aviso_pc_activo: fila?.aviso_pc_activo ?? true,
        aviso_pc_umbrales: fiscal.umbrales,
        aviso_pc_umbrales_desde: fiscal.desde,
        aviso_pc_umbrales_nivel: fiscal.nivel,
        aviso_pc_aplica: fiscal.aplica,
        fabrica: !fila,
        version: fila?.version ?? 1,
    }
}

/** `apagadas` de `GET /panel-financiero/alertas`: la empresa apagó el aviso de pequeño contribuyente. */
export function avisoPcApagado(empresaId: number): boolean {
    return bd.operacionPm.panelFinanciero[empresaId]?.aviso_pc_activo === false
}
