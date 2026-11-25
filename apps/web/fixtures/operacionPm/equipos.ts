import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { empresaRequerida } from './comun'
import { acsVacio } from './datos'

type Instancia = Schema<'InstanciaSmartOlt'>
type Acs = Schema<'ConfigAcs'>
type Errores = NonNullable<Problem['errors']>

/**
 * SmartOLT con varias instancias y el ACS por separado (`contratos/equipos-olt-acs.md` §5.1), con las
 * mismas reglas que la API: el token y la clave nunca salen (`***`); cambiar URL o secreto borra la
 * prueba; la compartida solo con alcance global; un subdominio una sola vez. Al probar, una URL con
 * «falla» o un token con «malo» no responden; si no, SmartOLT trae `OLTS_SMARTOLT_FIXTURE` y liga sola
 * la OLT que se llama igual que una de la red de acceso.
 */
export const OLTS_SMARTOLT_FIXTURE = [
    { id: '1', name: 'OLT Centro', hardware: 'Huawei MA5800-X7', ip: '10.20.0.11' },
    { id: '2', name: 'OLT-NORTE-02', hardware: 'ZTE C320', ip: '10.20.0.12' },
]

const op = () => bd.operacionPm

function usuarioDe(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

function alcanceGlobal(solicitud: SolicitudFixture): boolean {
    return Boolean(usuarioDe(solicitud)?.alcance_global)
}

function operativa(i: Instancia): boolean {
    return i.activo && i.prueba_ok === true
}

function visible(i: Instancia, empresaId: number): boolean {
    return i.empresa_id === null || i.empresa_id === empresaId
}

const compartidaSinAlcance = (): RespuestaFixture =>
    problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'Una instancia compartida de SmartOLT solo la administra quien tiene acceso a todas las empresas')

const conflictoVersion = (): RespuestaFixture =>
    problemaTipado(409, 'conflicto_version', 'Conflicto de versión', 'Otra persona cambió esta instancia mientras la editabas. Recarga para ver sus cambios.')

/** `https://<subdominio>.smartolt.com` (tolera `/api` al final), o el error para la persona. */
function normalizarUrl(valor: unknown): { url: string } | { error: string } {
    if (typeof valor !== 'string') {
        return { error: 'No es una URL válida' }
    }
    try {
        const url = new URL(valor.trim())
        const ruta = url.pathname.replace(/\/+$/, '')
        if (ruta !== '' && ruta !== '/api') {
            return { error: 'La URL de SmartOLT es https://<subdominio>.smartolt.com' }
        }
        return { url: url.origin }
    }
    catch {
        return { error: 'No es una URL válida' }
    }
}

function instanciaVisible(solicitud: SolicitudFixture): { ok: true, instancia: Instancia, empresaId: number } | { ok: false, falla: RespuestaFixture } {
    const empresa = empresaRequerida(solicitud)
    if (!empresa.ok) {
        return empresa
    }
    const id = idDe(solicitud)
    const instancia = op().smartolt.find(i => i.id === id)
    if (!instancia || !visible(instancia, empresa.id)) {
        return { ok: false, falla: noEncontrado('esa instancia de SmartOLT') }
    }
    return { ok: true, instancia, empresaId: empresa.id }
}

function administrable(solicitud: SolicitudFixture) {
    const r = instanciaVisible(solicitud)
    if (r.ok && r.instancia.empresa_id === null && !alcanceGlobal(solicitud)) {
        return { ok: false as const, falla: compartidaSinAlcance() }
    }
    return r
}

