import {
    Dinero,
    definirEsquema,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { Asiento } from '#ledger/esquemas'
import { DESTINOS_APERTURA } from '#ledger/apertura'

/**
 * Schemas del cierre de los saldos de apertura (contrato de localización fiscal §23).
 */

const destino = {
    ...enumerado([...DESTINOS_APERTURA]),
    description: 'Cuenta de patrimonio que recibió el saldo',
}

export const CierreAperturaAsiento = definirEsquema(
    'CierreAperturaAsiento',
    objeto({
        asiento_id: id,
        fecha,
        cuenta_destino: destino,
        monto: {
            ...Dinero,
            description: 'Saldo de 2.9.01 que canceló (debe − haber antes del cierre; negativo = acreedor)',
        },
        created_at: instante,
    }),
)

const estado = {
    empresa_id: id,
    fecha: { ...fecha, description: 'Corte del saldo' },
    cuenta: { ...texto, description: 'Siempre 2.9.01' },
    saldo: {
        ...Dinero,
        description:
            'Saldo de 2.9.01 al corte (debe − haber; negativo = acreedor). 0.00 = el check apertura_cero pasa',
    },
    cierres: {
        ...lista(CierreAperturaAsiento),
        description: 'Cierres de apertura vigentes (sin reverso), el más reciente primero',
    },
}

export const EstadoApertura = definirEsquema('EstadoApertura', objeto(estado))

export const CierreApertura = definirEsquema(
    'CierreApertura',
    objeto({
        ...estado,
        cuenta_destino: destino,
        trasladado: {
            ...Dinero,
            description:
                'Saldo de 2.9.01 que se trasladó (debe − haber antes del cierre); 0.00 si ya estaba en cero',
        },
        asiento: {
            ...nulable(Asiento),
            description: 'Asiento del cierre; null si no había saldo (idempotente)',
        },
    }),
)
