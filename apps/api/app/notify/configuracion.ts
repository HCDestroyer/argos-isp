import type { Redis } from 'ioredis'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrar } from '#shared/cifrado'
import type { CanalNotificacion } from '#shared/eventos'
import { nuevaConexionRedis, prefijoColas, redis } from '#shared/redis'
import type { Canal } from '#notify/canales/canal'
import { CanalCorreo } from '#notify/canales/correo'
import { CanalTelegram } from '#notify/canales/telegram'

/**
 * Configuración de los canales de notificación (correo y Telegram), editable desde el panel
 * (`notify.configuracion_canales`, contrato `contratos/multiempresa.md`).
 *
 * - **Resolución.** Una fila global (`empresa_id` nulo) y una opcional por empresa. Para un aviso
 *   de la empresa E manda la fila de E si existe y `hereda = false`; si no, la global. Sin fila
 *   global (instalación que aún no se configuró ni se sembró) manda el entorno (`SMTP_*`,
 *   `TELEGRAM_*`), que es solo el valor inicial: ver `SembrarConfiguracionCanales`.
 * - **Caché por proceso, invalidada por evento (regla 5, sin TTL).** La configuración se lee una
 *   vez y queda en memoria con los secretos descifrados. Se invalida con
 *   `notificaciones.config_cambiada` (consumidor del grupo `notify`) y con un aviso por Redis
 *   Pub/Sub (`<COLAS_PREFIJO>:notify:config`) para los demás procesos (API, otras réplicas del
 *   worker). Al reconectar el suscriptor también se invalida: un aviso perdido mientras Redis no
 *   estaba no deja la caché vieja.
 * - **Lectura síncrona.** `configParaSync` (para el código que no puede esperar, como el portal)
 *   usa la última instantánea cargada; sin ninguna, el entorno.
 */

// ── Tipos de aviso ───────────────────────────────────────────────────────────────────────────

export const TIPOS_AVISO = [
    'factura',
    'vencimiento',
    'recordatorio',
    'corte',
    'pago',
    'promesa',
    'comprobante',
    'lealtad',
] as const
export type TipoAviso = (typeof TIPOS_AVISO)[number]

/** Qué eventos cubre cada tipo (para la documentación y las pantallas). */
export const DESCRIPCION_AVISOS: Record<TipoAviso, string> = {
    factura:
        'Factura emitida o anulada y periodos sin costo (`factura.emitida`, `factura.anulada`, `bonificacion.registrada`)',
    vencimiento: 'Factura vencida (`factura.vencida`)',
    recordatorio: 'Recordatorios de pago antes y después del vencimiento (`recordatorio.1` a `.3`)',
    corte: 'Cambio de estado del servicio: limitado, suspendido, reactivado (`servicio.estado_cambiado`)',
    pago: 'Pago registrado, también a los dueños de facturas pagadas por otro (`pago.*`)',
    promesa: 'Promesas de pago (`promesa.*`)',
    comprobante: 'Comprobantes de depósito recibidos, aprobados o rechazados (`comprobante.*`)',
    lealtad:
        'Programa de lealtad: puntos ganados y por vencer, referido calificado, canjes y premios de sorteos (`lealtad.puntos_acumulados`, `lealtad.puntos_por_vencer`, `lealtad.referido_calificado`, `lealtad.canje_*`, `sorteo.ganador_notificado`, `sorteo.premio_entregado`)',
}

/** Tipo de aviso de un evento de plantilla; `null` = no se puede apagar por tipo. */
export function tipoDeAviso(evento: string): TipoAviso | null {
    if (evento === 'factura.vencida') return 'vencimiento'
    if (evento.startsWith('factura.') || evento === 'bonificacion.registrada') return 'factura'
    if (evento.startsWith('recordatorio.')) return 'recordatorio'
    if (evento === 'servicio.estado_cambiado') return 'corte'
    if (evento.startsWith('pago.')) return 'pago'
    if (evento.startsWith('promesa.')) return 'promesa'
    if (evento.startsWith('comprobante.')) return 'comprobante'
    if (evento.startsWith('lealtad.') || evento.startsWith('sorteo.')) return 'lealtad'
    return null
}

// ── Modelo ───────────────────────────────────────────────────────────────────────────────────

