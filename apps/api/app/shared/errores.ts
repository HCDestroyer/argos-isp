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

/**
 * Nombre para el operador de una entidad que llega como tabla (`core.servicios`) o identificador
 * (`plantilla_facturacion`): el `detail` nunca muestra nombres internos de la base.
 */
const NOMBRES_ENTIDAD: Record<string, string> = {
    'core.servicios': 'El servicio',
    servicio: 'El servicio',
    'core.clientes': 'El cliente',
    'core.empresas': 'La empresa',
    'core.usuarios': 'El usuario',
    'core.roles': 'El rol',
    'core.zonas': 'La zona',
    'core.adicionales': 'El adicional',
    'core.servicios_adicionales': 'El adicional del servicio',
    'core.anuncios': 'El anuncio',
    'core.campos_personalizados': 'El campo personalizado',
    'campo personalizado': 'El campo personalizado',
    'core.motivos_cortesia': 'El motivo de cortesía',
    'motivo de cortesía': 'El motivo de cortesía',
    'core.plantillas_documentos': 'La plantilla de documento',
    'billing.plantillas_facturacion': 'La plantilla de facturación',
    plantilla_facturacion: 'La plantilla de facturación',
    'network.planes': 'El plan',
    'network.planes_adicionales': 'La lista de adicionales del plan',
    'network.planes_routers': 'La implementación del plan en el router',
    'network.routers': 'El router',
    'network.redes_ipv4': 'La red IPv4',
    'network.ipv6_bloques': 'El bloque IPv6',
    'network.ipv6_pools': 'El pool IPv6',
    'notify.plantillas': 'La plantilla de notificación',
    'notify.recordatorios': 'El recordatorio',
    'notify.configuracion_canales': 'La configuración de notificaciones',
    'integraciones.horus_conector': 'La configuración de Horus',
    regla_conciliacion: 'La regla de conciliación',
    proveedor_cobro: 'El proveedor de cobro',
    proveedor: 'El proveedor',
    producto: 'El producto',
    bodega: 'La bodega',
    conteo: 'El conteo',
}

export function nombreEntidad(entidad: string): string {
    const conocido = NOMBRES_ENTIDAD[entidad]
    if (conocido) return conocido
    // tabla o identificador sin traducción: nunca se muestra tal cual
    if (/^[a-z0-9_]+(\.[a-z0-9_]+)?$/.test(entidad) && /[._]/.test(entidad)) return 'El registro'
    return entidad
}

/** La entidad cambió desde que el cliente la leyó (control optimista por `version`). */
export class ConflictoVersion extends Problema {
    constructor(entidad: string, id: number | string) {
        super(
            409,
            'conflicto_version',
            'Conflicto de versión',
            `${nombreEntidad(entidad)} ${id} cambió en otra sesión; recarga y vuelve a intentar`,
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
    /** `errores`: detalle por elemento (p. ej. los servicios que impiden migrar un pool). */
    constructor(detalle: string, codigo = 'regla_negocio', errores?: ErrorCampo[]) {
        super(422, codigo, 'Regla de negocio', detalle, errores)
    }
}

/** 501: la ruta existe en el contrato pero este servidor no la atiende. */
export class NoImplementado extends Problema {
    constructor() {
        super(
            501,
            'no_implementado',
            'Operación no disponible',
            'Esta operación no está disponible en este servidor. Si la necesitas, avisa al administrador del sistema',
        )
    }
}
