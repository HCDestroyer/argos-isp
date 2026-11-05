/**
 * Rutas del conector con Iris (A1 + A6) en modo fixtures. Se comportan como la API: `version`
 * obligatoria (409 si cambió), secretos como `***`, encender exige URL y token `iris_pat_` (422),
 * el enlace y el token `atk_` vienen en claro una sola vez.
 */
import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { conectorIrisAnterior063, conectorIrisCanjeConfirmado, conectorIrisCanjePendiente, conectorIrisDesconectado, conectorIrisPorReconectar, ORIGENES_IRIS_FIXTURES, PLAZO_CONFIRMAR_CANJE_IRIS_FIXTURE_MS } from './datos'

type Conector = Schema<'ConectorIris'>

/**
 * Clave de `localStorage` para Playwright: si existe, `GET /integraciones/iris` toma el conector que
 * Iris informó sin el receptor de Argos (`requiere_reconectar: true`, contrato 0.6.2).
 */
export const CLAVE_IRIS_RECONECTAR = 'argos_fixtures_iris_reconectar'

function reconexionPedida(): boolean {
    try {
        return (globalThis.localStorage?.getItem(CLAVE_IRIS_RECONECTAR) ?? null) !== null
    }
    catch {
        return false
    }
}

/**
 * Clave de `localStorage` para Playwright (contrato Iris 0.6.3): su valor elige el estado del canje
 * con que `GET /integraciones/iris` toma el conector: `pendiente`, `confirmado`,
 * `revocado_por_iris`, `canje_sin_uso` o `anterior` (API anterior a 0.6.3, sin los campos).
 */
export const CLAVE_IRIS_CANJE = 'argos_fixtures_iris_canje'

const ESCENARIOS_CANJE: Record<string, () => Conector> = {
    pendiente: () => conectorIrisCanjePendiente(new Date(Date.now() - 2 * 60 * 60_000)),
    confirmado: () => conectorIrisCanjeConfirmado(new Date(Date.now() - 2 * 60 * 60_000)),
    revocado_por_iris: () => conectorIrisDesconectado('revocado_por_iris', new Date(Date.now() - 30 * 60_000)),
    canje_sin_uso: () => conectorIrisDesconectado('canje_sin_uso', new Date(Date.now() - 30 * 60_000)),
    anterior: () => conectorIrisAnterior063(),
}

function escenarioCanje(): (() => Conector) | null {
    try {
        const valor = globalThis.localStorage?.getItem(CLAVE_IRIS_CANJE) ?? null
        return valor === null ? null : (ESCENARIOS_CANJE[valor] ?? null)
    }
    catch {
        return null
    }
}

/** Lo que responde `GET /integraciones/iris`; con una clave, el conector de ese escenario (una vez). */
function leerConector(): Conector {
    if (bd.iris.conector.version === 0) {
        const escenario = escenarioCanje()
        if (escenario) {
            bd.iris.conector = escenario()
        }
        else if (reconexionPedida() && !bd.iris.conector.requiere_reconectar) {
            bd.iris.conector = structuredClone(conectorIrisPorReconectar)
        }
    }
    return bd.iris.conector
}

/**
 * 0.6.3, como `ConfigurarIris`: encender un conector desconectado lo saca de ese estado. El estado
 * del canje sale como en `estadoCanjeIris` de la API: si el `atk_` nunca se usó (`canje_sin_uso`),
 * vuelve a pendiente con el vencimiento ya pasado; con `revocado_por_iris` Iris sí lo usó (para
 * revocarlo) y el barrido lo da por confirmado.
 */
function salirDeDesconexion(actual: Conector): Pick<Conector, 'estado_canje' | 'canje_vence_en' | 'desconectado_en' | 'motivo_desconexion'> {
    if (actual.motivo_desconexion === 'canje_sin_uso' && actual.conectado_por_enlace_en) {
        const vence = new Date(new Date(actual.conectado_por_enlace_en).getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_FIXTURE_MS)
        return { estado_canje: 'pendiente', canje_vence_en: vence.toISOString(), desconectado_en: null, motivo_desconexion: null }
    }
    return { estado_canje: actual.conectado_por_enlace_en ? 'confirmado' : null, canje_vence_en: null, desconectado_en: null, motivo_desconexion: null }
}