/**
 * - `auto`: sin TLS al conectar; sube a STARTTLS si el servidor lo ofrece (puertos 25 y 587).
 * - `starttls`: exige STARTTLS (falla si el servidor no lo ofrece).
 * - `tls`: TLS desde el inicio (puerto 465).
 * - `ninguno`: nunca cifra (solo para un SMTP local, como Mailpit).
 */
export const MODOS_TLS = ['auto', 'starttls', 'tls', 'ninguno'] as const
export type TlsSmtp = (typeof MODOS_TLS)[number]

/** Fila de `notify.configuracion_canales`. */
export interface FilaConfiguracion {
    id: number
    empresa_id: number | null
    hereda: boolean
    correo_activo: boolean
    smtp_host: string | null
    smtp_puerto: number | null
    smtp_tls: TlsSmtp
    smtp_usuario: string | null
    smtp_password_cifrada: string | null
    correo_remitente: string | null
    correo_nombre: string | null
    /** direcciones de contabilidad para los avisos fiscales, separadas por coma */
    correo_contabilidad: string | null
    telegram_clientes_activo: boolean
    telegram_alertas_activo: boolean
    telegram_token_cifrado: string | null
    telegram_bot_id: string | null
    telegram_bot_nombre: string | null
    telegram_chat_equipo: string | null
    telegram_webhook_secreto_cifrado: string | null
    avisos: Partial<Record<string, boolean>>
    sembrada_desde_entorno: boolean
    version: number
    created_at: Date
    updated_at: Date
}

export const TABLA_CONFIGURACION = 'notify.configuracion_canales'

/** Configuración efectiva, con los secretos en claro. Nunca sale del proceso (ni al log). */
export interface ConfigCanales {
    /** fila de la que sale; null = entorno */
    id: number | null
    /** empresa de la fila (null = global o entorno) */
    empresaId: number | null
    origen: 'global' | 'empresa' | 'entorno'
    version: number
    correo: {
        activo: boolean
        host: string | null
        puerto: number | null
        tls: TlsSmtp
        usuario: string | null
        password: string | null
        remitente: string | null
        nombre: string | null
        /** destino de los avisos fiscales a contabilidad (direcciones separadas por coma) */
        contabilidad: string | null
    }
    telegram: {
        clientesActivo: boolean
        alertasActivo: boolean
        token: string | null
        botId: string | null
        botNombre: string | null
        chatEquipo: string | null
        webhookSecreto: string | null
    }
    avisos: Record<TipoAviso, boolean>
    /** secretos guardados que no se pudieron descifrar (clave distinta): el canal queda sin configurar */
    erroresCifrado: string[]
}

export function avisosCompletos(avisos: Partial<Record<string, boolean>> | null | undefined) {
    const salida = {} as Record<TipoAviso, boolean>
    for (const tipo of TIPOS_AVISO) salida[tipo] = avisos?.[tipo] !== false
    return salida
}

/** Id público del bot: la parte numérica del token (`123456:ABC…` → `123456`). */
export function botIdDelToken(token: string): string {
    return token.split(':')[0] ?? ''
}

function descifrarCampo(valor: string | null, campo: string, errores: string[]): string | null {
    if (valor === null) return null
    try {
        return descifrar(valor)
    } catch {
        errores.push(campo)
        return null
    }
}

export function desdeFila(fila: FilaConfiguracion): ConfigCanales {
    const errores: string[] = []
    const config: ConfigCanales = {
        id: Number(fila.id),
        empresaId: fila.empresa_id === null ? null : Number(fila.empresa_id),
        origen: fila.empresa_id === null ? 'global' : 'empresa',
        version: fila.version,
        correo: {
            activo: fila.correo_activo,
            host: fila.smtp_host,
            puerto: fila.smtp_puerto,
            tls: fila.smtp_tls,
            usuario: fila.smtp_usuario,
            password: descifrarCampo(fila.smtp_password_cifrada, 'smtp_password', errores),
            remitente: fila.correo_remitente,
            nombre: fila.correo_nombre,
            contabilidad: fila.correo_contabilidad ?? null,
        },
        telegram: {
            clientesActivo: fila.telegram_clientes_activo,
            alertasActivo: fila.telegram_alertas_activo,
            token: descifrarCampo(fila.telegram_token_cifrado, 'telegram_token', errores),
            botId: fila.telegram_bot_id,
            botNombre: fila.telegram_bot_nombre,
            chatEquipo: fila.telegram_chat_equipo,
            webhookSecreto: descifrarCampo(
                fila.telegram_webhook_secreto_cifrado,
                'telegram_webhook_secreto',
                errores,
            ),
        },
        avisos: avisosCompletos(fila.avisos),
        erroresCifrado: errores,
    }
    if (errores.length > 0) {
        logger.error(
            { configuracion_id: fila.id, campos: errores },
            'notify: no se pudieron descifrar secretos de la configuración de canales (¿cambió AAA_PPP_KEY?)',
        )
    }
    return config
}

