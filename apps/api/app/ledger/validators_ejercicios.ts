import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { dinero, empresasConsulta, fechaIso, idEntidad, motivo } from '#shared/validadores'

/*
| Cierre anual y balance de comprobación (fase 6 PR C, contrato §9.1 y §10.8)
*/

const empresa = idEntidad().nullable().optional().meta({
    description: 'Empresa cuyo ejercicio se cierra o reabre; por defecto la activa (X-Empresa-Id)',
})
const anio = vine.number().withoutDecimals().range([2000, 2100])

export const cerrarEjercicioValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        anio,
        isr: vine
            .object({
                monto: dinero(),
                acreditado_trimestral: dinero().nullable().optional().meta({
                    description: 'Pagos trimestrales que se acreditan (1.1.07), ≤ su saldo al 31-dic',
                }),
                acreditado_iso: dinero().nullable().optional().meta({
                    description: 'ISO que se acredita (1.1.08), ≤ su saldo al 31-dic',
                }),
                nota: vine.string().trim().maxLength(500).nullable().optional().meta({
                    description: 'De dónde sale el monto (formulario, cálculo del contador…)',
                }),
            })
            .meta({
                description:
                    'ISR del cierre: monto obligatorio (0.00 si no hay); lo escribe el usuario hasta que existan las declaraciones. Queda en el cierre y en la auditoría',
            }),
    }),
)

export const reabrirEjercicioValidator = vine.compile(vine.object({ empresa_id: empresa, anio, motivo: motivo() }))

export const listarEjerciciosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        empresas: empresasConsulta(),
        estado: vine.enum(['cerrado', 'reabierto'] as const).optional(),
        anio: anio.clone().optional(),
    }),
)

export const comprobacionValidator = vine.compile(
    vine.object({
        empresas: empresasConsulta(),
        desde: fechaIso().optional().meta({ description: 'Por defecto el 1 de enero del año de hasta' }),
        hasta: fechaIso().optional().meta({ description: 'Por defecto hoy (Guatemala)' }),
        sin_cierre_anual: vine
            .boolean()
            .optional()
            .meta({ description: 'Sin los asientos del cierre anual: el balance antes del cierre' }),
    }),
)
