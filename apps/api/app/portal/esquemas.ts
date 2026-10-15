import { Dinero, booleano, definirEsquema, entero, nulable, objeto, texto } from '#shared/openapi/esquemas'
import { EstadoServicio } from '#core/esquemas'

/**
 * Schemas del portal del cliente (A5). Desde la IP solo se muestra información mínima:
 * nombre recortado, estado del servicio y montos. Nunca datos personales completos.
 */

export const FacturasVencidasResumen = definirEsquema(
    'FacturasVencidasResumen',
    objeto({
        cantidad: { ...entero, minimum: 0, description: 'Número de facturas vencidas con saldo' },
        total: { ...Dinero, description: 'Saldo pendiente de las facturas vencidas' },
    }),
)

export const QuienSoy = definirEsquema(
    'QuienSoy',
    objeto({
        identificado: {
            ...booleano,
            description: 'false si la IP de origen no pertenece a ningún servicio',
        },
        ip: { ...texto, description: 'IP de origen con la que la API identificó la petición' },
        nombre_parcial: { ...nulable(texto), description: 'Nombre recortado, p. ej. "Juan P."' },
        estado: nulable(EstadoServicio),
        promesa_activa: { ...nulable(booleano), description: 'Hay una promesa de pago activa' },
        monto_adeudado: {
            ...nulable(Dinero),
            description:
                'Suma del saldo de las facturas pendientes del servicio (emitidas, parciales y vencidas)',
        },
        facturas_vencidas: nulable(FacturasVencidasResumen),
    }),
)

export const EstadoPortal = definirEsquema(
    'EstadoPortal',
    objeto({
        identificado: {
            ...booleano,
            description: 'false si la IP de origen no pertenece a ningún servicio',
        },
        estado: nulable(EstadoServicio),
        monto_adeudado: {
            ...nulable(Dinero),
            description: 'Saldo de las facturas pendientes del servicio (emitidas, parciales y vencidas)',
        },
    }),
)
