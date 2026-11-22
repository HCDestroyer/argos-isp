import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/** Decisión del PM 18. */
export const PromocionVelocidad = definirEsquema(
    'PromocionVelocidad',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        descripcion: nulable(texto),
        tipo_velocidad: enumerado(['multiplicador', 'plan_destino']),
        multiplicador: { ...nulable(texto), description: 'Con `multiplicador`, p. ej. "2.00"' },
        plan_destino_id: nulable(id),
        plan_destino_nombre: nulable(texto),
        modo: enumerado(['dias', 'franja']),
        inicio: instante,
        fin: instante,
        franja_inicio: { ...nulable(texto), description: 'HH:MM, hora de Guatemala' },
        franja_fin: { ...nulable(texto), description: 'HH:MM, hora de Guatemala' },
        dias_semana: {
            ...nulable(lista({ type: 'integer', minimum: 1, maximum: 7 })),
            description: '1 = lunes',
        },
        precio: { ...nulable(Dinero), description: 'Precio mensual mientras dure; null = no cambia' },
        estado: enumerado(['activa', 'cancelada']),
        motivo_cancelacion: nulable(texto),
        cancelada_en: nulable(instante),
        creado_por: nulable(id),
        servicios: { ...entero, description: 'Servicios con la promoción asignada' },
        ...auditable,
    }),
)

export const PromocionServicio = definirEsquema(
    'PromocionServicio',
    objeto({
        id,
        promocion_id: id,
        promocion_nombre: texto,
        servicio_id: id,
        empresa_id: id,
        estado: enumerado(['vigente', 'quitada']),
        agregada_por: nulable(id),
        quitada_en: nulable(instante),
        motivo: nulable(texto),
        created_at: instante,
        tramo_abierto: {
            ...nulable(objeto({ id, inicio: instante, fin: instante })),
            description: 'Tramo en curso: la velocidad de la promoción está aplicada',
        },
    }),
)

const definicionAjuste = objeto({
    clave: texto,
    tipo: enumerado(['booleano', 'entero', 'opcion']),
    por_empresa: booleano,
    descripcion: texto,
    min: nulable(entero),
    max: nulable(entero),
    opciones: nulable(lista(texto)),
})

export const AjustesOperacion = definirEsquema(
    'AjustesOperacion',
    objeto({
        empresa_id: nulable(id),
        efectivo: { ...jsonLibre, description: 'Valor efectivo de cada clave (empresa → global → fábrica)' },
        global: { ...jsonLibre, description: 'Valores guardados como globales' },
        empresa: { ...jsonLibre, description: 'Valores guardados para la empresa' },
        fabrica: { ...jsonLibre, description: 'Valores de fábrica' },
        definiciones: lista(definicionAjuste),
    }),
)

/** Decisión del PM 19. */
export const CodigoIdentificacion = definirEsquema(
    'CodigoIdentificacion',
    objeto({
        servicio_id: id,
        codigo: { ...texto, pattern: '^\\d{6}$', description: 'Solo en esta respuesta; un solo uso' },
        expira_en: instante,
        vigencia_min: entero,
    }),
)

/** Decisión del PM 22. */
export const OpcionesLogin = definirEsquema(
    'OpcionesLogin',
    objeto({
        recuperar_contrasena: { ...booleano, description: 'Mostrar «¿Olvidaste tu contraseña?»' },
        iris: { ...booleano, description: 'Iris conectado: mostrar «Entrar con Iris»' },
        horus: { ...booleano, description: 'Horus conectado: mostrar «Entrar con Horus»' },
    }),
)

export const RecuperacionAceptada = definirEsquema(
    'RecuperacionAceptada',
    objeto({ aceptada: { ...booleano, description: 'Siempre true, exista o no el correo' } }),
)

export const ContrasenaRestablecida = definirEsquema(
    'ContrasenaRestablecida',
    objeto({ usuario_id: id, sesiones_cerradas: entero }),
)

/** Decisión del PM 28. */
export const HistorialIp = definirEsquema(
    'HistorialIp',
    objeto({
        ip: texto,
        en: instante,
        retencion_dias: entero,
        resultados: lista(
            objeto({
                fuente: enumerado(['sesion', 'asignacion']),
                servicio_id: id,
                cliente_id: id,
                cliente_nombre: texto,
                cliente_codigo: nulable(texto),
                empresa_id: id,
                user_ppp: nulable(texto),
                prefijo: texto,
                desde: instante,
                hasta: nulable(instante),
                sesion: nulable(
                    objeto({
                        id,
                        nas_ip: nulable(texto),
                        acct_session_id: texto,
                        inicio: instante,
                        fin: nulable(instante),
                        causa_fin: nulable(texto),
                    }),
                ),
            }),
        ),
    }),
)

/** Decisión del PM 31 (contrato Iris 0.13.0). */
export const IncidenteRed = definirEsquema(
    'IncidenteRed',
    objeto({
        id,
        alcance: enumerado(['router', 'olt', 'pon', 'zona']),
        alcance_id: id,
        estado: enumerado(['abierto', 'cerrado']),
        origen: enumerado(['automatico', 'manual']),
        motivo: nulable(texto),
        abierto_por: nulable(id),
        cerrado_por: nulable(id),
        motivo_cierre: nulable(texto),
        desde: instante,
        hasta: nulable(instante),
        base: { ...entero, description: 'Servicios activos o limitados del alcance al abrir' },
        servicios_afectados: { ...entero, description: 'Afectados de las empresas visibles' },
        empresas: lista(id),
    }),
)

export const PaginaIdsServicio = definirEsquema(
    'PaginaIdsServicio',
    objeto({ data: lista(id), nextCursor: nulable(texto) }),
)

export const CaidaRepetida = definirEsquema(
    'CaidaRepetida',
    objeto({
        id,
        servicio_id: id,
        empresa_id: id,
        cliente_id: id,
        sesion_id: id,
        desde: instante,
        hasta: instante,
        sesiones: entero,
        umbral: entero,
        ventana_minutos: entero,
        causas: jsonLibre,
        created_at: instante,
    }),
)
