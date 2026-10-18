import { Problema } from '#shared/errores'

/** Errores de FEL (RFC 9457; contrato §11.4). */

export class FelNoConfigurada extends Problema {
    constructor(detalle: string) {
        super(422, 'fel_no_configurada', 'FEL no configurada', detalle, [
            { field: 'empresa_id', message: detalle, rule: 'fel_no_configurada' },
        ])
    }
}

export class FelProveedorNoDisponible extends Problema {
    constructor(detalle: string) {
        super(503, 'fel_proveedor_no_disponible', 'Certificador no disponible', detalle)
    }
}

export class ReceptorRequerido extends Problema {
    constructor(total: string, limite: string) {
        const detalle = `El total (Q${total}) llega al límite de consumidor final (Q${limite}): el cliente necesita NIT, CUI o pasaporte`
        super(422, 'receptor_requerido', 'Receptor requerido', detalle, [
            { field: 'cliente_id', message: detalle, rule: 'receptor_requerido' },
        ])
    }
}

export class CertificarAlIncompatible extends Problema {
    constructor(detalle: string) {
        super(422, 'certificar_al_incompatible', 'certificar_al incompatible', detalle, [
            { field: 'modo', message: detalle, rule: 'certificar_al_incompatible' },
        ])
    }
}

const ESTADO_EN_PROCESO: Record<string, string> = {
    enviando: 'se está enviando al certificador; intenta de nuevo en un momento',
    pendiente: 'está pendiente de certificar (en cola)',
    error_temporal: 'está en cola por un error temporal del certificador',
    contingencia: 'está en contingencia, esperando transmitirse',
    anulacion_pendiente: 'tiene la anulación pendiente de confirmar con el certificador',
}

/** 409: el DTE del documento no está en un estado final; el mensaje dice el estado real. */
export class DteEnProceso extends Problema {
    constructor(dteId: number, estado: string = 'enviando') {
        super(
            409,
            'dte_en_proceso',
            'DTE en proceso',
            `El DTE ${dteId} ${ESTADO_EN_PROCESO[estado] ?? `está ${estado}`}`,
            [{ field: 'dte_id', message: estado, rule: 'dte_en_proceso' }],
        )
    }
}

export class AnulacionFueraDePlazo extends Problema {
    constructor(limite: string) {
        const detalle = `El plazo para anular el DTE venció el ${limite}: emite una nota de crédito (POST /facturas/:id/notas-credito)`
        super(422, 'anulacion_fuera_de_plazo', 'Anulación fuera de plazo', detalle, [
            { field: 'factura_id', message: detalle, rule: 'anulacion_fuera_de_plazo' },
        ])
    }
}

export class NotaFueraDePlazo extends Problema {
    constructor(meses: number) {
        const detalle = `La factura tiene más de ${meses} meses: ya no admite notas de crédito ni de débito`
        super(422, 'nota_fuera_de_plazo', 'Nota fuera de plazo', detalle, [
            { field: 'factura_id', message: detalle, rule: 'nota_fuera_de_plazo' },
        ])
    }
}

export class TipoDteNoPermitido extends Problema {
    constructor(detalle: string) {
        super(422, 'tipo_dte_no_permitido', 'Tipo de DTE no permitido', detalle, [
            { field: 'factura_id', message: detalle, rule: 'tipo_dte_no_permitido' },
        ])
    }
}

/** 422 (H8): desactivar la FEL con avisos de cobro vivos sin certificar. */
export class AvisosPorCertificar extends Problema {
    constructor(avisos: number) {
        const detalle = `La empresa tiene ${avisos} avisos de cobro sin DTE certificado: su IVA está en 2.1.11 y quedaría sin declarar. Certifícalos o anúlalos antes de desactivar la FEL (la reclasificación masiva la decide el contador)`
        super(422, 'avisos_por_certificar', 'Avisos por certificar', detalle, [
            { field: 'modo', message: `${avisos} avisos por certificar`, rule: 'avisos_por_certificar' },
        ])
    }
}

export class SustitucionNoPermitida extends Problema {
    constructor(detalle: string) {
        super(409, 'sustitucion_no_permitida', 'Sustitución no permitida', detalle)
    }
}
