/*
|--------------------------------------------------------------------------
| Variables de entorno
|--------------------------------------------------------------------------
|
| Se validan al arrancar. Documentadas en `.env.example`.
|
*/
import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
    NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
    PORT: Env.schema.number(),
    HOST: Env.schema.string({ format: 'host' }),
    APP_KEY: Env.schema.string(),
    LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const),

    /*
    |----------------------------------------------------------
    | Base de datos
    |----------------------------------------------------------
    */
    DB_HOST: Env.schema.string({ format: 'host' }),
    DB_PORT: Env.schema.number(),
    DB_USER: Env.schema.string(),
    DB_PASSWORD: Env.schema.string.optional(),
    DB_DATABASE: Env.schema.string(),
    DB_POOL_MAX: Env.schema.number.optional(),

    /*
    |----------------------------------------------------------
    | Redis (colas, outbox y cachés; lo usan A1/A2/A3)
    |----------------------------------------------------------
    */
    REDIS_HOST: Env.schema.string.optional({ format: 'host' }),
    REDIS_PORT: Env.schema.number.optional(),
    REDIS_PASSWORD: Env.schema.string.optional(),

    /** Prefijo de las claves de BullMQ en Redis (por defecto `argosisp`; las pruebas usan uno propio). */
    COLAS_PREFIJO: Env.schema.string.optional(),

    /** Prefijo de `aaa:user:<user_ppp>` (contrato con A2). Por defecto `aaa:user:`. */
    AAA_REDIS_PREFIJO: Env.schema.string.optional(),
    /** Stream de Redis del bus de eventos (contrato). Por defecto `argos:eventos`. */
    EVENTOS_STREAM: Env.schema.string.optional(),

    /** Vigía de `aaa` (A2, `node ace aaa:vigilar`): nodos `nombre=url` separados por coma. */
    AAA_SALUD_NODOS: Env.schema.string.optional(),
    /** ms sin responder antes de emitir `aaa.caido` (por defecto 60000) */
    AAA_CAIDO_TRAS_MS: Env.schema.number.optional(),
    /** ms entre health checks (por defecto 5000) */
    AAA_SALUD_CADA_MS: Env.schema.number.optional(),

    /*
    |----------------------------------------------------------
    | API REST de RouterOS (A2, servicios sin PPPoE; app/network/routeros)
    |----------------------------------------------------------
    */
    /** ms por petición (5000), reintentos ante red caída o 5xx (3) y espera base del backoff (500) */
    ROUTEROS_TIMEOUT_MS: Env.schema.number.optional(),
    ROUTEROS_REINTENTOS: Env.schema.number.optional(),
    ROUTEROS_ESPERA_MS: Env.schema.number.optional(),
    /** Velocidad y address-list del suspendido (las mismas que PPPoE: 256k/256k, suspendidos) */
    ROUTEROS_SUSPENDIDO_RATE_LIMIT: Env.schema.string.optional(),
    ROUTEROS_SUSPENDIDO_ADDRESS_LIST: Env.schema.string.optional(),
    /** Interfaz del ARP estático (amarre IP-MAC) y servidor DHCP del lease si el router no los define */
    ROUTEROS_INTERFAZ_CLIENTES: Env.schema.string.optional(),
    ROUTEROS_DHCP_SERVIDOR: Env.schema.string.optional(),
    /** ms entre reconciliaciones completas (900000) y entre sondeos de routers caídos (30000) */
    ROUTEROS_RECONCILIAR_CADA_MS: Env.schema.number.optional(),
    ROUTEROS_RECUPERAR_CADA_MS: Env.schema.number.optional(),

    /*
    |----------------------------------------------------------
    | Notificaciones (A6): correo SMTP, Telegram y datos de la empresa en plantillas
    |----------------------------------------------------------
    */
    SMTP_HOST: Env.schema.string.optional({ format: 'host' }),
    SMTP_PORT: Env.schema.number.optional(),
    SMTP_SECURE: Env.schema.boolean.optional(),
    SMTP_USER: Env.schema.string.optional(),
    SMTP_PASSWORD: Env.schema.string.optional(),
    MAIL_FROM: Env.schema.string.optional(),
    TELEGRAM_BOT_TOKEN: Env.schema.string.optional(),
    TELEGRAM_API_ROOT: Env.schema.string.optional(),
    /** Bot (webhook y vinculación, `contratos/telegram.md`) */
    TELEGRAM_BOT_NOMBRE: Env.schema.string.optional(),
    TELEGRAM_WEBHOOK_SECRET: Env.schema.string.optional(),
    TELEGRAM_WEBHOOK_URL: Env.schema.string.optional(),
    TELEGRAM_CODIGO_VIGENCIA_S: Env.schema.number.optional(),
    NOTIFY_INTENTOS: Env.schema.number.optional(),
    NOTIFY_EMPRESA_NOMBRE: Env.schema.string.optional(),
    NOTIFY_EMPRESA_TELEFONO: Env.schema.string.optional(),
    NOTIFY_PORTAL_URL: Env.schema.string.optional(),
    TELEGRAM_CHAT_EQUIPO: Env.schema.string.optional(),
    NOTIFY_CRON_TOLERANCIA_MIN: Env.schema.number.optional(),
    /** Bearer de GET /metrics (Prometheus). Vacío = /metrics responde 404. */
    METRICS_TOKEN: Env.schema.string.optional(),

    /*
    |----------------------------------------------------------
    | Seguridad
    |----------------------------------------------------------
    */
    INTERNAL_TOKEN: Env.schema.string(),
    /** 32 bytes en base64: cifra pass_ppp y secretos de routers (formato v1, la comparten aaa y coa) */
    AAA_PPP_KEY: Env.schema.string.optional(),
    ACCESS_TOKEN_EXPIRA: Env.schema.string.optional(),
    CORS_ORIGINS: Env.schema.string.optional(),

    /*
    |----------------------------------------------------------
    | Seed del usuario administrador de laboratorio
    |----------------------------------------------------------
    */
    SEED_ADMIN_EMAIL: Env.schema.string.optional(),
    SEED_ADMIN_PASSWORD: Env.schema.string.optional(),
    SEED_ADMIN_NOMBRE: Env.schema.string.optional(),

    /*
    |----------------------------------------------------------
    | Portal: identificación del cliente por IP (GET /portal/quien-soy)
    |----------------------------------------------------------
    */
    PORTAL_PROXIES_CONFIABLES: Env.schema.string.optional(),
    PORTAL_CABECERA_IP: Env.schema.string.optional(),
    /** Límite por IP de los endpoints públicos del portal (`app/portal/limite_peticiones.ts`) y prefijo en Redis. */
    PORTAL_LIMITE_PETICIONES: Env.schema.number.optional(),
    // límite de POST /auth/login (A1, `app/core/auth/limite_login.ts`)
    LOGIN_LIMITE_IP: Env.schema.number.optional(),
    LOGIN_LIMITE_USUARIO: Env.schema.number.optional(),
    LOGIN_LIMITE_VENTANA_S: Env.schema.number.optional(),
    LOGIN_LIMITE_PREFIJO: Env.schema.string.optional(),
    PORTAL_LIMITE_VENTANA_S: Env.schema.number.optional(),
    PORTAL_REDIS_PREFIJO: Env.schema.string.optional(),
    /** Ventana de auditoría de quien-soy y estado (`app/portal/auditoria_unica.ts`). */
    PORTAL_AUDITORIA_VENTANA_S: Env.schema.number.optional(),
    /** Acceso por código y sesión del portal (`app/portal/acceso/codigos.ts`). */
    PORTAL_CODIGO_VIGENCIA_S: Env.schema.number.optional(),
    PORTAL_CODIGO_INTENTOS: Env.schema.number.optional(),
    PORTAL_CODIGO_MAX_HORA: Env.schema.number.optional(),
    PORTAL_SESION_INACTIVIDAD_S: Env.schema.number.optional(),
    PORTAL_SESION_MAX_S: Env.schema.number.optional(),
    /** `Secure` de la cookie del portal: `auto` (HTTPS detectado) o `siempre` (`app/portal/acceso/sesion.ts`). */
    PORTAL_COOKIE_SEGURA: Env.schema.enum.optional(['auto', 'siempre'] as const),

    /*
    |----------------------------------------------------------
    | Billing: archivos de comprobantes de depósito (`app/billing/comprobantes_archivos.ts`)
    |----------------------------------------------------------
    */
    COMPROBANTES_DIR: Env.schema.string.optional(),

    /*
    |----------------------------------------------------------
    | Billing: pasarela de pago en línea (`app/billing/pasarelas`)
    |----------------------------------------------------------
    */
    /** Proveedor activo (`falsa` por defecto fuera de producción; en producción sin él no hay pasarela). */
    PASARELA_PROVEEDOR: Env.schema.string.optional(),
    /** Secreto HMAC de los webhooks de la pasarela falsa (laboratorio). */
    PASARELA_FALSA_SECRETO: Env.schema.string.optional(),
    /** URL pública de la API para armar `url_pago` de la pasarela falsa (p. ej. https://api.lab.local). */
    PASARELA_URL_PUBLICA: Env.schema.string.optional(),
    PASARELA_RETORNO_ORIGENES: Env.schema.string.optional(),
})
