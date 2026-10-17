import { Problema } from '#shared/errores'

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

/** 502: Horus no respondió o respondió con un error; `detail` lleva el error real. */
export class HorusRespondioError extends Problema {
    constructor(detalle: string) {
        super(502, 'horus_error', 'Error de Horus', detalle)
    }
}
