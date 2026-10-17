/**
 * Rutas de la integración con Horus (A1 + A6) en modo fixtures. Se comportan como la API: el
 * conector apagado responde `horus_apagado` a "Ver en Horus" y `conector: apagado` a las lecturas;
 * los secretos vuelven como `***` y lo recién generado viene en claro una sola vez.
 */
import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { consulta360, seguridadDe } from './datos'

type Conector = Schema<'ConectorHorus'>

const aleatorio = (): string => Math.random().toString(36).slice(2, 14).padEnd(12, '0')

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}

function apagado(): RespuestaFixture {
    return problemaTipado(422, 'horus_apagado', 'Integración con Horus apagada', 'Activa el conector con Horus en Configuración → Integraciones')
}

/** Como `ConfigurarHorus` (A6): `version` obligatoria, secretos omitidos se conservan, `null` los borra. */
function guardar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const actual = bd.horus.conector
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    const url = 'url_base' in cuerpo ? texto(cuerpo.url_base) : actual.url_base
    if (url !== null && !/^https?:\/\//.test(url)) {
        return datosInvalidos([{ field: 'url_base', message: 'La URL de Horus debe empezar con https://', rule: 'url' }])
    }
    const tokenNuevo = 'token' in cuerpo ? texto(cuerpo.token) : null
    if (tokenNuevo !== null && !/^hf_pat_[A-Za-z0-9]{16,}$/.test(tokenNuevo)) {
        return datosInvalidos([{ field: 'token', message: 'El código de conexión de Horus empieza con hf_pat_', rule: 'formato' }])
    }
    const secreto = (campo: 'token' | 'webhook_salida_secreto'): '***' | null => {
        if (!(campo in cuerpo)) {
            return actual[campo]
        }
        return texto(cuerpo[campo]) ? '***' : null
    }
    const regenerar = cuerpo.regenerar_secreto_entrada === true || actual.webhook_entrada_secreto === null
    const nuevoSecreto = regenerar ? `whsec_fixture_${aleatorio()}` : null
    const activo = typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo
    if (activo && (url === null || secreto('token') === null)) {
        return datosInvalidos([{ field: 'activo', message: 'Para encender el conector hacen falta la URL de Horus y el código de conexión', rule: 'requerido' }])
    }
    const siguiente: Conector = {
        ...actual,
        activo,
        url_base: url,
        token: secreto('token'),
        webhook_salida_url: 'webhook_salida_url' in cuerpo ? texto(cuerpo.webhook_salida_url) : actual.webhook_salida_url,
        webhook_salida_secreto: secreto('webhook_salida_secreto'),
        webhook_entrada_secreto: '***',
        conector_id: actual.conector_id ?? `con_${aleatorio()}`,
        version: actual.version + 1,
    }
    bd.horus.conector = siguiente
    registrarAccion(solicitud, 'horus.configurar', { tipo: 'integracion', id: 1 }, { campos: Object.keys(cuerpo).filter(c => c !== 'version') })
    const guardado: Schema<'ConectorHorusGuardado'> = { ...siguiente, webhook_entrada_secreto_nuevo: nuevoSecreto }
    return { status: 200, cuerpo: guardado }
}

function nuevoToken(nombre: string): { token: string, datos: Schema<'TokenApi'> } {
    const datos: Schema<'TokenApi'> = {
        id: siguienteId(bd.horus.tokens),
        usuario_id: 900,
        nombre,
        alcances: { permisos: ['ip.resolver', 'clientes.ver', 'servicios.ver', 'sso.emitir'] },
        ultimo_uso: null,
        revocado_en: null,
        created_at: ahora(),
    }
    bd.horus.tokens.unshift(datos)
    return { token: `atk_fixture_${aleatorio()}${aleatorio()}`, datos }
}

