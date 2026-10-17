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

export class DteEnProceso extends Problema {
    constructor(dteId: number) {
        super(
            409,
            'dte_en_proceso',
            'DTE en proceso',
            `El DTE ${dteId} se está enviando al certificador; intenta de nuevo en un momento`,
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

export class SustitucionNoPermitida extends Problema {
    constructor(detalle: string) {
        super(409, 'sustitucion_no_permitida', 'Sustitución no permitida', detalle)
    }
}
