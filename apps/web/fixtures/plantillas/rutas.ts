import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'

type Plantilla = Schema<'PlantillaFacturacion'>
type ReglasPromesa = Schema<'ReglasPromesa'>
type Canal = keyof ReglasPromesa['canales']

const CERTIFICAR_AL = ['emitir', 'pagar', 'nunca'] as const
const CICLOS = ['dia_fijo', 'aniversario'] as const
const MORAS = ['ninguna', 'fija', 'porcentaje'] as const
const CANALES: readonly Canal[] = ['portal', 'ia', 'operador', 'supervisor']
const VIGENCIAS_RECONEXION: readonly NonNullable<ReglasPromesa['reconexion_temporal']>['vigencia'][] = ['horas', 'medianoche']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** `REGLAS_PROMESA_POR_DEFECTO` de la API (`apps/api/app/billing/reglas_promesa.ts`). */
function reglasPorDefecto(): ReglasPromesa {
    const sinLimites = { permitido: true, requiere_aprobacion: false, plazo_max_dias: null, max_por_periodo: null, deuda_maxima: null }
    return {
        habilitadas: true,
        max_por_periodo: 1,
        max_por_periodo_buen_historial: 2,
        buen_historial_pct: 100,
        historial_ventana: 6,
        plazo_max_dias: 5,
        no_exceder_siguiente_facturacion: true,
        deuda_maxima: null,
        abono_inicial_pct: 0,
        antiguedad_minima_dias: 0,
        cumplimiento_minimo_pct: null,
        bloqueo_tras_incumplida_dias: 30,
        mismas_reglas_ia_operador: false,
        canales: {
            portal: { ...sinLimites, plazo_max_dias: 3 },
            ia: { ...sinLimites, plazo_max_dias: 3 },
            operador: { ...sinLimites },
            supervisor: { ...sinLimites, plazo_max_dias: 15, max_por_periodo: 3 },
        },
        reconexion_temporal: { permitida: false, max_por_periodo: 1, horas_max: 24, vigencia: 'horas' },
    }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Como `normalizarReglasPromesa`: lo que falte toma el valor por defecto. */
function normalizarReglas(entrada: unknown): ReglasPromesa {
    const reglas = reglasPorDefecto()
    if (!esObjeto(entrada)) {
        return reglas
    }
    const { canales, reconexion_temporal: reconexion, ...generales } = entrada
    const resultado = { ...reglas, ...generales } as ReglasPromesa
    resultado.canales = reglas.canales
    resultado.reconexion_temporal = { ...reglas.reconexion_temporal, ...(esObjeto(reconexion) ? reconexion : {}) } as NonNullable<ReglasPromesa['reconexion_temporal']>
    for (const canal of CANALES) {
        const parcial = esObjeto(canales) && esObjeto(canales[canal]) ? canales[canal] : {}
        resultado.canales[canal] = { ...reglas.canales[canal], ...parcial } as ReglasPromesa['canales'][Canal]
    }
    return resultado
}

type Errores = NonNullable<Problem['errors']>

function enRango(valor: unknown, min: number, max: number): boolean {
    return typeof valor === 'number' && Number.isInteger(valor) && valor >= min && valor <= max
}

/** Rangos de `reglasPromesaSchema` y la regla cruzada de `validarCoherencia`. */
function erroresReglas(reglas: ReglasPromesa): Errores {
    const errores: Errores = []
    const rangos: [keyof ReglasPromesa, number, number][] = [
        ['max_por_periodo', 0, 12], ['max_por_periodo_buen_historial', 0, 12], ['buen_historial_pct', 0, 100], ['historial_ventana', 1, 50],
        ['plazo_max_dias', 1, 60], ['abono_inicial_pct', 0, 100], ['antiguedad_minima_dias', 0, 3650], ['bloqueo_tras_incumplida_dias', 0, 365],
    ]
    for (const [campo, min, max] of rangos) {
        if (!enRango(reglas[campo], min, max)) {
            errores.push({ field: `reglas_promesa.${campo}`, message: `El campo debe estar entre ${min} y ${max}`, rule: 'range' })
        }
    }
    if (typeof reglas.mismas_reglas_ia_operador !== 'boolean') {
        errores.push({ field: 'reglas_promesa.mismas_reglas_ia_operador', message: 'El campo debe ser verdadero o falso', rule: 'boolean' })
    }
    if (reglas.deuda_maxima !== null && !MONTO.test(String(reglas.deuda_maxima))) {
        errores.push({ field: 'reglas_promesa.deuda_maxima', message: 'Monto inválido', rule: 'regex' })
    }
    for (const canal of CANALES) {
        const limites = reglas.canales[canal]
        if (limites.plazo_max_dias !== null && !enRango(limites.plazo_max_dias, 1, 60)) {
            errores.push({ field: `reglas_promesa.canales.${canal}.plazo_max_dias`, message: 'El campo debe estar entre 1 y 60', rule: 'range' })
        }
        if (limites.max_por_periodo !== null && !enRango(limites.max_por_periodo, 0, 12)) {
            errores.push({ field: `reglas_promesa.canales.${canal}.max_por_periodo`, message: 'El campo debe estar entre 0 y 12', rule: 'range' })
        }
    }
    const reconexion = reglas.reconexion_temporal
    if (reconexion) {
        if (typeof reconexion.permitida !== 'boolean') {
            errores.push({ field: 'reglas_promesa.reconexion_temporal.permitida', message: 'El campo debe ser verdadero o falso', rule: 'boolean' })
        }
        if (!enRango(reconexion.max_por_periodo, 0, 12)) {
            errores.push({ field: 'reglas_promesa.reconexion_temporal.max_por_periodo', message: 'El campo debe estar entre 0 y 12', rule: 'range' })
        }
        if (!enRango(reconexion.horas_max, 1, 168)) {
            errores.push({ field: 'reglas_promesa.reconexion_temporal.horas_max', message: 'El campo debe estar entre 1 y 168', rule: 'range' })
        }
        if (!(VIGENCIAS_RECONEXION as readonly unknown[]).includes(reconexion.vigencia)) {
            errores.push({ field: 'reglas_promesa.reconexion_temporal.vigencia', message: 'El campo debe ser horas o medianoche', rule: 'enum' })
        }
    }
    if (reglas.max_por_periodo_buen_historial < reglas.max_por_periodo) {
        errores.push({ field: 'reglas_promesa.max_por_periodo_buen_historial', message: 'El máximo con buen historial no puede ser menor que el máximo base', rule: 'coherencia' })
    }
    return errores
}

/** `validarCoherencia` (A3) sobre la plantilla ya armada; ajusta `dia` y `mora_valor` como la API. */
function validar(plantilla: Plantilla): Errores {
    const errores: Errores = []
    if (plantilla.nombre.trim().length < 2 || plantilla.nombre.length > 100) {
        errores.push({ field: 'nombre', message: 'El nombre debe tener entre 2 y 100 caracteres', rule: 'minLength' })
    }
    if (!(CICLOS as readonly string[]).includes(plantilla.ciclo)) {
        errores.push({ field: 'ciclo', message: 'El valor de ciclo no es válido', rule: 'enum' })
    }
    if (!(MORAS as readonly string[]).includes(plantilla.mora_tipo)) {
        errores.push({ field: 'mora_tipo', message: 'El valor de mora_tipo no es válido', rule: 'enum' })
    }
    if (!(CERTIFICAR_AL as readonly string[]).includes(plantilla.certificar_al)) {
        errores.push({ field: 'certificar_al', message: 'El valor de certificar_al no es válido', rule: 'enum' })
    }
    if (!HORA.test(plantilla.hora_corte)) {
        errores.push({ field: 'hora_corte', message: 'El formato de hora_corte no es válido', rule: 'regex' })
    }
    if (plantilla.ciclo === 'dia_fijo' && plantilla.dia === null) {
        errores.push({ field: 'dia', message: 'El ciclo dia_fijo exige el día de facturación', rule: 'coherencia' })
    }
    if (plantilla.ciclo === 'aniversario') {
        plantilla.dia = null
    }
    if (plantilla.facturas_para_limitar > plantilla.facturas_para_cortar) {
        errores.push({ field: 'facturas_para_limitar', message: 'facturas_para_limitar no puede ser mayor que facturas_para_cortar (0 = no limitar)', rule: 'coherencia' })
    }
    const mora = Number(plantilla.mora_valor)
    if (plantilla.mora_tipo === 'ninguna') {
        plantilla.mora_valor = '0.00'
    }
    else if (!MONTO.test(plantilla.mora_valor) || mora <= 0) {
        errores.push({ field: 'mora_valor', message: `La mora ${plantilla.mora_tipo} exige un valor mayor que 0`, rule: 'coherencia' })
    }
    else if (plantilla.mora_tipo === 'porcentaje' && mora > 100) {
        errores.push({ field: 'mora_valor', message: 'El porcentaje de mora no puede pasar de 100', rule: 'coherencia' })
    }
    else {
        plantilla.mora_valor = mora.toFixed(2)
    }
    return [...errores, ...erroresReglas(plantilla.reglas_promesa)]
}

const CAMPOS = ['nombre', 'ciclo', 'dia', 'prorrateo', 'dias_gracia', 'facturas_para_limitar', 'facturas_para_cortar', 'mora_tipo', 'mora_valor', 'mora_recurrente', 'hora_corte', 'certificar_al'] as const

/** Solo los campos editables que vinieron en el cuerpo. */
function camposDe(cuerpo: Record<string, unknown>): Partial<Plantilla> {
    const campos: Record<string, unknown> = {}
    for (const campo of CAMPOS) {
        if (cuerpo[campo] !== undefined) {
            campos[campo] = cuerpo[campo]
        }
    }
    return campos as Partial<Plantilla>
}

/** A lo sumo una por defecto: marcar una desmarca la anterior (y sube su `version`). */
function desmarcarOtras(id: number): void {
    for (const otra of bd.plantillas) {
        if (otra.id !== id && otra.por_defecto) {
            otra.por_defecto = false
            otra.version += 1
            otra.updated_at = ahora()
        }
    }
}

function crear(solicitud: SolicitudFixture) {
    const cuerpo = cuerpoObjeto(solicitud)
    if (typeof cuerpo.nombre !== 'string' || typeof cuerpo.ciclo !== 'string') {
        return datosInvalidos([{ field: typeof cuerpo.nombre !== 'string' ? 'nombre' : 'ciclo', message: 'El campo es obligatorio', rule: 'required' }])
    }
    const creada = ahora()
    const plantilla: Plantilla = {
        id: siguienteId(bd.plantillas),
        nombre: cuerpo.nombre.trim(),
        ciclo: 'dia_fijo',
        dia: null,
        // `VALORES_POR_DEFECTO` de `CrearPlantilla`.
        prorrateo: false,
        dias_gracia: 0,
        facturas_para_limitar: 1,
        facturas_para_cortar: 1,
        mora_tipo: 'ninguna',
        mora_valor: '0.00',
        mora_recurrente: false,
        hora_corte: '08:00',
        certificar_al: 'pagar',
        ...camposDe(cuerpo),
        reglas_promesa: normalizarReglas(cuerpo.reglas_promesa),
        por_defecto: cuerpo.por_defecto === true,
        version: 1,
        created_at: creada,
        updated_at: creada,
        // Vigente: la API devuelve los campos del retiro en null (`plantillas.retirar`).
        retirada_en: null,
        retirada_por: null,
        motivo_retiro: null,
    }
    const errores = validar(plantilla)
    if (errores.length) {
        return datosInvalidos(errores)
    }
    if (plantilla.por_defecto) {
        desmarcarOtras(plantilla.id)
    }
    bd.plantillas.push(plantilla)
    bd.plantillas.sort((a, b) => a.nombre.localeCompare(b.nombre))
    registrarAccion(solicitud, 'plantillas.crear', { tipo: 'plantilla_facturacion', id: plantilla.id }, cuerpo)
    return { status: 201, cuerpo: plantilla }
}

type ServicioSinPlantilla = Schema<'ServicioSinPlantilla'>
type EstadoAsignable = ServicioSinPlantilla['estado']

const ESTADOS_ASIGNABLES: readonly EstadoAsignable[] = ['activo', 'limitado', 'suspendido']
const TAMANO_MUESTRA = 20

/** Hoy en Guatemala (`AAAA-MM-DD`), como `hoyGuatemala` de la API. */
function hoyGuatemala(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** `AAAA-MM-DD` del día `dia` del mes (recortado al último día del mes, como un 31 en febrero). */
function fechaDelMes(anio: number, mes: number, dia: number): string {
    const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
    return new Date(Date.UTC(anio, mes, Math.min(dia, ultimo))).toISOString().slice(0, 10)
}

/**
 * Primer inicio de ciclo mayor o igual a `hoy` (pedido del líder a A3: si la asignación cae el día de
 * inicio, ese periodo es el primero; nunca uno anterior). Un servicio que empieza después de hoy
 * factura desde su inicio.
 */
function primerPeriodo(dia: number, inicioServicio: string, hoy: string): string {
    if (inicioServicio > hoy) {
        return inicioServicio
    }
    const [anio, mes] = hoy.split('-').map(Number) as [number, number]
    const esteMes = fechaDelMes(anio, mes - 1, dia)
    return esteMes >= hoy ? esteMes : fechaDelMes(anio, mes, dia)
}

/** Día del ciclo de un servicio con la plantilla: el fijo o el de su instalación (aniversario). */
function diaDelCiclo(plantilla: Plantilla, inicioServicio: string): number {
    return plantilla.ciclo === 'dia_fijo' && plantilla.dia !== null ? plantilla.dia : Number(inicioServicio.slice(8, 10))
}

/** Como `consultaSinPlantilla`: vigentes (activo, limitado, suspendido) sin plantilla de la empresa, por id. */
function sinPlantilla(solicitud: SolicitudFixture) {
    return deLaEmpresa(bd.servicios, solicitud)
        .filter(s => s.plantilla_facturacion_id === null && (ESTADOS_ASIGNABLES as readonly string[]).includes(s.estado))
        .sort((a, b) => a.id - b.id)
}

function conteo(servicios: ReturnType<typeof sinPlantilla>): Record<EstadoAsignable, number> {
    const porEstado: Record<EstadoAsignable, number> = { activo: 0, limitado: 0, suspendido: 0 }
    for (const servicio of servicios) {
        porEstado[servicio.estado as EstadoAsignable] += 1
    }
    return porEstado
}

/** La plantilla vigente de la ruta, o la respuesta de error (404, 409 `plantilla_retirada`). */
function plantillaAsignable(solicitud: SolicitudFixture): Plantilla | RespuestaFixture {
    const plantilla = bd.plantillas.find(p => p.id === idDe(solicitud))
    if (!plantilla) {
        return noEncontrado('la plantilla')
    }
    if (plantilla.retirada_en !== null) {
        return problemaTipado(409, 'plantilla_retirada', 'Plantilla retirada', `La plantilla ${plantilla.nombre} está retirada: no se asigna a servicios`)
    }
    return plantilla
}

function esPlantilla(valor: Plantilla | RespuestaFixture): valor is Plantilla {
    return 'nombre' in valor
}

/** `GET /plantillas-facturacion/:id/servicios-sin-plantilla` (`vistaPreviaSinPlantilla` de A3). */
function vistaPrevia(solicitud: SolicitudFixture) {
    const plantilla = plantillaAsignable(solicitud)
    if (!esPlantilla(plantilla)) {
        return plantilla
    }
    const hoy = hoyGuatemala()
    const servicios = sinPlantilla(solicitud)
    const porEstado = conteo(servicios)
    const muestra: ServicioSinPlantilla[] = servicios.slice(0, TAMANO_MUESTRA).map(s => ({
        servicio_id: s.id,
        cliente_id: s.cliente_id,
        cliente_nombre: s.cliente_nombre ?? '',
        empresa_id: s.empresa_id ?? 1,
        estado: s.estado as EstadoAsignable,
        user_ppp: s.user_ppp,
        plan_nombre: s.plan_nombre ?? '',
        facturar_desde: primerPeriodo(diaDelCiclo(plantilla, s.fecha_instalacion ?? hoy), s.fecha_instalacion ?? hoy, hoy),
    }))
    const cuerpo: Schema<'VistaPreviaSinPlantilla'> = {
        plantilla: { id: plantilla.id, nombre: plantilla.nombre, ciclo: plantilla.ciclo, dia: plantilla.dia },
        total: servicios.length,
        por_estado: porEstado,
        facturar_desde: plantilla.ciclo === 'dia_fijo' && plantilla.dia !== null ? primerPeriodo(plantilla.dia, '0000-01-01', hoy) : null,
        muestra,
    }
    return { status: 200, cuerpo }
}

/**
 * `POST /plantillas-facturacion/:id/asignar-servicios-sin-plantilla` (`AsignarPlantillaSinPlantilla`):
 * el mismo conjunto de la vista previa; 409 `total_cambiado` si `total_esperado` no coincide.
 */
function asignar(solicitud: SolicitudFixture) {
    const plantilla = plantillaAsignable(solicitud)
    if (!esPlantilla(plantilla)) {
        return plantilla
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const esperado = cuerpo.total_esperado
    if (typeof esperado !== 'number' || !Number.isInteger(esperado) || esperado < 0) {
        return datosInvalidos([{ field: 'total_esperado', message: 'El campo total_esperado debe ser un entero de 0 o más', rule: 'number' }])
    }
    const servicios = sinPlantilla(solicitud)
    if (servicios.length !== esperado) {
        return problemaTipado(409, 'total_cambiado', 'El total cambió', `La vista previa tenía ${esperado} servicios sin plantilla y ahora hay ${servicios.length}: vuelve a pedirla`)
    }
    const hoy = hoyGuatemala()
    const fechas = new Set<string>()
    for (const servicio of servicios) {
        const inicio = servicio.fecha_instalacion ?? hoy
        fechas.add(primerPeriodo(diaDelCiclo(plantilla, inicio), inicio, hoy))
        servicio.plantilla_facturacion_id = plantilla.id
        servicio.version += 1
        servicio.updated_at = ahora()
    }
    registrarAccion(solicitud, 'plantillas.asignar_sin_plantilla', { tipo: 'plantilla_facturacion', id: plantilla.id }, cuerpo)
    const respuesta: Schema<'AsignacionSinPlantilla'> = {
        plantilla_id: plantilla.id,
        asignados: servicios.length,
        por_estado: conteo(servicios),
        facturar_desde: [...fechas].sort(),
    }
    return { status: 200, cuerpo: respuesta }
}

export const rutasPlantillas: RutasFixture = {
    'GET /api/v1/plantillas-facturacion': conPermiso('plantillas.ver', () => ({ status: 200, cuerpo: bd.plantillas })),

    'GET /api/v1/plantillas-facturacion/:id': conPermiso('plantillas.ver', (solicitud) => {
        const plantilla = bd.plantillas.find(p => p.id === idDe(solicitud))
        return plantilla ? { status: 200, cuerpo: plantilla } : noEncontrado('la plantilla')
    }),

    'POST /api/v1/plantillas-facturacion': conPermiso('plantillas.crear', crear),

    /**
     * Como `EditarPlantilla`: solo los campos enviados, con `version` (409); `reglas_promesa`
     * reemplaza el objeto completo y `por_defecto` marca o desmarca.
     */
    'PUT /api/v1/plantillas-facturacion/:id': conPermiso('plantillas.editar', (solicitud) => {
        const plantilla = bd.plantillas.find(p => p.id === idDe(solicitud))
        if (!plantilla) {
            return noEncontrado('la plantilla')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.version !== 'number') {
            return datosInvalidos([{ field: 'version', message: 'El campo version es obligatorio', rule: 'required' }])
        }
        if (cuerpo.version !== plantilla.version) {
            return versionCambiada()
        }
        const propuesta: Plantilla = {
            ...structuredClone(plantilla),
            ...camposDe(cuerpo),
            reglas_promesa: cuerpo.reglas_promesa === undefined ? structuredClone(plantilla.reglas_promesa) : normalizarReglas(cuerpo.reglas_promesa),
        }
        const errores = validar(propuesta)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.por_defecto === true) {
            desmarcarOtras(plantilla.id)
        }
        Object.assign(plantilla, propuesta, {
            por_defecto: typeof cuerpo.por_defecto === 'boolean' ? cuerpo.por_defecto : plantilla.por_defecto,
            version: plantilla.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'plantillas.editar', { tipo: 'plantilla_facturacion', id: plantilla.id }, cuerpo)
        return { status: 200, cuerpo: plantilla }
    }),

    'GET /api/v1/plantillas-facturacion/:id/servicios-sin-plantilla': conPermiso('plantillas.asignar_sin_plantilla', vistaPrevia),

    'POST /api/v1/plantillas-facturacion/:id/asignar-servicios-sin-plantilla': conPermiso('plantillas.asignar_sin_plantilla', conIdempotencia(asignar)),
}
