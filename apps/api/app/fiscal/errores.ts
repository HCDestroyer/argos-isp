import { Problema, type ErrorCampo } from '#shared/errores'

/**
 * Errores del módulo fiscal (RFC 9457; contrato §10.4). Todos llevan `errors[]` por campo cuando
 * aplica: `errors[0].field` es la clave del parámetro o el campo del cuerpo.
 */

/** 422: país sin paquete de localización. */
export class PaisNoSoportado extends Problema {
    constructor(pais: string) {
        super(
            422,
            'pais_no_soportado',
            'País no soportado',
            `No hay paquete de localización para el país ${pais}`,
            [{ field: 'pais', message: `Sin paquete para ${pais}`, rule: 'pais_no_soportado' }],
        )
    }
}

/** 422: operación fiscal en una empresa sin localización instalada. */
export class LocalizacionNoInstalada extends Problema {
    constructor(empresaId: number) {
        super(
            422,
            'localizacion_no_instalada',
            'Localización no instalada',
            `La empresa ${empresaId} no tiene localización fiscal instalada (POST /fiscal/empresas/${empresaId}/actualizar-localizacion)`,
            [{ field: 'empresa_id', message: 'Sin localización fiscal', rule: 'localizacion_no_instalada' }],
        )
    }
}

/** 422: parámetro de alcance N (lo fija la ley) o que se cambia con su propia acción. */
export class ParametroNoEditable extends Problema {
    constructor(clave: string, detalle: string) {
        super(422, 'parametro_no_editable', 'Parámetro no editable', detalle, [
            { field: clave, message: detalle, rule: 'parametro_no_editable' },
        ])
    }
}

/** 422: valor fuera de `minimo`/`maximo`, de las opciones o del tipo del parámetro. */
export class ParametroFueraDeRango extends Problema {
    constructor(errores: ErrorCampo[], detalle = 'El valor no es válido para el parámetro') {
        super(422, 'parametro_fuera_de_rango', 'Parámetro fuera de rango', detalle, errores)
    }
}

/**
 * 422: el cálculo necesita un parámetro sin valor (marcado «confirmar con contador»). Nada se
 * inventa: el contador lo llena con `POST /fiscal/parametros/:clave/valores`.
 */
export class ParametroSinConfirmar extends Problema {
    constructor(clave: string, fecha: string) {
        super(
            422,
            'parametro_sin_confirmar',
            'Parámetro sin confirmar',
            `El parámetro ${clave} no tiene valor vigente al ${fecha}; debe confirmarlo el contador`,
            [{ field: clave, message: `Sin valor vigente al ${fecha}`, rule: 'parametro_sin_confirmar' }],
        )
    }
}

/** 422: `vigente_desde` dentro de un periodo ya cerrado o bloqueado (cambiaría lo reportado). */
export class VigenciaEnPeriodoBloqueado extends Problema {
    constructor(vigenteDesde: string, periodo: string) {
        super(
            422,
            'vigencia_en_periodo_bloqueado',
            'Vigencia en periodo bloqueado',
            `vigente_desde ${vigenteDesde} cae en un periodo cerrado (${periodo}); use una fecha posterior`,
            [
                {
                    field: 'vigente_desde',
                    message: `Periodo ${periodo} cerrado`,
                    rule: 'vigencia_en_periodo_bloqueado',
                },
            ],
        )
    }
}

/** 422: cambio de régimen que no empieza el 1 de enero o sin el aviso a la SAT de diciembre. */
export class RegimenFueraDePlazo extends Problema {
    constructor(campo: string, detalle: string) {
        super(422, 'regimen_fuera_de_plazo', 'Régimen fuera de plazo', detalle, [
            { field: campo, message: detalle, rule: 'regimen_fuera_de_plazo' },
        ])
    }
}
