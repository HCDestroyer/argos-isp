import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { diagnosticoCorte } from './estrategias'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion } from '../comun'

/**
 * Conexión de routers por WireGuard, como `contratos/conexion-routers.md` §7 (A1): estado del túnel,
 * script de conexión (`text/plain`), clave pegada a mano, rotar, probar conexión y reconciliar.
 *
 * En los fixtures: RB-Centro (1) está conectado, CCR-Mixco (2) tiene un script generado sin
 * registrar y su www-ssl sin certificado («Probar conexión» → `sin_certificado`) y RB-Bodega (3) está sin configurar y sin secreto RADIUS (422 `radius_secret_requerido`).
 * «Incluir configuración de servicio» responde 422 `servicio_incompleto` salvo en RB-Centro.
 */

type Conexion = Schema<'ConexionRouter'>

const CLAVE_WG = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/
const IP_O_RED = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\/([0-9]|[12][0-9]|3[0-2]))?$/
const FALTAN_SERVICIO = ['ROUTERS_SERVICIO_WAN_INTERFAZ', 'ROUTERS_SERVICIO_POOL_PPPOE', 'ROUTERS_SERVICIO_PREFIJO_V6']

function conexionDe(routerId: number): Conexion {
    let conexion = bd.conexionesRouter.find(c => c.router_id === routerId)
    if (!conexion) {
        conexion = { router_id: routerId, estado: 'sin_configurar', ip_tunel: null, public_key: null, ultimo_handshake: null, handshake_reciente: false, registrado_en: null, routeros_version: null, token_vence: null, version: 0 }
        bd.conexionesRouter.push(conexion)
    }
    return conexion
}

function siguienteIpTunel(): string {
    const usadas = new Set(bd.conexionesRouter.map(c => c.ip_tunel))
    for (let n = 2; n < 65_000; n++) {
        const ip = `10.255.${Math.floor(n / 256)}.${n % 256}`
        if (!usadas.has(ip)) {
            return ip
        }
    }
    return '10.255.255.254'
}

/** Los comandos de `comandosCertificado` de A1 (`diagnostico_routeros.ts`). */
function comandosCertificado(host: string): string {
    const san = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? `IP:${host}` : `DNS:${host}`
    return [
        '/certificate add name=argos-ca common-name=argos-ca key-usage=key-cert-sign,crl-sign days-valid=3650',
        '/certificate sign argos-ca',
        `/certificate add name=argosisp-api common-name=${host} subject-alt-name=${san} key-usage=digital-signature,key-encipherment,tls-server days-valid=3650`,
        '/certificate sign argosisp-api ca=argos-ca',
        '/ip service set www-ssl certificate=argosisp-api disabled=no',
    ].join('\n')
}

/** Script de muestra: la API arma el real con las plantillas de A6; aquí solo lo que el panel muestra. */
function script(router: Schema<'Router'>, conexion: Conexion, admin: string[], servicio: boolean): string {
    return [
        `# ArgosIsp · conexión de ${router.nombre} (router ${router.id})`,
        '# Lleva claves: no lo guardes ni lo mandes por chat. Vale 24 horas y para un solo registro.',
        ':if ([:pick [/system resource get version] 0 1] != "7") do={ :error "argosisp: se requiere RouterOS 7" }',
        `:local argosIpTunel "${conexion.ip_tunel}"`,
        ':local argosToken "tok-fixture-0000000000000000"',
        ':local argosApiClave "clave-de-prueba-0000000000000000"',
        `/interface list add name=argosisp-admin comment="argosisp: ${admin.join(',') || 'solo tunel'}"`,
        ...(servicio ? ['/ppp profile add name=argosisp-default comment="argosisp: servicio"'] : []),
        ':put "argosisp: listo"',
        '',
    ].join('\n')
}