/** Como `ConectarConEnlaceHorus`: 422 `enlace_vencido` (Horus 410), 502 `horus_error` si Horus falla. */
function conectar(solicitud: SolicitudFixture): RespuestaFixture {
    const enlace = texto(cuerpoObjeto(solicitud).enlace) ?? ''
    const partes = /^(https?:\/\/[^\s#]+)\/conectar#(\S+)$/.exec(enlace)
    if (!partes?.[1]) {
        return datosInvalidos([{ field: 'enlace', message: 'Se espera https://<horus>/conectar#<código>', rule: 'formato' }])
    }
    if (enlace.includes('vencido')) {
        return problemaTipado(422, 'enlace_vencido', 'Enlace de conexión vencido', 'Horus respondió 410: el código venció o ya se usó')
    }
    if (enlace.includes('caido')) {
        return problemaTipado(502, 'horus_error', 'Horus no respondió', 'connect ECONNREFUSED 10.0.0.9:443')
    }
    nuevoToken('Horus (enlace de conexión)')
    bd.horus.conector = {
        ...bd.horus.conector,
        url_base: partes[1],
        token: '***',
        webhook_salida_url: `${partes[1]}/api/v1/integrations/argosisp/webhook/con_${aleatorio()}`,
        webhook_salida_secreto: '***',
        webhook_entrada_secreto: '***',
        conector_id: bd.horus.conector.conector_id ?? `con_${aleatorio()}`,
        conectado_por_enlace_en: ahora(),
        activo: false,
        version: bd.horus.conector.version + 1,
    }
    registrarAccion(solicitud, 'horus.conectar_enlace', { tipo: 'integracion', id: 1 }, { url_horus: partes[1] })
    return { status: 200, cuerpo: bd.horus.conector }
}

function servicioDe(id: number): Schema<'Servicio'> | undefined {
    return bd.servicios.find(s => s.id === id)
}

export const rutasHorus: RutasFixture = {
    'GET /api/v1/integraciones/horus': conPermiso('horus.ver', () => ({ status: 200, cuerpo: bd.horus.conector })),
    'PUT /api/v1/integraciones/horus': conPermiso('horus.configurar', guardar),

    'POST /api/v1/integraciones/horus/probar': conPermiso('horus.probar', () => {
        const conector = bd.horus.conector
        const ok = conector.url_base !== null && conector.token !== null
        const prueba: Schema<'ResultadoPruebaHorus'> = {
            ok,
            probado_en: ahora(),
            api: ok ? { ok: true, status: 200, latencia_ms: 42, error: null } : { ok: false, status: null, latencia_ms: null, error: 'Falta la URL de Horus o el código de conexión' },
            webhook: conector.webhook_salida_url ? { ok, status: ok ? 200 : null, error: ok ? null : 'Sin secreto del receptor de Horus' } : null,
        }
        bd.horus.conector = { ...conector, ultima_prueba: { en: prueba.probado_en, ok, error: prueba.api.error } }
        return { status: 200, cuerpo: prueba }
    }),

    'POST /api/v1/integraciones/horus/enlace': conPermiso('horus.configurar', (solicitud) => {
        registrarAccion(solicitud, 'horus.generar_enlace', { tipo: 'integracion', id: 1 }, {})
        const enlace: Schema<'EnlaceConexionHorus'> = {
            enlace: `http://localhost:3333/conectar#${aleatorio()}${aleatorio()}${aleatorio()}`,
            vence_en: new Date(Date.now() + 15 * 60_000).toISOString(),
        }
        return { status: 201, cuerpo: enlace }
    }),
    'POST /api/v1/integraciones/horus/conexion/conectar': conPermiso('horus.configurar', conectar),

    'GET /api/v1/integraciones/horus/tokens': conPermiso('horus.ver', () => ({ status: 200, cuerpo: bd.horus.tokens })),
    'POST /api/v1/integraciones/horus/tokens': conPermiso('horus.generar_token', (solicitud) => {
        const nombre = texto(cuerpoObjeto(solicitud).nombre) ?? 'Horus'
        const { token, datos } = nuevoToken(nombre)
        registrarAccion(solicitud, 'horus.generar_token', { tipo: 'token_api', id: datos.id }, { nombre, token: '***' })
        const creado: Schema<'TokenHorusCreado'> = { token, datos, usuario_id: 900 }
        return { status: 201, cuerpo: creado }
    }),
    'POST /api/v1/integraciones/horus/tokens/:id/revocar': conPermiso('horus.revocar_token', (solicitud) => {
        const token = bd.horus.tokens.find(t => t.id === idDe(solicitud))
        if (!token) {
            return noEncontrado('ese token')
        }
        token.revocado_en ??= ahora()
        registrarAccion(solicitud, 'horus.revocar_token', { tipo: 'token_api', id: token.id }, {})
        return { status: 200, cuerpo: token }
    }),

    'POST /api/v1/integraciones/horus/abrir': conPermiso('horus.abrir', (solicitud) => {
        if (!bd.horus.conector.activo) {
            return apagado()
        }
        const destino = cuerpoObjeto(solicitud).destino
        const tipo = typeof destino === 'object' && destino !== null && 'tipo' in destino ? String(destino.tipo) : ''
        const id = typeof destino === 'object' && destino !== null && 'id_externo' in destino ? String(destino.id_externo) : ''
        if (!['cliente', 'servicio', 'router', 'hallazgo'].includes(tipo) || id === '') {
            return datosInvalidos([{ field: 'destino.tipo', message: 'Destino inválido', rule: 'enum' }])
        }
        const ticket: Schema<'TicketHorus'> = {
            url: `https://horus.example.test/sso/entrar#tkt_${tipo}_${encodeURIComponent(id)}_${aleatorio()}`,
            expira_en: new Date(Date.now() + 60_000).toISOString(),
        }
        return { status: 200, cuerpo: ticket }
    }),

    'GET /api/v1/servicios/:id/horus': conPermiso('horus.ver', (solicitud) => {
        const servicio = servicioDe(idDe(solicitud) ?? 0)
        if (!servicio) {
            return noEncontrado('ese servicio')
        }
        if (!bd.horus.conector.activo) {
            const apagada: Schema<'Horus360Servicio'> = { servicio_id: servicio.id, conector: 'apagado', stale: false, actualizado_en: null, error: null, consulta: null, ip: servicio.ipv4 ?? null, datos: null, eventos_recientes: [] }
            return { status: 200, cuerpo: apagada }
        }
        return { status: 200, cuerpo: consulta360(servicio.id, servicio.ipv4 ?? null) }
    }),

    'POST /api/v1/integraciones/horus/seguridad': conPermiso('horus.ver', (solicitud) => {
        const ids = cuerpoObjeto(solicitud).servicio_ids
        const lista = Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
        if (lista.length === 0 || lista.length > 500) {
            return datosInvalidos([{ field: 'servicio_ids', message: 'De 1 a 500 servicios', rule: 'array' }])
        }
        const activo = bd.horus.conector.activo
        const respuesta: Schema<'SeguridadHorus'> = {
            conector: activo ? 'activo' : 'apagado',
            stale: false,
            actualizado_en: activo ? ahora() : null,
            error: null,
            modo: activo ? 'lotes' : null,
            items: activo ? lista.map(seguridadDe) : [],
        }
        return { status: 200, cuerpo: respuesta }
    }),

    'GET /api/v1/me/vinculaciones': (solicitud) => {
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (!usuario) {
            return problemaTipado(401, 'no_autenticado', 'Sin sesión')
        }
        return { status: 200, cuerpo: bd.horus.vinculaciones.filter(v => v.usuario_id === usuario.id && v.revocada_en === null) }
    },
    'POST /api/v1/me/vinculaciones/:id/quitar': (solicitud) => {
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (!usuario) {
            return problemaTipado(401, 'no_autenticado', 'Sin sesión')
        }
        const vinculacion = bd.horus.vinculaciones.find(v => v.id === idDe(solicitud) && v.usuario_id === usuario.id)
        if (!vinculacion) {
            return noEncontrado('esa vinculación')
        }
        vinculacion.revocada_en ??= ahora()
        registrarAccion(solicitud, 'vinculaciones.quitar', { tipo: 'usuario', id: usuario.id }, { vinculacion_id: vinculacion.id })
        return { status: 200, cuerpo: vinculacion }
    },
    'POST /api/v1/vinculaciones/revocar': conPermiso('vinculaciones.revocar', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const vigentes = bd.horus.vinculaciones.filter(v => v.revocada_en === null
            && (typeof cuerpo.usuario_id !== 'number' || v.usuario_id === cuerpo.usuario_id)
            && (typeof cuerpo.conector !== 'string' || v.conector === cuerpo.conector))
        const momento = ahora()
        for (const vinculacion of vigentes) {
            vinculacion.revocada_en = momento
        }
        registrarAccion(solicitud, 'vinculaciones.revocar', { tipo: 'usuario', id: 0 }, cuerpo)
        const respuesta: Schema<'RevocacionVinculaciones'> = { revocadas: vigentes.length }
        return { status: 200, cuerpo: respuesta }
    }),
}