/** `ArgosIsp <no-responder@dominio>` → nombre y dirección. Una dirección sola no tiene nombre. */
export function separarRemitente(valor: string | null | undefined): {
    nombre: string | null
    correo: string | null
} {
    const texto = valor?.trim()
    if (!texto) return { nombre: null, correo: null }
    const coincidencia = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(texto)
    if (coincidencia) return { nombre: coincidencia[1]!.trim() || null, correo: coincidencia[2]!.trim() }
    return { nombre: null, correo: texto }
}

function booleano(valor: string | undefined): boolean {
    return valor === 'true' || valor === '1'
}

/**
 * Configuración desde las variables de entorno: el valor inicial de laboratorio y desarrollo.
 * Se lee de `process.env` en cada llamada (las pruebas cambian el entorno sin reiniciar).
 */
export function desdeEntorno(entorno: NodeJS.ProcessEnv = process.env): ConfigCanales {
    const remitente = separarRemitente(entorno.MAIL_FROM)
    const puerto = Number(entorno.SMTP_PORT)
    const token = entorno.TELEGRAM_BOT_TOKEN || null
    return {
        id: null,
        empresaId: null,
        origen: 'entorno',
        version: 0,
        correo: {
            activo: true,
            host: entorno.SMTP_HOST || null,
            puerto: Number.isInteger(puerto) && puerto > 0 ? puerto : 1025,
            tls: booleano(entorno.SMTP_SECURE) ? 'tls' : 'auto',
            usuario: entorno.SMTP_USER || null,
            password: entorno.SMTP_PASSWORD || null,
            remitente: remitente.correo,
            nombre: remitente.nombre,
            contabilidad: entorno.NOTIFY_CORREO_CONTABILIDAD?.trim() || null,
        },
        telegram: {
            clientesActivo: true,
            alertasActivo: true,
            token,
            botId: token ? botIdDelToken(token) : null,
            botNombre: (entorno.TELEGRAM_BOT_NOMBRE || '').replace(/^@/, '') || null,
            chatEquipo: entorno.TELEGRAM_CHAT_EQUIPO || null,
            webhookSecreto: entorno.TELEGRAM_WEBHOOK_SECRET || null,
        },
        avisos: avisosCompletos({}),
        erroresCifrado: [],
    }
}

// ── Caché ────────────────────────────────────────────────────────────────────────────────────

export interface Instantanea {
    global: ConfigCanales | null
    empresas: Map<number, { hereda: boolean; config: ConfigCanales }>
}

let actual: Instantanea | null = null
/** última instantánea cargada: la usan los lectores síncronos mientras se recarga */
let ultima: Instantanea | null = null
let carga: Promise<Instantanea> | null = null
let generacion = 0

export async function leerFilas(cliente: QueryClientContract = db.connection()) {
    return (await cliente.from(TABLA_CONFIGURACION).select('*').orderBy('id')) as FilaConfiguracion[]
}

async function leer(): Promise<Instantanea> {
    const instantanea: Instantanea = { global: null, empresas: new Map() }
    for (const fila of await leerFilas()) {
        const config = desdeFila(fila)
        if (fila.empresa_id === null) instantanea.global = config
        else instantanea.empresas.set(Number(fila.empresa_id), { hereda: fila.hereda, config })
    }
    return instantanea
}

async function cargar(): Promise<Instantanea> {
    // Si se invalidó mientras se leía, se vuelve a leer: nunca se guarda una lectura vieja.
    for (;;) {
        const vista = generacion
        const instantanea = await leer()
        if (vista === generacion) {
            actual = instantanea
            ultima = instantanea
            return instantanea
        }
    }
}

/** Configuraciones vigentes (las lee de la base la primera vez y tras cada invalidación). */
export function configuraciones(): Promise<Instantanea> {
    if (actual) return Promise.resolve(actual)
    carga ??= cargar().finally(() => {
        carga = null
    })
    return carga
}

