import { Problema, type ProblemaJson } from '#shared/errores'

/** 410: el enlace de conexión venció, ya se usó o no existe (§1.4). No se distingue cuál. */
export class EnlaceVencido extends Problema {
    constructor() {
        super(410, 'enlace_vencido', 'Enlace vencido', 'El enlace de conexión venció, ya se usó o no existe')
    }
}

/** 422: el conector está apagado o le falta configuración para lo que se pidió. */
export class ConectorNoDisponible extends Problema {
    constructor(detalle = 'El conector con Horus está apagado o sin configurar') {
        super(422, 'horus_apagado', 'Conector Horus no disponible', detalle)
    }
}

/**
 * 502: Horus no respondió o respondió con un error; `detail` lleva el error real (con la hora de
 * Guatemala si está en pausa). En pausa por la espera exponencial, el problem+json trae además la
 * extensión `reintentar_en` (ISO UTC, RFC 9457 §3.2) para que el panel la formatee.
 */
export class HorusRespondioError extends Problema {
    constructor(
        detalle: string,
        readonly reintentarEn: string | null = null,
    ) {
        super(502, 'horus_error', 'Error de Horus', detalle)
    }

    override toJSON(): ProblemaJson & { reintentar_en?: string } {
        const json: ProblemaJson & { reintentar_en?: string } = super.toJSON()
        if (this.reintentarEn) json.reintentar_en = this.reintentarEn
        return json
    }
}
