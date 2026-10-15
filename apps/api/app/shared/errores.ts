import { Exception } from '@adonisjs/core/exceptions'

/**
 * Errores RFC 9457 (`application/problem+json`).
 *
 * Toda respuesta de error de la API tiene la forma `ProblemaJson`. Las acciones lanzan alguna
 * subclase de `Problema`; el exception handler convierte además los errores de VineJS, auth,
 * Lucid y Postgres (ver `app/exceptions/handler.ts`).
 */

export interface ErrorCampo {
    field: string
    message: string
    rule?: string
}

export interface ProblemaJson {
    type: string
    title: string
    status: number
    detail?: string
    errors?: ErrorCampo[]
}

/** URI estable del tipo de problema; los frontends pueden decidir por `type`. */
export function tipoProblema(codigo: string): string {
    return `urn:argosisp:problema:${codigo}`
}

export class Problema extends Exception {
    readonly tipo: string
    readonly titulo: string
    readonly detalle?: string
    readonly errores?: ErrorCampo[]

    constructor(status: number, codigo: string, titulo: string, detalle?: string, errores?: ErrorCampo[]) {
        super(detalle ?? titulo, { status, code: `E_${codigo.toUpperCase()}` })
        this.tipo = tipoProblema(codigo)
        this.titulo = titulo
        this.detalle = detalle
        this.errores = errores
    }

    toJSON(): ProblemaJson {
        const json: ProblemaJson = { type: this.tipo, title: this.titulo, status: this.status }
        if (this.detalle) json.detail = this.detalle
        if (this.errores && this.errores.length > 0) json.errors = this.errores
        return json
    }
}

export class SolicitudInvalida extends Problema {
    constructor(detalle?: string, errores?: ErrorCampo[]) {
        super(400, 'solicitud_invalida', 'Solicitud inválida', detalle, errores)
    }
}

export class NoAutenticado extends Problema {
    constructor(detalle = 'Se requiere un token Bearer válido') {
        super(401, 'no_autenticado', 'No autenticado', detalle)
    }
}

export class CredencialesInvalidas extends Problema {
    constructor() {
        super(401, 'credenciales_invalidas', 'Credenciales inválidas', 'Correo o contraseña incorrectos')
    }
}

export class Prohibido extends Problema {
    constructor(detalle = 'No tienes permiso para esta acción') {
        super(403, 'prohibido', 'Permiso insuficiente', detalle)
    }
}

export class NoEncontrado extends Problema {
    constructor(detalle = 'El recurso no existe') {
        super(404, 'no_encontrado', 'No encontrado', detalle)
    }
}

export class Conflicto extends Problema {
    constructor(detalle: string, codigo = 'conflicto', titulo = 'Conflicto') {
        super(409, codigo, titulo, detalle)
    }
}

/** La entidad cambió desde que el cliente la leyó (control optimista por `version`). */
export class ConflictoVersion extends Problema {
    constructor(entidad: string, id: number | string) {
        super(
            409,
            'conflicto_version',
            'Conflicto de versión',
            `${entidad} ${id} fue modificado por otra sesión; recarga y vuelve a intentar`,
        )
    }
}

export class ValidacionFallida extends Problema {
    constructor(errores: ErrorCampo[], detalle = 'Los datos enviados no son válidos') {
        super(422, 'validacion', 'Datos inválidos', detalle, errores)
    }
}

/** Una regla de negocio impide la acción (no es un error de formato). */
export class ReglaNegocio extends Problema {
    constructor(detalle: string, codigo = 'regla_negocio') {
        super(422, codigo, 'Regla de negocio', detalle)
    }
}

export class NoImplementado extends Problema {
    constructor(operacion: string) {
        super(501, 'no_implementado', 'No implementado', `La operación ${operacion} aún no está implementada`)
    }
}