/**
 * Descarta la caché de este proceso y la vuelve a leer en segundo plano (los lectores síncronos
 * ven la anterior hasta que termine). No avisa a otros procesos: eso es `publicarInvalidacion`.
 */
export function invalidarConfiguracion(): void {
    generacion++
    actual = null
    cerrarTransportes()
    configuraciones().catch((error) => {
        logger.error({ err: error }, 'notify: no se pudo recargar la configuración de canales')
    })
}

/** Invalida y espera la recarga. Para pruebas y para el arranque. */
export async function recargarConfiguracion(): Promise<Instantanea> {
    invalidarConfiguracion()
    return configuraciones()
}

function resolver(instantanea: Instantanea | null, empresaId: number | null | undefined): ConfigCanales {
    if (empresaId !== null && empresaId !== undefined) {
        const propia = instantanea?.empresas.get(empresaId)
        if (propia && !propia.hereda) return propia.config
    }
    return instantanea?.global ?? desdeEntorno()
}

/** Configuración que se aplica a un aviso de `empresaId` (null o sin empresa: la global). */
export async function configPara(empresaId?: number | null): Promise<ConfigCanales> {
    return resolver(await configuraciones(), empresaId)
}

/** Igual que `configPara`, con la última instantánea cargada (o el entorno si no hay ninguna). */
export function configParaSync(empresaId?: number | null): ConfigCanales {
    return resolver(actual ?? ultima, empresaId)
}

/** Configuraciones (global y de empresas que no heredan) cuyo bot tiene este id. */
export async function configuracionesDelBot(botId: string): Promise<ConfigCanales[]> {
    const instantanea = await configuraciones()
    const candidatas = [
        instantanea.global ?? desdeEntorno(),
        ...[...instantanea.empresas.values()].filter((e) => !e.hereda).map((e) => e.config),
    ]
    return candidatas.filter((c) => c.telegram.token && c.telegram.botId === botId)
}

// ── Avisos entre procesos (Pub/Sub) ──────────────────────────────────────────────────────────

export function canalInvalidacion(): string {
    return `${prefijoColas()}:notify:config`
}

/** Avisa a los demás procesos que recarguen. Si Redis falla, queda en el log (el evento llega igual). */
export async function publicarInvalidacion(): Promise<void> {
    try {
        await redis().publish(canalInvalidacion(), String(Date.now()))
    } catch (error) {
        logger.warn({ err: error }, 'notify: no se pudo publicar la invalidación de la configuración')
    }
}

let suscriptor: Redis | null = null

/**
 * Suscribe este proceso a las invalidaciones de otros procesos. Idempotente. Al (re)conectar
 * invalida, porque un aviso publicado mientras estaba desconectado se pierde.
 */
export async function escucharInvalidaciones(): Promise<void> {
    if (suscriptor) return
    const conexion = nuevaConexionRedis({ maxRetriesPerRequest: null })
    suscriptor = conexion
    let primera = true
    conexion.on('ready', () => {
        if (primera) {
            primera = false
            return
        }
        invalidarConfiguracion()
    })
    conexion.on('message', (canal: string) => {
        if (canal === canalInvalidacion()) invalidarConfiguracion()
    })
    try {
        await conexion.subscribe(canalInvalidacion())
    } catch (error) {
        logger.warn({ err: error }, 'notify: no se pudo suscribir a las invalidaciones de configuración')
    }
}

export async function dejarDeEscuchar(): Promise<void> {
    const conexion = suscriptor
    suscriptor = null
    if (!conexion) return
    try {
        await conexion.quit()
    } catch {
        conexion.disconnect()
    }
}

// ── Transportes ──────────────────────────────────────────────────────────────────────────────

/** Canales que reemplazan a los de la configuración (pruebas). `null` = canal no configurado. */
const sustitutos = new Map<CanalNotificacion, Canal | null>()

export function sustituirCanal(nombre: CanalNotificacion, canal: Canal | null) {
    sustitutos.set(nombre, canal)
}

export function quitarSustitutos() {
    sustitutos.clear()
    cerrarTransportes()
}

/** `fetch` y raíz de la Bot API para los bots que se arman desde la configuración (pruebas). */
let transporteTelegram: { fetch?: typeof fetch; apiRoot?: string } = {}

