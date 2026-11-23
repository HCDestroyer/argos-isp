import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import {
    dinero,
    empresasConsulta,
    idEntidad,
    instanteIso,
    motivo,
    versionEsperada,
} from '#shared/validadores'
import { MODOS_PROMOCION, TIPOS_VELOCIDAD_PROMOCION } from '#core/promociones_velocidad'
import { ALCANCES_INCIDENTE } from '#network/incidentes_red'

/*
|--------------------------------------------------------------------------
| Decisiones del PM 17–31 (A1): promociones, ajustes, código, recuperación, IP, incidentes
|--------------------------------------------------------------------------
*/

const horaLocal = () =>
    vine
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .meta({ description: 'HH:MM, hora de Guatemala' })

/** `POST /promociones-velocidad` (decisión del PM 18). */
export const crearPromocionVelocidadValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
        nombre: vine.string().trim().minLength(3).maxLength(120),
        descripcion: vine.string().trim().maxLength(500).nullable().optional(),
        tipo_velocidad: vine.enum(TIPOS_VELOCIDAD_PROMOCION).meta({
            description: '`multiplicador` (x2 duplica la velocidad del plan) o `plan_destino` (su velocidad)',
        }),
        multiplicador: vine.number().min(1.01).max(10).decimal([0, 2]).nullable().optional(),
        plan_destino_id: idEntidad().nullable().optional(),
        modo: vine.enum(MODOS_PROMOCION).meta({
            description: '`dias`: todo el periodo; `franja`: cada día de `franja_inicio` a `franja_fin`',
        }),
        inicio: instanteIso(),
        fin: instanteIso(),
        franja_inicio: horaLocal().nullable().optional(),
        franja_fin: horaLocal()
            .nullable()
            .optional()
            .meta({ description: 'HH:MM; si es menor o igual que el inicio, termina al día siguiente' }),
        dias_semana: vine
            .array(vine.number().withoutDecimals().range([1, 7]))
            .minLength(1)
            .maxLength(7)
            .distinct()
            .nullable()
            .optional()
            .meta({ description: '1 = lunes … 7 = domingo; sin ellos, todos los días (solo con `franja`)' }),
        precio: dinero()
            .nullable()
            .optional()
            .meta({ description: 'Precio mensual mientras dure; sin él no cambia el precio' }),
        servicio_ids: vine.array(idEntidad()).maxLength(500).distinct().optional(),
    }),
)

export const asignarPromocionVelocidadValidator = vine.compile(
    vine.object({ servicio_ids: vine.array(idEntidad()).minLength(1).maxLength(500).distinct() }),
)

export const quitarPromocionVelocidadValidator = vine.compile(
    vine.object({ motivo: motivo().nullable().optional() }),
)

export const cancelarPromocionVelocidadValidator = vine.compile(
    vine.object({ version: versionEsperada(), motivo: motivo() }),
)

export const listarPromocionesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(['activa', 'cancelada'] as const).optional(),
        vigencia: vine
            .enum(['vigente', 'programada', 'terminada', 'cancelada'] as const)
            .optional()
            .meta({
                description:
                    'Pestaña del tablero: `vigente` (inicio ≤ ahora < fin), `programada` (inicio > ahora), ' +
                    '`terminada` (fin ≤ ahora) o `cancelada`; las tres primeras solo de las activas',
            }),
        q: vine.string().trim().minLength(1).maxLength(100).optional().meta({
            description: 'Busca en nombre y descripción',
        }),
        empresas: empresasConsulta(),
    }),
)

/** `GET /ajustes-operacion` y `PUT /ajustes-operacion`. */
export const verAjustesOperacionValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Sin ella, los globales' }),
    }),
)

export const editarAjustesOperacionValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().nullable().optional().meta({ description: 'null/ausente = globales' }),
        valores: vine.record(vine.any().nullable()).meta({
            description:
                'clave → valor (`retiro.orden_iris`, `codigo_corte.vigencia_min`, `caidas.umbral`…); null vuelve al global o de fábrica',
        }),
    }),
)

/** `POST /auth/recuperar-contrasena` (decisión del PM 22). */
export const solicitarRecuperacionValidator = vine.compile(
    vine.object({ email: vine.string().trim().email().toLowerCase().maxLength(200) }),
)

export const restablecerContrasenaValidator = vine.compile(
    vine.object({
        token: vine.string().trim().minLength(20).maxLength(200),
        password: vine.string().minLength(8).maxLength(200),
    }),
)

/** `GET /ip-historial` (decisión del PM 28). */
export const buscarHistorialIpValidator = vine.compile(
    vine.object({
        ip: vine.string().trim().maxLength(64).meta({ description: 'IPv4 o IPv6' }),
        /** fecha y hora buscada (ISO 8601, UTC u offset) */
        en: instanteIso(),
        empresas: empresasConsulta(),
    }),
)

/** Incidentes de red (decisión del PM 31, contrato Iris 0.13.0). */
export const listarIncidentesValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        estado: vine.enum(['abierto', 'cerrado'] as const).optional(),
        empresas: empresasConsulta(),
    }),
)

export const serviciosIncidenteValidator = vine.compile(
    vine.object({
        cursor: vine.string().trim().maxLength(200).optional(),
        limit: vine
            .number()
            .withoutDecimals()
            .range([1, 1000])
            .optional()
            .meta({ description: 'Hasta 1000' }),
        empresa_id: idEntidad().optional().meta({ description: 'Solo los servicios de esa empresa' }),
    }),
)

/** `GET /incidentes-red/:incidenteId/afectados` (tablero de fallas generales). */
export const afectadosIncidenteValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        empresas: empresasConsulta(),
    }),
)

export const abrirIncidenteRedValidator = vine.compile(
    vine.object({
        alcance: vine.enum(ALCANCES_INCIDENTE),
        alcance_id: idEntidad(),
        motivo: motivo(),
    }),
)

export const cerrarIncidenteRedValidator = vine.compile(vine.object({ motivo: motivo() }))

export const listarCaidasValidator = vine.compile(
    vine.object({ ...reglasPaginacion, empresas: empresasConsulta() }),
)
