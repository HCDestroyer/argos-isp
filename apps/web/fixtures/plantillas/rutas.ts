import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, versionCambiada } from '../comun'

type Plantilla = Schema<'PlantillaFacturacion'>
type ReglasPromesa = Schema<'ReglasPromesa'>
type Canal = keyof ReglasPromesa['canales']

const CERTIFICAR_AL = ['emitir', 'pagar', 'nunca'] as const
const CICLOS = ['dia_fijo', 'aniversario'] as const
const MORAS = ['ninguna', 'fija', 'porcentaje'] as const
const CANALES: readonly Canal[] = ['portal', 'ia', 'operador', 'supervisor']
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
        canales: {
            portal: { ...sinLimites, plazo_max_dias: 3 },
            ia: { ...sinLimites, plazo_max_dias: 3 },
            operador: { ...sinLimites },
            supervisor: { ...sinLimites, plazo_max_dias: 15, max_por_periodo: 3 },
        },
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
    const { canales, ...generales } = entrada
    const resultado = { ...reglas, ...generales } as ReglasPromesa
    resultado.canales = reglas.canales
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
        prorrateo: true,
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
}
