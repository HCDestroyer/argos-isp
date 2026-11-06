import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { Problema, tipoProblema, type ErrorCampo, type ProblemaJson } from '#shared/errores'

/**
 * Toda respuesta de error sale como RFC 9457 `application/problem+json`.
 */
export default class HttpExceptionHandler extends ExceptionHandler {
    protected debug = !app.inProduction

    /** No se registran en el log como error. */
    // 429: límite de peticiones del portal, esperado bajo carga; no es un error del servidor.
    protected ignoreStatuses = [400, 401, 403, 404, 409, 413, 415, 422, 429, 501]

    async handle(error: unknown, ctx: HttpContext) {
        const cuerpo = aProblema(error, this.debug)
        ctx.response.status(cuerpo.status)
        ctx.response.header('Content-Type', 'application/problem+json; charset=utf-8')
        ctx.response.send(JSON.stringify(cuerpo))
    }

    async report(error: unknown, ctx: HttpContext) {
        return super.report(error, ctx)
    }
}

function problema(
    status: number,
    codigo: string,
    title: string,
    detail?: string,
    errors?: ErrorCampo[],
): ProblemaJson {
    const json: ProblemaJson = { type: tipoProblema(codigo), title, status }
    if (detail) json.detail = detail
    if (errors && errors.length > 0) json.errors = errors
    return json
}

interface ErrorConCodigo {
    code?: unknown
    status?: unknown
    message?: unknown
    constraint?: unknown
    detail?: unknown
}

/**
 * Restricciones de unicidad que respaldan una regla con su propio código (`#network/ipam_v4`,
 * `#network/ipam_v6`, `exigirUserPppLibre`). Las acciones ya responden ese código cuando lo ven antes
 * de escribir; esto cubre la carrera que solo detecta la base (dos transacciones a la vez).
 */
const RESTRICCIONES_UNICAS: Record<string, { codigo: string; detalle: string }> = {
    ipv4_asignaciones_ip_vigente: {
        codigo: 'ip_ocupada',
        detalle: 'La IP ya está asignada a otro servicio; elige otra',
    },
    ipv4_asignaciones_servicio_vigente: {
        codigo: 'concurrencia',
        detalle: 'Otra operación cambió la IPv4 del servicio a la vez; reintenta',
    },
    ipv6_asignaciones_prefijo_vigente: {
        codigo: 'prefijo_ocupado',
        detalle: 'El prefijo IPv6 ya está asignado a otro servicio',
    },
    ipv6_asignaciones_sin_traslape: {
        codigo: 'prefijo_ocupado',
        detalle: 'El prefijo IPv6 se traslapa con uno vigente de otro servicio',
    },
    ipv6_asignaciones_servicio_tipo_vigente: {
        codigo: 'concurrencia',
        detalle: 'Otra operación cambió los prefijos IPv6 del servicio a la vez; reintenta',
    },
    servicios_user_ppp_unico: {
        codigo: 'user_ppp_duplicado',
        detalle: 'El user_ppp ya existe en otro servicio (también en uno retirado); elige otro',
    },
}

/** Convierte cualquier error en un Problem JSON. */
export function aProblema(error: unknown, debug: boolean): ProblemaJson {
    if (error instanceof Problema) return error.toJSON()

    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        const mensajes = error.messages as Array<{ field: string; message: string; rule?: string }>
        return problema(
            422,
            'validacion',
            'Datos inválidos',
            'Los datos enviados no son válidos',
            mensajes.map((m) => ({
                field: m.field,
                message: m.message,
                ...(m.rule ? { rule: m.rule } : {}),
            })),
        )
    }

    const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorConCodigo
    const codigo = typeof e.code === 'string' ? e.code : undefined
    const mensaje = typeof e.message === 'string' ? e.message : undefined

    switch (codigo) {
        case 'E_UNAUTHORIZED_ACCESS':
            return problema(401, 'no_autenticado', 'No autenticado', 'Se requiere un token Bearer válido')
        case 'E_INVALID_CREDENTIALS':
            return problema(
                401,
                'credenciales_invalidas',
                'Credenciales inválidas',
                'Correo o contraseña incorrectos',
            )
        case 'E_ROUTE_NOT_FOUND':
            return problema(404, 'ruta_no_encontrada', 'No encontrado', mensaje)
        case 'E_ROW_NOT_FOUND':
            return problema(404, 'no_encontrado', 'No encontrado', 'El recurso no existe')
        // Postgres
        case '23505':
        case '23P01': {
            const conocida = RESTRICCIONES_UNICAS[String(e.constraint ?? '')]
            if (conocida) return problema(409, conocida.codigo, 'Conflicto', conocida.detalle)
            if (codigo === '23P01') {
                return problema(
                    409,
                    'traslape',
                    'Conflicto',
                    'Los datos se traslapan con un registro vigente',
                )
            }
            return problema(
                409,
                'duplicado',
                'Conflicto',
                `Ya existe un registro con esos datos (${String(e.constraint ?? '')})`,
            )
        }
        case '23503':
            return problema(
                422,
                'referencia_invalida',
                'Referencia inválida',
                'Un registro relacionado no existe o sigue en uso',
            )
        case '23514':
            return problema(422, 'restriccion', 'Restricción de datos', mensaje)
        case '40001':
        case '40P01':
            return problema(409, 'concurrencia', 'Conflicto de concurrencia', 'Reintenta la operación')
    }

    const status = typeof e.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500
    if (status < 500) {
        return problema(status, 'http_' + status, mensaje ?? 'Error en la solicitud', mensaje)
    }
    return problema(500, 'interno', 'Error interno', debug ? mensaje : undefined)
}
