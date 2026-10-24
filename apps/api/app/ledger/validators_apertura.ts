import vine from '@vinejs/vine'
import { fechaIso, idEntidad } from '#shared/validadores'
import { DESTINOS_APERTURA } from '#ledger/apertura'

/*
| Cierre de los saldos de apertura (contrato de localización fiscal §23)
*/

const empresa = idEntidad().nullable().optional().meta({
    description: 'Empresa cuyo 2.9.01 se cierra o se consulta; por defecto la activa (X-Empresa-Id)',
})

export const cerrarAperturaValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        fecha: fechaIso().nullable().optional().meta({
            description:
                'Fecha del asiento y corte del saldo de 2.9.01 (por defecto hoy, Guatemala; no futura)',
        }),
        cuenta_destino: vine.enum(DESTINOS_APERTURA).nullable().optional().meta({
            description:
                'Cuenta de patrimonio que recibe el saldo: 3.3.01 Utilidades acumuladas (por defecto) o 3.1.01 Capital social',
        }),
        nota: vine.string().trim().maxLength(300).nullable().optional().meta({
            description:
                'Se agrega a la descripción del asiento (p. ej. «importación desde Mikrowisp terminada»)',
        }),
    }),
)

export const estadoAperturaValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        fecha: fechaIso()
            .optional()
            .meta({ description: 'Saldo de 2.9.01 al día (por defecto hoy, Guatemala)' }),
    }),
)