/** Los permisos de §1.1 del contrato que existen en Argos (rol `integracion_iris`). */
const PERMISOS_IRIS: NonNullable<Schema<'TokenApi'>['alcances']['permisos']> = [
    'clientes.ver', 'clientes.estado_cuenta', 'servicios.ver', 'planes.ver', 'routers.ver', 'zonas.ver', 'ip.resolver', 'inventario.ver',
    'servicios.activar_instalacion', 'servicios.retirar', 'clientes.crear', 'servicios.crear', 'facturas.emitir_cargo_unico', 'sso.emitir',
]

const aleatorio = (): string => Math.random().toString(36).slice(2, 14).padEnd(12, '0')

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}

/** Como `ConfigurarIris` (A1). */
function guardar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const actual = bd.iris.conector
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    const errores: NonNullable<Schema<'Problem'>['errors']> = []
    const url = 'url_base' in cuerpo ? texto(cuerpo.url_base) : actual.url_base
    if ('url_base' in cuerpo && url !== null && !/^https?:\/\/[^/\s]+$/.test(url.replace(/\/$/, ''))) {
        errores.push({ field: 'url_base', message: 'La URL de Iris es solo el origen: https://host[:puerto]', rule: 'url' })
    }
    const tokenNuevo = 'token' in cuerpo ? texto(cuerpo.token) : null
    if (tokenNuevo !== null && !/^iris_pat_[A-Za-z0-9]{16,}$/.test(tokenNuevo)) {
        errores.push({ field: 'token', message: 'El token de Iris empieza con iris_pat_', rule: 'formato' })
    }
    const receptor = 'webhook_salida_url' in cuerpo ? texto(cuerpo.webhook_salida_url) : actual.webhook_salida_url
    if ('webhook_salida_url' in cuerpo && receptor !== null && !/^https?:\/\/\S+$/.test(receptor)) {
        errores.push({ field: 'webhook_salida_url', message: 'El receptor de Iris debe empezar con https://', rule: 'url' })
    }
    const secretoNuevo = 'webhook_salida_secreto' in cuerpo ? texto(cuerpo.webhook_salida_secreto) : null
    if (secretoNuevo !== null && secretoNuevo.length < 16) {
        errores.push({ field: 'webhook_salida_secreto', message: 'El secreto del receptor de Iris tiene al menos 16 caracteres', rule: 'minLength' })
    }
    const secreto = (campo: 'token' | 'webhook_salida_secreto'): '***' | null => {
        if (!(campo in cuerpo)) {
            return actual[campo]
        }
        return texto(cuerpo[campo]) ? '***' : null
    }
    const activo = typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo
    if (activo && (url === null || secreto('token') === null)) {
        errores.push({ field: 'activo', message: 'Para encender el conector hacen falta la URL de Iris y su token', rule: 'requerido' })
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const siguiente: Conector = {
        ...actual,
        activo,
        url_base: url ? url.replace(/\/$/, '') : null,
        token: secreto('token'),
        webhook_salida_url: receptor,
        webhook_salida_secreto: secreto('webhook_salida_secreto'),
        ...(cuerpo.activo === true && actual.desconectado_en ? salirDeDesconexion(actual) : {}),
        version: actual.version + 1,
    }
    bd.iris.conector = siguiente
    registrarAccion(solicitud, 'iris.configurar', { tipo: 'integracion', id: 2 }, { campos: Object.keys(cuerpo).filter(c => c !== 'version') })
    return { status: 200, cuerpo: siguiente }
}

function resumen(): Schema<'ResumenEnviosIris'> {
    const { conector, envios, tokens } = bd.iris
    const conError = envios
        .filter(e => (e.estado === 'pendiente' || e.estado === 'fallido') && e.ultimo_error !== null)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id)[0]
    const enviados = envios.map(e => e.enviado_en).filter((en): en is string => en !== null).sort()
    return {
        destino_configurado: conector.activo && conector.webhook_salida_url !== null && conector.webhook_salida_secreto !== null,
        // El usuario técnico Iris nace con el primer token; los fixtures le dan alcance global.
        alcance: tokens.length ? { global: true, empresas: [] } : null,
        pendientes: envios.filter(e => e.estado === 'pendiente').length,
        fallidos: envios.filter(e => e.estado === 'fallido').length,
        ultimo_enviado_en: enviados.at(-1) ?? null,
        ultimo_fallo: conError && (conError.estado === 'pendiente' || conError.estado === 'fallido')
            ? { evento_id: conError.evento_id, evento: conError.evento, estado: conError.estado, intentos: conError.intentos, ultimo_error: conError.ultimo_error, en: conError.updated_at }
            : null,
    }
}

