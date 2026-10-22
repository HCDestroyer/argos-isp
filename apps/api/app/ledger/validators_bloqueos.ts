import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { empresasConsulta, fechaIso, idEntidad, instanteIso, motivo } from '#shared/validadores'
import { TIPOS_BLOQUEO, TIPOS_EXCEPCION } from '#ledger/bloqueos'

/** Bloqueos del libro y excepciones (contrato de localización fiscal §10.4, fase 6). */

const empresa = idEntidad().nullable().optional().meta({
    description: 'Empresa cuyo libro se bloquea; por defecto la activa (X-Empresa-Id)',
})

export const bloqueosVigentesValidator = vine.compile(vine.object({ empresas: empresasConsulta() }))

export const listarBloqueosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        empresas: empresasConsulta(),
        tipo: vine.enum(TIPOS_BLOQUEO).optional(),
    }),
)

export const bloquearValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        tipo: vine.enum(TIPOS_EXCEPCION).meta({ description: 'global, ventas, compras o impuestos' }),
        hasta: fechaIso(),
        motivo: motivo(),
    }),
)

export const bloquearDuroValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        hasta: fechaIso(),
        motivo: motivo(),
        confirmacion: vine
            .string()
            .trim()
            .maxLength(40)
            .meta({ description: 'Exactamente «BLOQUEO DURO hasta AAAA-MM-DD», con la misma fecha' }),
    }),
)

export const desbloquearValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        tipo: vine
            .enum(['global', 'ventas', 'compras'] as const)
            .optional()
            .meta({ description: 'Por defecto global; impuestos y duro no retroceden' }),
        hasta: fechaIso()
            .nullable()
            .optional()
            .meta({ description: 'Nuevo bloqueo, anterior al vigente; null = sin bloqueo de ese tipo' }),
        motivo: motivo(),
    }),
)

export const listarExcepcionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        empresas: empresasConsulta(),
        tipo: vine.enum(TIPOS_EXCEPCION).optional(),
        estado: vine.enum(['vigente', 'vencida', 'revocada'] as const).optional(),
    }),
)

export const crearExcepcionValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        tipo: vine
            .enum(TIPOS_BLOQUEO)
            .meta({ description: 'Tipo de bloqueo que cubre; duro → 422 excepcion_sin_fin' }),
        usuario_id: idEntidad().nullable().optional().meta({ description: 'null = todos los usuarios' }),
        motivo: motivo(),
        hasta_en: instanteIso()
            .nullable()
            .optional()
            .meta({ description: 'Fin de la excepción, futuro; sin él → 422 excepcion_sin_fin' }),
    }),
)

export const revocarExcepcionValidator = vine.compile(vine.object({ motivo: motivo() }))

/*
| Lista de verificación de cierre (§10.5)
*/

export const checksValidator = vine.compile(
    vine.object({
        empresa_id: empresa,
        historial: vine
            .boolean()
            .optional()
            .meta({ description: 'Todas las filas, la más reciente primero' }),
    }),
)

export const verificarCierreValidator = vine.compile(vine.object({ empresa_id: empresa }))

export const revisarCheckValidator = vine.compile(
    vine.object({
        estado: vine.enum(['supervisado', 'anomalia'] as const).meta({
            description: 'supervisado deja pasar el cierre con esa anomalía; anomalia retira la supervisión',
        }),
        nota: motivo(),
    }),
)