export function fijarTransporteTelegram(opciones: { fetch?: typeof fetch; apiRoot?: string } = {}) {
    transporteTelegram = opciones
    cerrarTransportes()
}

/** Transportes ya armados, por huella de su configuración (cambia la configuración → otro). */
const transportes = new Map<string, Canal>()

function cerrarTransportes() {
    for (const canal of transportes.values()) {
        if (canal instanceof CanalCorreo) void canal.cerrar()
    }
    transportes.clear()
}

/**
 * Arma el canal con los datos de la configuración, sin mirar interruptores. `null` si le falta
 * lo necesario (servidor SMTP, token del bot). Con `nuevo` no usa sustitutos ni la caché de
 * transportes (prueba de envío desde el panel).
 */
export function construirCanal(
    config: ConfigCanales,
    nombre: CanalNotificacion,
    opciones: { nuevo?: boolean } = {},
): Canal | null {
    if (!opciones.nuevo && sustitutos.has(nombre)) return sustitutos.get(nombre) ?? null
    const armar = (): { huella: string; crear: () => Canal } | null => {
        if (nombre === 'correo') {
            const c = config.correo
            if (!c.host) return null
            const datos = {
                host: c.host,
                port: c.puerto ?? (c.tls === 'tls' ? 465 : 587),
                tls: c.tls,
                user: c.usuario ?? undefined,
                password: c.password ?? undefined,
                remitente: {
                    name: c.nombre ?? '',
                    address: c.remitente ?? 'no-responder@argosisp.local',
                },
            }
            return { huella: JSON.stringify(['correo', datos]), crear: () => new CanalCorreo(datos) }
        }
        if (nombre === 'telegram') {
            const token = config.telegram.token
            if (!token) return null
            const apiRoot = transporteTelegram.apiRoot ?? (process.env.TELEGRAM_API_ROOT || undefined)
            return {
                huella: JSON.stringify(['telegram', token, apiRoot]),
                crear: () => new CanalTelegram({ token, apiRoot, fetch: transporteTelegram.fetch }),
            }
        }
        return null
    }
    const plan = armar()
    if (!plan) return null
    if (opciones.nuevo) return plan.crear()
    let canal = transportes.get(plan.huella)
    if (!canal) {
        canal = plan.crear()
        transportes.set(plan.huella, canal)
    }
    return canal
}

// ── Decisiones ───────────────────────────────────────────────────────────────────────────────

export type UsoCanal = 'clientes' | 'alertas'

export interface Disponibilidad {
    canal: Canal | null
    /** por qué no hay canal (null si lo hay) */
    motivo: string | null
    /** el canal existe pero está apagado: el envío queda `omitido`, no `fallido` */
    apagado: boolean
}

export function ambito(config: ConfigCanales): string {
    if (config.origen === 'empresa') return `la configuración de la empresa ${config.empresaId}`
    if (config.origen === 'global') return 'la configuración global'
    return 'el entorno'
}

/** ¿Se puede usar `nombre` para `uso` con esta configuración? */
export function disponibilidad(
    config: ConfigCanales,
    nombre: CanalNotificacion,
    uso: UsoCanal = 'clientes',
): Disponibilidad {
    const donde = ambito(config)
    if (nombre === 'correo' && !config.correo.activo) {
        return { canal: null, apagado: true, motivo: `Correo apagado en ${donde}` }
    }
    if (nombre === 'telegram' && uso === 'clientes' && !config.telegram.clientesActivo) {
        return { canal: null, apagado: true, motivo: `Telegram a clientes apagado en ${donde}` }
    }
    if (nombre === 'telegram' && uso === 'alertas' && !config.telegram.alertasActivo) {
        return { canal: null, apagado: true, motivo: `Alertas por Telegram apagadas en ${donde}` }
    }
    const canal = construirCanal(config, nombre)
    if (canal) return { canal, apagado: false, motivo: null }
    const motivo =
        nombre === 'correo'
            ? `canal no configurado: falta el servidor SMTP en ${donde}`
            : nombre === 'telegram'
              ? `canal no configurado: falta el token del bot en ${donde}`
              : 'canal no configurado: WhatsApp todavía no tiene adaptador'
    return { canal: null, apagado: false, motivo }
}

/** ¿Está encendido el tipo de aviso del evento? `motivo` cuando no. */
export function avisoApagado(config: ConfigCanales, evento: string): string | null {
    const tipo = tipoDeAviso(evento)
    if (tipo === null || config.avisos[tipo]) return null
    return `Aviso de tipo ${tipo} apagado en ${ambito(config)}`
}