/** Como `normalizarOrigenIris` de la API, sin `IRIS_PERMITIR_HTTP`: solo `https://host[:puerto]`. */
function normalizarOrigen(valor: string): { origen: string, host: string } | { error: string } {
    let url: URL
    try {
        url = new URL(valor.trim())
    }
    catch {
        return { error: 'No es una URL válida' }
    }
    if (url.protocol !== 'https:') {
        return { error: 'Solo https:// (http:// solo en laboratorio con IRIS_PERMITIR_HTTP)' }
    }
    if (url.username || url.password) {
        return { error: 'La URL no lleva usuario ni contraseña' }
    }
    if (url.search || url.hash || valor.includes('#') || valor.includes('?')) {
        return { error: 'La URL no lleva consulta ni fragmento' }
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        return { error: 'Se espera el origen de Iris (https://host[:puerto]), sin ruta' }
    }
    return { origen: url.origin, host: url.host }
}

function origenInvalido(detalle: string): RespuestaFixture {
    return problemaTipado(422, 'iris_origen_invalido', 'Origen de Iris inválido', detalle, [{ field: 'iris', message: detalle, rule: 'origen' }])
}

/** Conocido: el origen de la URL del conector o uno de `ORIGENES_IRIS_FIXTURES`. */
function origenConocido(origen: string): boolean {
    const { url_base } = bd.iris.conector
    if (ORIGENES_IRIS_FIXTURES.includes(origen)) {
        return true
    }
    try {
        return url_base !== null && new URL(url_base).origin === origen
    }
    catch {
        return false
    }
}

/** `empresasDelAlcance` del usuario técnico Iris (si no existe, nacerá global con las activas). */
function empresasIris(): Pick<Schema<'VistaPreviaAutorizacionIris'>, 'alcance_global' | 'empresas'> {
    const alcance = bd.iris.alcanceUsuario ?? { global: true, empresas: bd.empresas.filter(e => e.activa).map(e => e.id) }
    const ids = alcance.global ? bd.empresas.filter(e => e.activa).map(e => e.id) : alcance.empresas
    return {
        alcance_global: alcance.global,
        empresas: bd.empresas
            .filter(e => e.activa && ids.includes(e.id))
            .sort((a, b) => a.id - b.id)
            .map(e => ({ id: e.id, nombre: e.nombre_comercial, nit: e.nit })),
    }
}

/** Como `AutorizarIris` (A1): valida, crea el código ligado al challenge y arma la vuelta a Iris. */
function autorizar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const iris = typeof cuerpo.iris === 'string' ? cuerpo.iris : ''
    const state = typeof cuerpo.state === 'string' ? cuerpo.state : ''
    if (!/^[A-Za-z0-9._~-]{16,256}$/.test(state)) {
        return problemaTipado(422, 'validacion', 'Datos inválidos', 'Revisa los campos marcados.', [{ field: 'state', message: 'El state de Iris tiene de 16 a 256 caracteres A-Z a-z 0-9 . _ ~ -', rule: 'regex' }])
    }
    const normal = normalizarOrigen(iris)
    if ('error' in normal) {
        return origenInvalido(normal.error)
    }
    const challenge = typeof cuerpo.code_challenge === 'string' ? cuerpo.code_challenge : ''
    if (cuerpo.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
        const detalle = 'code_challenge debe ser base64url de 43 caracteres (SHA-256 del code_verifier, S256)'
        return problemaTipado(422, 'code_challenge_invalido', 'code_challenge inválido', detalle, [{ field: 'code_challenge', message: detalle, rule: 'formato' }])
    }
    const conocido = origenConocido(normal.origen)
    const confirmar = typeof cuerpo.confirmar_origen === 'string' ? cuerpo.confirmar_origen.trim().toLowerCase() : ''
    if (!conocido && confirmar !== normal.host.toLowerCase()) {
        const detalle = `Iris en ${normal.host} no es un origen conocido: escribe su dominio (${normal.host}) para confirmar`
        return problemaTipado(422, 'iris_origen_no_confirmado', 'Confirma el origen de Iris', detalle, [{ field: 'confirmar_origen', message: detalle, rule: 'confirmar' }])
    }
    const codigo = `${aleatorio()}${aleatorio()}${aleatorio()}`
    registrarAccion(solicitud, 'iris.autorizar', { tipo: 'integracion', id: 2 }, { iris: normal.origen, origen_conocido: conocido, codigo: '***' })
    const respuesta: Schema<'AutorizacionIris'> = {
        redirigir_a: `${normal.origen}/administracion/integraciones/argos/vuelta#codigo=${encodeURIComponent(codigo)}&api=${encodeURIComponent('http://localhost:3333')}&state=${encodeURIComponent(state)}`,
    }
    return { status: 200, cuerpo: respuesta }
}

