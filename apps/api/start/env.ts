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
    NOTIFY_INTENTOS: Env.schema.number.optional(),
    NOTIFY_EMPRESA_NOMBRE: Env.schema.string.optional(),
    NOTIFY_EMPRESA_TELEFONO: Env.schema.string.optional(),
    NOTIFY_PORTAL_URL: Env.schema.string.optional(),

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
})