function validarNombreYUrl(cuerpo: Record<string, unknown>, empresaId: number | null, excepto: number | null, parcial: boolean): { errores: Errores, url?: string, conflicto?: RespuestaFixture } {
    const errores: Errores = []
    let url: string | undefined
    if (!parcial || cuerpo.url !== undefined) {
        const r = normalizarUrl(cuerpo.url)
        if ('error' in r) {
            errores.push({ field: 'url', rule: 'url', message: r.error })
        }
        else {
            url = r.url
        }
    }
    if ((!parcial || cuerpo.nombre !== undefined) && (typeof cuerpo.nombre !== 'string' || !cuerpo.nombre.trim())) {
        errores.push({ field: 'nombre', rule: 'requerido', message: 'Ponle un nombre' })
    }
    if ((!parcial || cuerpo.token !== undefined) && (typeof cuerpo.token !== 'string' || cuerpo.token.trim().length < 8)) {
        errores.push({ field: 'token', rule: 'minLength', message: 'El token de SmartOLT es más largo' })
    }
    if (errores.length) {
        return { errores }
    }
    if (url && op().smartolt.some(i => i.id !== excepto && i.url.toLowerCase() === url!.toLowerCase())) {
        const otra = op().smartolt.find(i => i.url.toLowerCase() === url!.toLowerCase())
        return { errores, conflicto: problemaTipado(409, 'subdominio_duplicado', 'Subdominio repetido', `Ya existe una instancia con ese subdominio: «${otra?.nombre}». Una cuenta se usa una sola vez.`) }
    }
    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : null
    if (nombre && op().smartolt.some(i => i.id !== excepto && (i.empresa_id ?? 0) === (empresaId ?? 0) && i.nombre.toLowerCase() === nombre.toLowerCase())) {
        return { errores, conflicto: problemaTipado(409, 'instancia_duplicada', 'Nombre repetido', `Ya hay una instancia de SmartOLT llamada «${nombre}»`) }
    }
    return { errores, url }
}

function vistaAcs(empresaId: number): Acs {
    const acs = op().acs[empresaId] ?? acsVacio(empresaId)
    const secretos = op().secretosAcs[empresaId] ?? { clave: null, ca: null }
    return { ...acs, clave: secretos.clave ? '***' : null, ca: Boolean(secretos.ca), operativo: acs.activo && Boolean(acs.url) && acs.prueba_ok === true }
}

/** La OLT de la red de acceso de un servicio (servidor PPPoE → VLAN → puerto PON → OLT). */
function oltDelServicio(servicioId: number): { olt: { id: number, nombre: string }, puerto: string } | null {
    const servicio = bd.servicios.find(s => s.id === servicioId) as { servidor_pppoe_id?: number | null } | undefined
    const servidor = bd.redAcceso.servidoresPppoe.find(s => s.id === servicio?.servidor_pppoe_id)
    const vlan = bd.redAcceso.vlans.find(v => v.id === servidor?.vlan_id)
    const puerto = bd.redAcceso.puertosPon.find(p => p.id === vlan?.puerto_pon_id)
    const olt = bd.redAcceso.olts.find(o => o.id === puerto?.olt_id)
    return olt && puerto ? { olt: { id: olt.id, nombre: olt.nombre }, puerto: puerto.identificador } : null
}