export const rutasIris: RutasFixture = {
    'GET /api/v1/integraciones/iris/autorizar/vista-previa': conPermiso('iris.configurar', (solicitud) => {
        const normal = normalizarOrigen(solicitud.query.get('iris') ?? '')
        if ('error' in normal) {
            return origenInvalido(normal.error)
        }
        const vista: Schema<'VistaPreviaAutorizacionIris'> = {
            origen_normalizado: normal.origen,
            origen_conocido: origenConocido(normal.origen),
            ...empresasIris(),
        }
        return { status: 200, cuerpo: vista }
    }),
    'POST /api/v1/integraciones/iris/autorizar': conPermiso('iris.configurar', autorizar),

    'GET /api/v1/integraciones/iris': conPermiso('iris.ver', () => ({ status: 200, cuerpo: leerConector() })),
    'GET /api/v1/integraciones/iris/estado': conPermiso('iris.abrir', () => {
        const { activo, url_base, token } = bd.iris.conector
        // fuera de una imagen publicada la API responde `version_argos: 'desarrollo'` (contrato Iris 0.5.0)
        const estado: Schema<'EstadoConectorIris'> = {
            activo: activo && url_base !== null && token !== null,
            version_argos: 'desarrollo',
            contrato: '0.5.0',
        }
        return { status: 200, cuerpo: estado }
    }),
    'PUT /api/v1/integraciones/iris': conPermiso('iris.configurar', guardar),

    'POST /api/v1/integraciones/iris/enlace': conPermiso('iris.configurar', (solicitud) => {
        registrarAccion(solicitud, 'iris.generar_enlace', { tipo: 'integracion', id: 2 }, {})
        const enlace: Schema<'EnlaceConexionIris'> = {
            enlace: `http://localhost:3333/conectar#${aleatorio()}${aleatorio()}${aleatorio()}`,
            vence_en: new Date(Date.now() + 15 * 60_000).toISOString(),
        }
        return { status: 201, cuerpo: enlace }
    }),

    'GET /api/v1/integraciones/iris/tokens': conPermiso('iris.ver', () => ({ status: 200, cuerpo: bd.iris.tokens })),
    'POST /api/v1/integraciones/iris/tokens': conPermiso('iris.generar_token', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const conLista = (campo: string) => Array.isArray(cuerpo[campo]) && (cuerpo[campo] as unknown[]).length > 0
        if (conLista('routers') || conLista('zonas')) {
            return datosInvalidos([{ field: conLista('routers') ? 'routers' : 'zonas', message: 'El usuario técnico Iris solo tiene alcance por empresas', rule: 'usuario_tecnico_solo_empresas' }])
        }
        const nombre = texto(cuerpo.nombre) ?? 'Iris'
        const datos: Schema<'TokenApi'> = {
            id: siguienteId(bd.iris.tokens),
            usuario_id: 901,
            nombre,
            alcances: { permisos: PERMISOS_IRIS },
            ultimo_uso: null,
            revocado_en: null,
            created_at: ahora(),
        }
        bd.iris.tokens.unshift(datos)
        registrarAccion(solicitud, 'iris.generar_token', { tipo: 'token_api', id: datos.id }, { nombre, token: '***' })
        const creado: Schema<'TokenIrisCreado'> = { token: `atk_fixture_${aleatorio()}${aleatorio()}`, datos, usuario_id: 901 }
        return { status: 201, cuerpo: creado }
    }),
    'POST /api/v1/integraciones/iris/tokens/:id/revocar': conPermiso('iris.revocar_token', (solicitud) => {
        const token = bd.iris.tokens.find(t => t.id === idDe(solicitud))
        if (!token) {
            return noEncontrado('ese token')
        }
        token.revocado_en ??= ahora()
        registrarAccion(solicitud, 'iris.revocar_token', { tipo: 'token_api', id: token.id }, {})
        return { status: 200, cuerpo: token }
    }),

    'GET /api/v1/integraciones/iris/envios': conPermiso('iris.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const evento = solicitud.query.get('evento')
        const filas = [...bd.iris.envios]
            .sort((a, b) => b.id - a.id)
            .filter(e => (!estado || e.estado === estado) && (!evento || e.evento === evento))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'GET /api/v1/integraciones/iris/envios/resumen': conPermiso('iris.ver', () => ({ status: 200, cuerpo: resumen() })),
}
