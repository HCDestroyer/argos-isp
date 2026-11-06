/** Configuración del coa-dispatcher desde el entorno. Documentada en `.env.example`. */

export interface PerfilSuspendido {
    rateLimit: string
    addressList: string
    filterId: string
}

/**
 * Cómo se suspende una sesión que tiene IPv6 (`prefijo_enlace_v6` o `prefijo_delegado_v6`):
 * - `coa`: CoA con el perfil de corte, sin reconectar. IPv6 queda bloqueado por
 *   `Filter-Id`, pero RouterOS no agrega el /64 ni el /56 a la address-list IPv6 por CoA, así que el
 *   router no puede hacer dst-nat de IPv6 a `/corte` (TCP recibe reset).
 * - `disconnect` (por defecto): Disconnect-Request; al reconectar `aaa` entrega `Mikrotik-Group=suspendido` y el
 *   perfil PPP mete IPv4, /64 y /56 en `suspendidos` (IPv4 e IPv6), con lo que `lab.rsc` puede
 *   redirigir HTTP por IPv6 al portal. Las sesiones solo IPv4 siguen por CoA.
 * Ver `infra/mikrotik/README.md` ("Corte IPv6 hacia /corte").
 */
export type ModoSuspensionIpv6 = 'coa' | 'disconnect'

/**
 * Cómo se suspende CUALQUIER sesión (`COA_SUSPENDER`, bug del portal cautivo v1.9.0):
 * - `disconnect` (por defecto): Disconnect-Request a toda sesión. El CPE reconecta en segundos con
 *   el perfil `suspendido` (address-list e interface-list IPv4/IPv6) y, al caerse su WAN, abre todas
 *   sus conexiones de nuevo: las que el router tenía en FastTrack (que no pasan por el filtro) dejan
 *   de usarse y las nuevas entran al corte. Con CoA el servicio cortado seguía navegando por las
 *   conexiones ya abiertas.
 * - `coa`: el comportamiento anterior (CoA sin reconectar; `COA_SUSPENDER_CON_IPV6` decide las
 *   sesiones con IPv6).
 */
export type ModoSuspension = 'coa' | 'disconnect'

export interface Config {
    port: number
    host: string
    logLevel: string
    redis: { host: string; port: number; db: number; password: string | undefined }
    /** Stream y grupo del bus de eventos (`.claude/integration/contratos/eventos.md`). */
    stream: string
    grupo: string
    consumidor: string
    /** Desde dónde lee el grupo si no existe: `$` (solo lo nuevo) o `0` (todo el stream). */
    grupoInicio: string
    /** Entradas pendientes de otro consumidor que se reclaman tras este tiempo (XAUTOCLAIM). */
    reclamarTrasMs: number
    db: { host: string; port: number; user: string; password: string | undefined; database: string }
    claveSecretos: string | undefined
    /** Prefijo de `aaa:user:<user_ppp>` (rate-limit completo de A1) */
    aaaPrefijo: string
    /**
     * Respaldo del rate-limit cuando `aaa:user:*` no está en Redis: la API interna, igual que `aaa`
     * (`registro.ts`). null si no hay `API_INTERNAL_URL`.
     */
    api: { url: string; token: string; timeoutMs: number; reintentos: number; esperaMs: number } | null
    nas: {
        puerto: number
        timeoutMs: number
        reintentos: number
        esperaMs: number
        origen: string | undefined
    }
    suspendido: PerfilSuspendido
    suspenderConIpv6: ModoSuspensionIpv6
    suspender: ModoSuspension
}

function numero(valor: string | undefined, porDefecto: number): number {
    if (valor === undefined || valor === '') return porDefecto
    const n = Number(valor)
    if (!Number.isFinite(n)) throw new Error(`valor numérico inválido: ${valor}`)
    return n
}

function modoSuspension(valor: string | undefined): ModoSuspension {
    if (valor === undefined || valor === '' || valor === 'disconnect') return 'disconnect'
    if (valor === 'coa') return 'coa'
    throw new Error(`COA_SUSPENDER inválido: ${valor} (disconnect | coa)`)
}

function modoSuspensionIpv6(valor: string | undefined): ModoSuspensionIpv6 {
    // `disconnect` por defecto desde v1.9.1 (bug del portal cautivo, 5 nov): solo así el suspendido con
    // IPv6 entra con el perfil `suspendido` y su HTTP por IPv6 también se redirige a `/corte`.
    if (valor === undefined || valor === '' || valor === 'disconnect') return 'disconnect'
    if (valor === 'coa') return 'coa'
    throw new Error(`COA_SUSPENDER_CON_IPV6 inválido: ${valor} (coa | disconnect)`)
}

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
    return {
        port: numero(env.PORT, 3200),
        host: env.HOST ?? '0.0.0.0',
        logLevel: env.LOG_LEVEL ?? 'info',
        redis: {
            host: env.REDIS_HOST ?? 'localhost',
            port: numero(env.REDIS_PORT, 6379),
            db: numero(env.REDIS_DB, 0),
            password: env.REDIS_PASSWORD || undefined,
        },
        stream: env.COA_STREAM || 'argos:eventos',
        grupo: env.COA_GRUPO || 'coa',
        consumidor: env.COA_CONSUMIDOR || `coa-${process.pid}`,
        grupoInicio: env.COA_GRUPO_INICIO || '$',
        reclamarTrasMs: numero(env.COA_RECLAMAR_TRAS_MS, 60_000),
        db: {
            host: env.DB_HOST ?? 'localhost',
            port: numero(env.DB_PORT, 5432),
            user: env.DB_USER ?? 'argosisp',
            password: env.DB_PASSWORD || undefined,
            database: env.DB_DATABASE ?? 'argosisp',
        },
        claveSecretos: env.AAA_PPP_KEY,
        aaaPrefijo: env.AAA_REDIS_PREFIJO || 'aaa:user:',
        api: env.API_INTERNAL_URL
            ? {
                  url: env.API_INTERNAL_URL,
                  token: env.AAA_INTERNAL_TOKEN || env.INTERNAL_TOKEN || '',
                  timeoutMs: numero(env.COA_API_TIMEOUT_MS, 2000),
                  reintentos: numero(env.COA_API_REINTENTOS, 3),
                  esperaMs: numero(env.COA_API_ESPERA_MS, 500),
              }
            : null,
        nas: {
            puerto: numero(env.COA_NAS_PORT, 3799),
            timeoutMs: numero(env.COA_TIMEOUT_MS, 2000),
            reintentos: numero(env.COA_REINTENTOS, 3),
            esperaMs: numero(env.COA_ESPERA_MS, 500),
            origen: env.COA_ORIGEN_IP || undefined,
        },
        suspendido: {
            rateLimit: env.COA_SUSPENDIDO_RATE_LIMIT ?? '256k/256k',
            addressList: env.COA_SUSPENDIDO_ADDRESS_LIST ?? 'suspendidos',
            filterId: env.COA_SUSPENDIDO_FILTER_ID ?? 'argos-corte.in',
        },
        suspenderConIpv6: modoSuspensionIpv6(env.COA_SUSPENDER_CON_IPV6),
        suspender: modoSuspension(env.COA_SUSPENDER),
    }
}
