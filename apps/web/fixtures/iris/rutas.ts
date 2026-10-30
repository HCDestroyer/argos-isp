/**
 * Rutas del conector con Iris (A1 + A6) en modo fixtures. Se comportan como la API: `version`
 * obligatoria (409 si cambió), secretos como `***`, encender exige URL y token `iris_pat_` (422),
 * el enlace y el token `atk_` vienen en claro una sola vez.
 */
import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, registrarAccion, versionCambiada } from '../comun'

type Conector = Schema<'ConectorIris'>

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

export const rutasIris: RutasFixture = {
    'GET /api/v1/integraciones/iris': conPermiso('iris.ver', () => ({ status: 200, cuerpo: bd.iris.conector })),
    'GET /api/v1/integraciones/iris/estado': conPermiso('iris.abrir', () => {
        const { activo, url_base, token } = bd.iris.conector
        const estado: Schema<'EstadoConectorIris'> = { activo: activo && url_base !== null && token !== null }
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
