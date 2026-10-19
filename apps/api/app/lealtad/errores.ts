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
