import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, registrarAccion, versionCambiada } from '../comun'
import { empresaRequerida } from './comun'
import { configEquiposVacia, type SecretosEquipos } from './datos'

type Config = Schema<'ConfigEquipos'>
type Errores = NonNullable<Problem['errors']>

/** OLT que devuelve el SmartOLT de los fixtures al probar. */
export const OLTS_SMARTOLT_FIXTURE = [{ id: '1', name: 'OLT Centro' }, { id: '2', name: 'OLT Norte' }]

function configDe(empresaId: number): Config {
    return bd.operacionPm.equipos[empresaId] ?? configEquiposVacia(empresaId)
}

function secretosDe(empresaId: number): SecretosEquipos {
    return bd.operacionPm.secretosEquipos[empresaId] ?? { smartolt_token: null, genieacs_clave: null, genieacs_ca: null }
}

/** Como la API: los secretos salen como `***` (o null) y nunca su valor. */
function vista(config: Config, secretos: SecretosEquipos): Config {
    return {
        ...config,
        smartolt: { ...config.smartolt, token: secretos.smartolt_token ? '***' : null },
        genieacs: { ...config.genieacs, clave: secretos.genieacs_clave ? '***' : null, ca: Boolean(secretos.genieacs_ca) },
    }
}

/** `capacidades`: solo con la integración encendida y su última prueba en ok. */
function capacidades(config: Config): Config['capacidades'] {
    const olt = config.activo && config.smartolt.prueba_ok === true
    return { ftth: olt, wireless: olt, tr069: config.activo && config.genieacs.prueba_ok === true }
}

function textoONull(valor: unknown, campo: string, max: number, errores: Errores): string | null | undefined {
    if (valor === undefined) {
        return undefined
    }
    if (valor === null) {
        return null
    }
    if (typeof valor !== 'string' || valor.length > max) {
        errores.push({ field: campo, message: `El campo ${campo} debe tener a lo sumo ${max} caracteres`, rule: 'maxLength' })
        return undefined
    }
    return valor.trim() === '' ? null : valor.trim()
}

/**
 * `GET`/`PUT /integraciones/equipos` y `POST …/probar` (A6, SmartOLT y GenieACS por empresa, CLAUDE.md
 * §14): secretos omitido = se conserva, null = se borra, texto = se reemplaza; cambiar URL o secreto
 * borra la última prueba. Una URL con «falla» no responde al probar.
 */
