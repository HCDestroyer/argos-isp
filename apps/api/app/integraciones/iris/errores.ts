import { Problema } from '#shared/errores'

/** 422: el conector Iris está apagado o le falta configuración para lo que se pidió. */
export class ConectorIrisNoDisponible extends Problema {
    constructor(detalle = 'El conector con Iris está apagado o sin configurar') {
        super(422, 'iris_apagado', 'Conector Iris no disponible', detalle)
    }
}

/** 502: Iris no respondió o respondió con un error; `detail` lleva el error real. */
export class IrisRespondioError extends Problema {
    constructor(detalle: string) {
        super(502, 'iris_error', 'Error de Iris', detalle)
    }
}