function generar(solicitud: SolicitudFixture, accion: 'routers.generar_script' | 'routers.rotar_conexion'): RespuestaFixture {
    const router = bd.routers.find(r => r.id === idDe(solicitud))
    if (!router) {
        return noEncontrado('el router')
    }
    const admin = (solicitud.query.get('admin') ?? '').split(',').map(a => a.trim()).filter(Boolean)
    const malas = admin.filter(a => !IP_O_RED.test(a))
    if (malas.length) {
        return datosInvalidos([{ field: 'admin', message: `No son IPv4 ni redes: ${malas.join(', ')}`, rule: 'ipv4' }])
    }
    if (!router.tiene_radius_secret || router.id === 3) {
        return problemaTipado(422, 'radius_secret_requerido', 'Falta el secreto RADIUS', 'Define el secreto RADIUS del router (de 16 a 128 caracteres, sin espacios) en «Editar» antes de generar el script')
    }
    const servicio = solicitud.query.get('incluir') === 'servicio'
    if (servicio && router.id !== 1) {
        return problemaTipado(422, 'servicio_incompleto', 'Faltan datos de la red de clientes', `Para incluir la configuración de servicio faltan ${FALTAN_SERVICIO.length} datos en el servidor`, FALTAN_SERVICIO.map(nombre => ({ field: 'incluir', message: nombre, rule: 'requerido' })))
    }
    const conexion = conexionDe(router.id)
    const vence = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    if (accion === 'routers.rotar_conexion') {
        Object.assign(conexion, { public_key: null, ultimo_handshake: null, handshake_reciente: false, registrado_en: null })
    }
    Object.assign(conexion, {
        ip_tunel: conexion.ip_tunel ?? siguienteIpTunel(),
        estado: conexion.public_key ? conexion.estado : 'pendiente',
        token_vence: vence,
        version: conexion.version + 1,
    })
    registrarAccion(solicitud, accion, { tipo: 'router', id: router.id }, { admin, incluir: servicio ? 'servicio' : null })
    return { status: 200, cuerpo: new TextEncoder().encode(script(router, conexion, admin, servicio)), contentType: 'text/plain; charset=utf-8', headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="argosisp-conexion.rsc"' } }
}

function prueba(router: Schema<'Router'>): Schema<'PruebaConexion'> {
    const conexion = bd.conexionesRouter.find(c => c.router_id === router.id)
    const chequeos: Schema<'ChequeoConexion'>[] = []
    if (conexion && conexion.estado !== 'sin_configurar') {
        const ok = conexion.estado === 'conectado' && conexion.handshake_reciente
        chequeos.push({
            clave: 'tunel',
            ok,
            ms: 0,
            detalle: ok
                ? `Túnel activo (${conexion.ip_tunel}); último handshake ${conexion.ultimo_handshake}`
                : conexion.public_key === null ? 'El router todavía no registró su clave pública: ejecuta el script de conexión' : 'El servidor todavía no vio ningún handshake del router',
        })
    }
    if (router.id === 1) {
        chequeos.push(
            { clave: 'api', ok: true, ms: 42, motivo: null, detalle: `La API REST respondió en ${router.host}` },
            { clave: 'equipo', ok: true, ms: 0, datos: { version: '7.24.5 (stable)', modelo: 'RB5009UG+S+', uptime: '12d4h31m', cpu_pct: 7 }, detalle: 'RouterOS 7.24.5 (stable) · RB5009UG+S+ · encendido 12d4h31m · CPU 7 %' },
            { clave: 'radius', ok: true, ms: 18, datos: { direcciones: ['10.255.0.1'], esperadas: ['10.255.0.1'], secreto_verificado: false }, detalle: 'RADIUS hacia 10.255.0.1. El secreto no se pudo verificar (el usuario de la API no puede leerlo sin la política sensitive)' },
        )
        // A2 (§10.2): con la API respondiendo, el chequeo `corte` con el diagnóstico completo.
        const corte = diagnosticoCorte(router)
        chequeos.push({
            clave: 'corte',
            ok: corte.ok,
            ms: 210,
            detalle: corte.ok ? 'Un suspendido de este router ve la página de corte.' : `Un suspendido de este router no vería la página de corte: ${corte.problemas.map(p => p.mensaje).join(' ')}`,
            corte,
        })
    }
    else if (!router.api_usuario || !router.tiene_api_password) {
        chequeos.push(
            { clave: 'api', ok: false, ms: 0, motivo: 'sin_credenciales', detalle: 'El router no tiene usuario y clave de la API REST' },
            { clave: 'equipo', ok: null, ms: 0, datos: null, detalle: 'Sin datos del equipo: la API no respondió' },
            { clave: 'radius', ok: null, ms: 0, detalle: 'No se pudo leer /radius: la API no respondió' },
        )
    }
    else {
        chequeos.push(
            // CCR-Mixco: www-ssl sin certificado (caso real del PM, 29 oct), con el texto de `diagnostico_routeros.ts`.
            { clave: 'api', ok: false, ms: 38, motivo: 'sin_certificado', datos: { error_tecnico: 'C0D7A1E3B87F0000:error:0A000410:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:1605:SSL alert number 40' }, detalle: `El router no tiene certificado en www-ssl, así que no puede hacer HTTPS. En el router (New Terminal):\n${comandosCertificado(router.host)}` },
            { clave: 'equipo', ok: null, ms: 0, datos: null, detalle: 'Sin datos del equipo: la API no respondió' },
            { clave: 'radius', ok: null, ms: 0, detalle: 'No se pudo leer /radius: la API no respondió' },
        )
    }
    return { router_id: router.id, ok: chequeos.length > 0 && chequeos.every(c => c.ok === true), probado_en: ahora(), chequeos }
}

export const rutasConexionRouters: RutasFixture = {
    'GET /api/v1/routers/:id/conexion': conPermiso('routers.ver', (solicitud) => {
        const id = idDe(solicitud)
        return id !== null && bd.routers.some(r => r.id === id) ? { status: 200, cuerpo: conexionDe(id) } : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/script-conexion': conPermiso('routers.generar_script', solicitud => generar(solicitud, 'routers.generar_script')),

    'POST /api/v1/routers/:id/conexion/rotar': conPermiso('routers.rotar_conexion', solicitud => generar(solicitud, 'routers.rotar_conexion')),

    'POST /api/v1/routers/:id/conexion/clave': conPermiso('routers.conexion_clave', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const clave = String(cuerpoObjeto(solicitud).public_key ?? '').trim()
        if (!CLAVE_WG.test(clave)) {
            return datosInvalidos([{ field: 'public_key', message: 'La clave pública de WireGuard tiene 44 caracteres y termina en =', rule: 'regex' }])
        }
        const conexion = conexionDe(router.id)
        if (conexion.estado === 'sin_configurar' || !conexion.ip_tunel) {
            return problemaTipado(422, 'script_no_generado', 'Primero genera el script', 'Genera el script de conexión antes de pegar la clave: así el router tiene su IP del túnel')
        }
        if (bd.conexionesRouter.some(c => c.router_id !== router.id && c.public_key === clave)) {
            return problemaTipado(409, 'clave_en_uso', 'Clave en uso', 'Esa clave pública ya es de otro router')
        }
        Object.assign(conexion, { public_key: clave, registrado_en: ahora(), token_vence: null, version: conexion.version + 1 })
        registrarAccion(solicitud, 'routers.conexion_clave', { tipo: 'router', id: router.id }, { public_key: clave })
        return { status: 200, cuerpo: conexion }
    }),

    'POST /api/v1/routers/:id/probar-conexion': conPermiso('routers.probar_conexion', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        return router ? { status: 200, cuerpo: prueba(router) } : noEncontrado('el router')
    }),

    'POST /api/v1/routers/:id/reconciliar': conPermiso('routers.reconciliar', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        // Una reconciliación pedida hace menos de un minuto sigue «en curso»: la segunda no se encola.
        const reciente = bd.acciones.some(a => a.accion === 'routers.reconciliar' && a.entidad_id === router.id && Date.now() - Date.parse(a.created_at) < 60_000)
        const encolado = !reciente
        if (encolado) {
            registrarAccion(solicitud, 'routers.reconciliar', { tipo: 'router', id: router.id }, {})
            // El worker la aplica al momento en los fixtures: la vista previa y el corte quedan limpios.
            if (router.api_usuario && router.tiene_api_password && !bd.routersSinRespuesta.includes(router.id)) {
                bd.routersReconciliados = [...new Set([...bd.routersReconciliados, router.id])]
            }
        }
        return { status: 202, cuerpo: { router_id: router.id, job_id: `reconciliar-${router.id}`, encolado } satisfies Schema<'ReconciliacionEncolada'> }
    }),
}