export const rutasEquiposIntegracion: RutasFixture = {
    'GET /api/v1/integraciones/equipos': conPermiso('smartolt.ver', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        return { status: 200, cuerpo: vista(configDe(empresa.id), secretosDe(empresa.id)) }
    }),

    'PUT /api/v1/integraciones/equipos': conPermiso('smartolt.editar_instancia', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const actual = configDe(empresa.id)
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const errores: Errores = []
        const smartoltUrl = textoONull(cuerpo.smartolt_url, 'smartolt_url', 500, errores)
        const token = textoONull(cuerpo.smartolt_token, 'smartolt_token', 500, errores)
        const genieUrl = textoONull(cuerpo.genieacs_url, 'genieacs_url', 500, errores)
        const genieUsuario = textoONull(cuerpo.genieacs_usuario, 'genieacs_usuario', 200, errores)
        const clave = textoONull(cuerpo.genieacs_clave, 'genieacs_clave', 500, errores)
        const ca = textoONull(cuerpo.genieacs_ca, 'genieacs_ca', 20000, errores)
        for (const [campo, url] of [['smartolt_url', smartoltUrl], ['genieacs_url', genieUrl]] as const) {
            if (url && !/^https?:\/\/[^\s/]+/.test(url)) {
                errores.push({ field: campo, message: `El campo ${campo} debe ser una URL válida`, rule: 'url' })
            }
        }
        if (ca && !ca.includes('BEGIN CERTIFICATE')) {
            errores.push({ field: 'genieacs_ca', message: 'El certificado debe estar en formato PEM', rule: 'pem' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const secretos = { ...secretosDe(empresa.id) }
        const cambiaOlt = (smartoltUrl !== undefined && smartoltUrl !== actual.smartolt.url) || token !== undefined
        const cambiaAcs = (genieUrl !== undefined && genieUrl !== actual.genieacs.url) || clave !== undefined || genieUsuario !== undefined || ca !== undefined
        if (token !== undefined) {
            secretos.smartolt_token = token
        }
        if (clave !== undefined) {
            secretos.genieacs_clave = clave
        }
        if (ca !== undefined) {
            secretos.genieacs_ca = ca
        }
        const perfiles = Array.isArray(cuerpo.perfiles)
            ? (cuerpo.perfiles as Record<string, unknown>[]).map(p => ({
                    smartolt_olt_id: String(p.smartolt_olt_id ?? ''),
                    plan_id: typeof p.plan_id === 'number' ? p.plan_id : null,
                    authorization_preset_id: Number(p.authorization_preset_id),
                    pon_type: p.pon_type === 'epon' ? 'epon' as const : 'gpon' as const,
                }))
            : actual.perfiles
        const nueva: Config = {
            ...actual,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo,
            pppoe_por_acs: typeof cuerpo.pppoe_por_acs === 'boolean' ? cuerpo.pppoe_por_acs : actual.pppoe_por_acs,
            perfiles,
            smartolt: cambiaOlt
                ? { ...actual.smartolt, url: smartoltUrl === undefined ? actual.smartolt.url : smartoltUrl, probado_en: null, prueba_ok: null, prueba_error: null }
                : actual.smartolt,
            genieacs: cambiaAcs
                ? { ...actual.genieacs, url: genieUrl === undefined ? actual.genieacs.url : genieUrl, usuario: genieUsuario === undefined ? actual.genieacs.usuario : genieUsuario, probado_en: null, prueba_ok: null, prueba_error: null }
                : actual.genieacs,
            version: actual.version + 1,
        }
        nueva.capacidades = capacidades(nueva)
        bd.operacionPm.equipos[empresa.id] = nueva
        bd.operacionPm.secretosEquipos[empresa.id] = secretos
        const entrada = { ...cuerpo, ...(cuerpo.smartolt_token ? { smartolt_token: '***' } : {}), ...(cuerpo.genieacs_clave ? { genieacs_clave: '***' } : {}) }
        registrarAccion(solicitud, 'equipos.configurar', { tipo: 'config_equipos', id: empresa.id }, entrada)
        return { status: 200, cuerpo: vista(nueva, secretos) }
    }),

    'POST /api/v1/integraciones/equipos/probar': conPermiso('smartolt.probar_instancia', (solicitud) => {
        const empresa = empresaRequerida(solicitud)
        if (!empresa.ok) {
            return empresa.falla
        }
        const config = configDe(empresa.id)
        const secretos = secretosDe(empresa.id)
        const cuando = ahora()
        const smartolt = config.smartolt.url
            ? (config.smartolt.url.includes('falla') || !secretos.smartolt_token
                    ? { ok: false, latencia_ms: null, error: secretos.smartolt_token ? 'No respondió en 10 s' : 'Falta el token de la API' }
                    : { ok: true, latencia_ms: 182, error: null, olts: OLTS_SMARTOLT_FIXTURE })
            : null
        const genieacs = config.genieacs.url
            ? (config.genieacs.url.includes('falla')
                    ? { ok: false, latencia_ms: null, error: 'No respondió en 10 s' }
                    : { ok: true, latencia_ms: 95, error: null })
            : null
        const nueva: Config = {
            ...config,
            smartolt: smartolt ? { ...config.smartolt, probado_en: cuando, prueba_ok: smartolt.ok, prueba_error: smartolt.error } : config.smartolt,
            genieacs: genieacs ? { ...config.genieacs, probado_en: cuando, prueba_ok: genieacs.ok, prueba_error: genieacs.error } : config.genieacs,
        }
        nueva.capacidades = capacidades(nueva)
        bd.operacionPm.equipos[empresa.id] = nueva
        registrarAccion(solicitud, 'equipos.probar', { tipo: 'config_equipos', id: empresa.id }, {})
        const prueba: Schema<'PruebaEquipos'> = { probado_en: cuando, smartolt, genieacs, capacidades: nueva.capacidades }
        return { status: 200, cuerpo: prueba }
    }),
}
