import { Conflicto, Problema } from '#shared/errores'

/**
 * Errores RFC 9457 del programa de lealtad (`contratos/lealtad.md` §15). Los de canje y sorteos
 * llegan con sus fases.
 */

/** 422 `programa_inactivo`: ganar, ajustar o canjear sin programa activo en la empresa. */
export class ProgramaInactivo extends Problema {
    constructor(empresaId: number) {
        super(
            422,
            'programa_inactivo',
            'Programa de lealtad inactivo',
            `La empresa ${empresaId} no tiene un programa de lealtad activo`,
        )
    }
}

/** 409 `programa_activo_existente`: segundo programa activo en la empresa. */
export class ProgramaActivoExistente extends Conflicto {
    constructor(empresaId: number, programaId: number) {
        super(
            `La empresa ${empresaId} ya tiene activo el programa ${programaId}: desactívelo primero`,
            'programa_activo_existente',
            'Ya hay un programa activo',
        )
    }
}

/** 422 `saldo_insuficiente`: saldo de puntos menor al pedido (o negativo). */
export class SaldoInsuficiente extends Problema {
    constructor(saldo: number, pedido: number) {
        super(
            422,
            'saldo_insuficiente',
            'Saldo de puntos insuficiente',
            `El cliente tiene ${saldo} puntos y se piden ${pedido}`,
        )
    }
}

/** 422 `servicio_no_valido`: servicio de otra empresa, retirado o cliente sin servicio en la empresa. */
export class ServicioNoValido extends Problema {
    constructor(detalle: string) {
        super(422, 'servicio_no_valido', 'Servicio no válido', detalle)
    }
}

/** 422 `referido_invalido`: autorreferido, mismo NIT o CUI, código inexistente o ya referido. */
export class ReferidoInvalido extends Problema {
    constructor(detalle: string) {
        super(422, 'referido_invalido', 'Referido inválido', detalle)
    }
}

/** 409 `sin_existencias`: premio agotado. */
export class SinExistencias extends Conflicto {
    constructor(premioId: number) {
        super(`El premio ${premioId} no tiene existencias`, 'sin_existencias', 'Premio agotado')
    }
}

/** 409 `canje_pendiente`: ya hay un descuento reservado para el servicio. */
export class CanjePendiente extends Conflicto {
    constructor(canjeId: number) {
        super(
            `El servicio ya tiene el descuento ${canjeId} reservado para su próxima factura`,
            'canje_pendiente',
            'Canje pendiente',
        )
    }
}

/** 409 `canje_no_revertible`: canje entregado o aplicado a una factura vigente. */
export class CanjeNoRevertible extends Conflicto {
    constructor(detalle: string) {
        super(detalle, 'canje_no_revertible', 'Canje no revertible')
    }
}

/** 422 `parametro_sin_confirmar`: falta una decisión del contador (`premio_bien_iva`, `mejora_facturacion`). */
export class ParametroSinConfirmar extends Problema {
    constructor(parametro: string) {
        super(
            422,
            'parametro_sin_confirmar',
            'Parámetro sin confirmar',
            `Falta la decisión del contador sobre ${parametro} (contrato de lealtad §17)`,
        )
    }
}