export const rutasEquiposIntegracion: RutasFixture = {
    'GET /api/v1/integraciones/smartolt/instancias': conPermiso('smartolt.ver', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        return { status: 200, cuerpo: paginar(op().smartolt.filter(i => visible(i, empresa.id)), solicitud) }
    }),

    'GET /api/v1/integraciones/smartolt/instancias/:id': conPermiso('smartolt.ver', (solicitud) => {
        const r = instanciaVisible(solicitud)
        return r.ok ? { status: 200, cuerpo: r.instancia } : r.falla
    }),

    'POST /api/v1/integraciones/smartolt/instancias': conPermiso('smartolt.crear_instancia', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const compartida = cuerpo.compartida === true
        if (compartida && !alcanceGlobal(solicitud)) {
            return compartidaSinAlcance()
        }
        const duena = compartida ? null : (typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresa.id)
        const v = validarNombreYUrl(cuerpo, duena, null, false)
        if (v.errores.length) {
            return datosInvalidos(v.errores)
        }
        if (v.conflicto) {
            return v.conflicto
        }
        const id = Math.max(0, ...op().smartolt.map(i => i.id)) + 1
        const nueva: Instancia = {
            id, empresa_id: duena, compartida, nombre: String(cuerpo.nombre).trim(), nota: typeof cuerpo.nota === 'string' && cuerpo.nota.trim() ? cuerpo.nota.trim() : null,
            url: v.url!, token: '***', activo: cuerpo.activo === true, operativa: false, probado_en: null, prueba_ok: null, prueba_error: null,
            prueba_latencia_ms: null, probado_por: null, olts_sincronizadas_en: null, version: 1, olts: [],
        }
        op().smartolt.push(nueva)
        op().tokensSmartolt[id] = String(cuerpo.token).trim()
        registrarAccion(solicitud, 'smartolt.crear_instancia', { tipo: 'instancia_smartolt', id }, { ...cuerpo, token: '***' })
        return { status: 201, cuerpo: nueva }
    }),

    'PUT /api/v1/integraciones/smartolt/instancias/:id': conPermiso('smartolt.editar_instancia', (solicitud) => {
        const r = administrable(solicitud)
        if (!r.ok) {
            return r.falla
        }
        const actual = r.instancia
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== actual.version) {
            return conflictoVersion()
        }
        const compartida = typeof cuerpo.compartida === 'boolean' ? cuerpo.compartida : actual.compartida
        if (compartida !== actual.compartida && !alcanceGlobal(solicitud)) {
            return compartidaSinAlcance()
        }
        const duena = compartida ? null : (typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (actual.empresa_id ?? r.empresaId))
        const v = validarNombreYUrl(cuerpo, duena, actual.id, true)
        if (v.errores.length) {
            return datosInvalidos(v.errores)
        }
        if (v.conflicto) {
            return v.conflicto
        }
        const cambiaPrueba = (v.url !== undefined && v.url !== actual.url) || cuerpo.token !== undefined
        if (typeof cuerpo.token === 'string') {
            op().tokensSmartolt[actual.id] = cuerpo.token.trim()
        }
        const nueva: Instancia = {
            ...actual,
            empresa_id: duena,
            compartida,
            nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : actual.nombre,
            nota: cuerpo.nota === undefined ? actual.nota : (typeof cuerpo.nota === 'string' && cuerpo.nota.trim() ? cuerpo.nota.trim() : null),
            url: v.url ?? actual.url,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo,
            ...(cambiaPrueba ? { probado_en: null, prueba_ok: null, prueba_error: null, prueba_latencia_ms: null, probado_por: null } : {}),
            version: actual.version + 1,
        }
        nueva.operativa = operativa(nueva)
        op().smartolt = op().smartolt.map(i => (i.id === actual.id ? nueva : i))
        registrarAccion(solicitud, 'smartolt.editar_instancia', { tipo: 'instancia_smartolt', id: actual.id }, { ...cuerpo, ...(cuerpo.token ? { token: '***' } : {}) })
        return { status: 200, cuerpo: nueva }
    }),

    'DELETE /api/v1/integraciones/smartolt/instancias/:id': conPermiso('smartolt.eliminar_instancia', (solicitud) => {
        const r = administrable(solicitud)
        if (!r.ok) {
            return r.falla
        }
        if (op().smartoltEnUso.includes(r.instancia.id)) {
            return problemaTipado(409, 'instancia_en_uso', 'Instancia en uso', 'La instancia tiene equipos gestionados o aprovisionamientos en curso: apágala en vez de eliminarla')
        }
        op().smartolt = op().smartolt.filter(i => i.id !== r.instancia.id)
        registrarAccion(solicitud, 'smartolt.eliminar_instancia', { tipo: 'instancia_smartolt', id: r.instancia.id }, {})
        return { status: 204 }
    }),

    'POST /api/v1/integraciones/smartolt/instancias/:id/probar': conPermiso('smartolt.probar_instancia', (solicitud) => {
        const r = administrable(solicitud)
        if (!r.ok) {
            return r.falla
        }
        const actual = r.instancia
        const falla = actual.url.includes('falla') || (op().tokensSmartolt[actual.id] ?? '').includes('malo')
        const cuando = ahora()
        const vinculadas: Schema<'PruebaInstanciaSmartOlt'>['vinculadas_por_nombre'] = []
        let olts = actual.olts
        if (!falla) {
            const vistas = new Set(OLTS_SMARTOLT_FIXTURE.map(o => o.id))
            olts = olts.map(o => (vistas.has(o.smartolt_olt_id) ? o : { ...o, presente: false }))
            for (const o of OLTS_SMARTOLT_FIXTURE) {
                const previa = olts.find(x => x.smartolt_olt_id === o.id)
                if (previa) {
                    olts = olts.map(x => (x === previa ? { ...x, nombre: o.name, hardware: o.hardware, ip: o.ip, presente: true, origen: 'sincronizada' } : x))
                    continue
                }
                const id = Math.max(0, ...op().smartolt.flatMap(i => i.olts.map(x => x.id))) + 1 + olts.length
                const ligadas = new Set(op().smartolt.flatMap(i => i.olts.map(x => x.olt?.id)).filter(Boolean))
                const iguales = bd.redAcceso.olts.filter(n => n.nombre.toLowerCase() === o.name.toLowerCase() && !ligadas.has(n.id)
                    && (actual.empresa_id === null || n.empresa_id === null || n.empresa_id === actual.empresa_id))
                const olt = iguales.length === 1 ? { id: iguales[0]!.id, nombre: iguales[0]!.nombre } : null
                if (olt) {
                    vinculadas.push({ id, smartolt_olt_id: o.id, olt_id: olt.id })
                }
                olts = [...olts, { id, smartolt_olt_id: o.id, nombre: o.name, hardware: o.hardware, ip: o.ip, presente: true, origen: 'sincronizada', olt, perfiles: [] }]
            }
        }
        const nueva: Instancia = {
            ...actual,
            olts,
            probado_en: cuando,
            prueba_ok: !falla,
            prueba_error: falla ? 'SmartOLT: Invalid API Key (403)' : null,
            prueba_latencia_ms: 212,
            probado_por: usuarioDe(solicitud)?.nombre ?? null,
            olts_sincronizadas_en: falla ? actual.olts_sincronizadas_en : cuando,
        }
        nueva.operativa = operativa(nueva)
        op().smartolt = op().smartolt.map(i => (i.id === actual.id ? nueva : i))
        registrarAccion(solicitud, 'smartolt.probar_instancia', { tipo: 'instancia_smartolt', id: actual.id }, {})
        const prueba: Schema<'PruebaInstanciaSmartOlt'> = { ok: !falla, latencia_ms: 212, error: nueva.prueba_error, instancia: nueva, vinculadas_por_nombre: vinculadas }
        return { status: 200, cuerpo: prueba }
    }),

    'POST /api/v1/integraciones/smartolt/olts/:id/vincular': conPermiso('smartolt.vincular_olt', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const id = idDe(solicitud)
        const instancia = op().smartolt.find(i => i.olts.some(o => o.id === id))
        if (!instancia || !visible(instancia, empresa.id)) {
            return noEncontrado('esa OLT de SmartOLT')
        }
        if (instancia.empresa_id === null && !alcanceGlobal(solicitud)) {
            return compartidaSinAlcance()
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const oltId = typeof cuerpo.olt_id === 'number' ? cuerpo.olt_id : null
        let olt: { id: number, nombre: string } | null = null
        if (oltId !== null) {
            const argos = bd.redAcceso.olts.find(o => o.id === oltId)
            if (!argos) {
                return noEncontrado('esa OLT de Argos')
            }
            if (argos.empresa_id !== null && instancia.empresa_id !== null && argos.empresa_id !== instancia.empresa_id) {
                return problemaTipado(422, 'olt_de_otra_empresa', 'Regla de negocio', 'Esa OLT de Argos es de otra empresa que la instancia de SmartOLT')
            }
            if (op().smartolt.some(i => i.olts.some(o => o.id !== id && o.olt?.id === oltId))) {
                return problemaTipado(409, 'olt_ya_vinculada', 'OLT ya ligada', 'Esa OLT de Argos ya está ligada a otra OLT de SmartOLT')
            }
            olt = { id: argos.id, nombre: argos.nombre }
        }
        let resultado: Schema<'OltSmartOlt'> | undefined
        op().smartolt = op().smartolt.map(i => (i.id !== instancia.id
            ? i
            : { ...i, olts: i.olts.map((o) => {
                    if (o.id !== id) {
                        return o
                    }
                    resultado = { ...o, olt }
                    return resultado
                }) }))
        registrarAccion(solicitud, 'smartolt.vincular_olt', { tipo: 'olt_smartolt', id: id! }, { olt_id: oltId })
        return { status: 200, cuerpo: resultado }
    }),

    'GET /api/v1/integraciones/acs': conPermiso('acs.ver', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        return empresa.ok ? { status: 200, cuerpo: vistaAcs(empresa.id) } : empresa.falla
    }),

    'PUT /api/v1/integraciones/acs': conPermiso('acs.configurar', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const actual = op().acs[empresa.id] ?? acsVacio(empresa.id)
        if (cuerpo.version !== actual.version) {
            return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', 'Otra persona cambió el ACS mientras lo editabas. Recarga para ver sus cambios.')
        }
        const errores: Errores = []
        let url = actual.url
        if (cuerpo.url !== undefined) {
            url = typeof cuerpo.url === 'string' && cuerpo.url.trim() ? cuerpo.url.trim() : null
            if (url && !/^https?:\/\/[^\s/]+/.test(url)) {
                errores.push({ field: 'url', rule: 'url', message: 'No es una URL válida' })
            }
        }
        const ca = typeof cuerpo.ca === 'string' ? cuerpo.ca.trim() : cuerpo.ca
        if (typeof ca === 'string' && ca && !ca.includes('BEGIN CERTIFICATE')) {
            errores.push({ field: 'ca', rule: 'formato', message: 'Pega el certificado en formato PEM' })
        }
        const activo = typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo
        if (activo && !url) {
            errores.push({ field: 'activo', rule: 'requerido', message: 'Para encender el ACS hace falta su URL' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const secretos = { ...(op().secretosAcs[empresa.id] ?? { clave: null, ca: null }) }
        if (cuerpo.clave !== undefined) {
            secretos.clave = typeof cuerpo.clave === 'string' && cuerpo.clave ? cuerpo.clave : null
        }
        if (ca !== undefined) {
            secretos.ca = typeof ca === 'string' && ca ? ca : null
        }
        const usuario = cuerpo.usuario === undefined ? actual.usuario : (typeof cuerpo.usuario === 'string' && cuerpo.usuario.trim() ? cuerpo.usuario.trim() : null)
        const cambiaPrueba = url !== actual.url || usuario !== actual.usuario || cuerpo.clave !== undefined || ca !== undefined
        op().acs[empresa.id] = {
            ...actual,
            activo,
            url,
            usuario,
            pppoe_por_acs: typeof cuerpo.pppoe_por_acs === 'boolean' ? cuerpo.pppoe_por_acs : actual.pppoe_por_acs,
            ...(cambiaPrueba ? { probado_en: null, prueba_ok: null, prueba_error: null, prueba_latencia_ms: null, probado_por: null } : {}),
            version: actual.version + 1,
        }
        op().secretosAcs[empresa.id] = secretos
        registrarAccion(solicitud, 'acs.configurar', { tipo: 'configuracion_acs', id: empresa.id }, { ...cuerpo, ...(cuerpo.clave ? { clave: '***' } : {}) })
        return { status: 200, cuerpo: vistaAcs(empresa.id) }
    }),

    'POST /api/v1/integraciones/acs/probar': conPermiso('acs.probar', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const actual = op().acs[empresa.id]
        if (!actual?.url) {
            const prueba: Schema<'PruebaAcs'> = { ok: false, latencia_ms: null, error: 'El ACS de la empresa no tiene URL guardada', config: vistaAcs(empresa.id) }
            return { status: 200, cuerpo: prueba }
        }
        const falla = actual.url.includes('falla')
        op().acs[empresa.id] = {
            ...actual,
            probado_en: ahora(),
            prueba_ok: !falla,
            prueba_error: falla ? 'GenieACS no respondió en 10 s' : null,
            prueba_latencia_ms: falla ? 10_000 : 180,
            probado_por: usuarioDe(solicitud)?.nombre ?? null,
        }
        registrarAccion(solicitud, 'acs.probar', { tipo: 'configuracion_acs', id: empresa.id }, {})
        const config = vistaAcs(empresa.id)
        const prueba: Schema<'PruebaAcs'> = { ok: !falla, latencia_ms: config.prueba_latencia_ms, error: config.prueba_error, config }
        return { status: 200, cuerpo: prueba }
    }),

    'GET /api/v1/servicios/:id/equipo/gestion': conPermiso('servicios.ver_equipo', (solicitud) => {
        const id = idDe(solicitud)
        const servicio = bd.servicios.find(s => s.id === id)
        if (!servicio) {
            return noEncontrado('ese servicio')
        }
        const empresaId = servicio.empresa_id
        const visibles = op().smartolt.filter(i => visible(i, empresaId))
        const cuentas = visibles.filter(operativa).map(i => ({ id: i.id, nombre: i.nombre }))
        const red = oltDelServicio(servicio.id)
        const ligada = red ? visibles.find(i => i.olts.some(o => o.olt?.id === red.olt.id)) : undefined
        const oltSmart = ligada?.olts.find(o => o.olt?.id === red?.olt.id) ?? null
        const instancia = ligada ?? (cuentas.length === 1 ? visibles.find(i => i.id === cuentas[0]!.id) : undefined)
        const origen: Schema<'GestionEquipo'>['smartolt']['origen'] = ligada ? 'olt' : cuentas.length === 0 ? 'ninguna' : cuentas.length === 1 ? 'unica' : 'sin_buscar'
        const acs = vistaAcs(empresaId)
        const plan = (servicio as { plan_id?: number }).plan_id ?? null
        const perfil = oltSmart?.perfiles.find(p => p.plan_id === plan) ?? oltSmart?.perfiles.find(p => p.plan_id === null) ?? null
        const unidad = bd.unidadesInventario.find(u => u.servicio_id === servicio.id && u.estado === 'en_comodato')
        const gestion: Schema<'GestionEquipo'> = {
            servicio_id: servicio.id,
            empresa_id: empresaId,
            smartolt: {
                disponible: cuentas.length > 0,
                origen,
                instancia: instancia ? { id: instancia.id, nombre: instancia.nombre, url: instancia.url, operativa: operativa(instancia), compartida: instancia.compartida } : null,
                cuentas,
                olt_argos: red?.olt ?? null,
                olt_smartolt: oltSmart ? { id: oltSmart.id, smartolt_olt_id: oltSmart.smartolt_olt_id, nombre: oltSmart.nombre } : null,
                puerto_pon: red?.puerto ?? null,
                perfil: perfil ? { authorization_preset_id: perfil.authorization_preset_id, pon_type: perfil.pon_type } : null,
            },
            acs: { configurado: acs.url !== null, activo: acs.activo, operativo: acs.operativo, pppoe_por_acs: acs.pppoe_por_acs },
            equipo: unidad && instancia
                ? { tipo: 'ont', serie: unidad.serie ?? null, mac: unidad.mac ?? null, modelo: null, onu_external_id: `argos${servicio.id}`, en_acs: acs.operativo }
                : null,
        }
        return { status: 200, cuerpo: gestion }
    }),

    'GET /api/v1/servicios/:id/equipo': conPermiso('servicios.ver_equipo', (solicitud) => {
        const id = idDe(solicitud)
        const servicio = bd.servicios.find(s => s.id === id)
        if (!servicio) {
            return noEncontrado('ese servicio')
        }
        const visibles = op().smartolt.filter(i => visible(i, servicio.empresa_id))
        const so = visibles.find(operativa)
        const acs = vistaAcs(servicio.empresa_id)
        if (!so && !acs.operativo) {
            return problemaTipado(409, 'equipo_sin_gestion', 'Equipo sin gestión', 'Argos no gestiona el equipo de este servicio por SmartOLT ni por el ACS (TR-069)')
        }
        const soCae = so?.url.includes('cae') ?? true
        const leido = ahora()
        const estado: Schema<'EstadoEquipo'> = {
            servicio_id: servicio.id,
            tecnologia: 'ftth',
            tipo: 'ont',
            serie: null,
            mac: null,
            modelo: 'ZTE F670L',
            en_linea: true,
            senal: soCae ? null : { rx_dbm: -21.4, tx_dbm: 2.1 },
            firmware: acs.operativo ? 'V3.1.2' : null,
            ultimo_contacto: leido,
            fuente: soCae ? 'acs' : 'smartolt',
            ssid: acs.operativo ? 'CASA_MENDEZ' : null,
            leido_en: leido,
        }
        return { status: 200, cuerpo: estado }
    }),
}