// ── Empresa del evento ───────────────────────────────────────────────────────────────────────

function entero(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor
    if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
    return null
}

const columnas = new Map<string, Promise<boolean>>()

/** Si existe la columna (las de empresa llegan con la migración de A1). Se pregunta una vez por proceso. */
function columnaExiste(cliente: QueryClientContract, schema: string, tabla: string, columna: string) {
    const clave = `${schema}.${tabla}.${columna}`
    let existe = columnas.get(clave)
    if (!existe) {
        existe = cliente
            .from('information_schema.columns')
            .where({ table_schema: schema, table_name: tabla, column_name: columna })
            .select('column_name')
            .first()
            .then((fila) => Boolean(fila))
        columnas.set(clave, existe)
        existe.catch(() => columnas.delete(clave))
    }
    return existe
}

/** Empresa de un servicio (`core.servicios.empresa_id`), o null si no existe. */
async function empresaDeServicio(cliente: QueryClientContract, servicioId: number): Promise<number | null> {
    const fila = (await cliente
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id')
        .first()) as {
        empresa_id: number | null
    } | null
    return fila?.empresa_id ? Number(fila.empresa_id) : null
}

/** Empresa de una factura: su `empresa_id` (cuando A3 lo agregue) o la de su servicio. */
async function empresaDeFactura(cliente: QueryClientContract, facturaId: number): Promise<number | null> {
    if (await columnaExiste(cliente, 'billing', 'facturas', 'empresa_id')) {
        const fila = await cliente
            .from('billing.facturas')
            .where('id', facturaId)
            .select('empresa_id')
            .first()
        if (fila?.empresa_id) return Number(fila.empresa_id)
    }
    const fila = (await cliente
        .from('billing.facturas')
        .where('id', facturaId)
        .select('servicio_id')
        .first()) as {
        servicio_id: number | null
    } | null
    return fila?.servicio_id ? empresaDeServicio(cliente, Number(fila.servicio_id)) : null
}

/**
 * Empresa del evento (`contratos/multiempresa.md`: `{{empresa.*}}` y la configuración de canales
 * salen de la empresa del servicio o de la factura del evento), en este orden:
 *
 * 1. `empresa_id` del payload (los eventos de servicio y financieros lo traen);
 * 2. la de la factura (`factura_id` o la primera de `facturas[]`): su `empresa_id` o la de su servicio;
 * 3. la del servicio (`servicio_id`);
 * 4. la del servicio de la promesa (`promesa_id`);
 * 5. la de la primera factura que pagó el pago (`pago_id`, también en `comprobante.*`).
 *
 * `null` = no se pudo deducir: la configuración global y, en las plantillas, la empresa principal.
 */
export async function empresaDelEvento(
    cliente: QueryClientContract,
    payload: Record<string, unknown>,
): Promise<number | null> {
    const directa = entero(payload.empresa_id)
    if (directa) return directa
    const facturas = Array.isArray(payload.facturas) ? payload.facturas : []
    const facturaId = entero(payload.factura_id) ?? entero(facturas[0])
    if (facturaId) {
        const empresa = await empresaDeFactura(cliente, facturaId)
        if (empresa) return empresa
    }
    const servicioId = entero(payload.servicio_id)
    if (servicioId) {
        const empresa = await empresaDeServicio(cliente, servicioId)
        if (empresa) return empresa
    }
    const promesaId = entero(payload.promesa_id)
    if (promesaId) {
        const fila = (await cliente
            .from('billing.promesas')
            .where('id', promesaId)
            .select('servicio_id')
            .first()) as {
            servicio_id: number | null
        } | null
        if (fila?.servicio_id) {
            const empresa = await empresaDeServicio(cliente, Number(fila.servicio_id))
            if (empresa) return empresa
        }
    }
    const pagoId = entero(payload.pago_id)
    if (pagoId) {
        const fila = (await cliente
            .from('billing.pagos_aplicaciones')
            .where('pago_id', pagoId)
            .orderBy('id', 'asc')
            .select('factura_id')
            .first()) as { factura_id: number } | null
        if (fila) {
            const empresa = await empresaDeFactura(cliente, Number(fila.factura_id))
            if (empresa) return empresa
        }
    }
    return null
}
