import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Plantilla = Schema<'PlantillaFacturacion'>
type ReglasPromesa = Schema<'ReglasPromesa'>
export type DatosPlantilla = paths['/api/v1/plantillas-facturacion']['post']['requestBody']['content']['application/json']
export type CambiosPlantilla = paths['/api/v1/plantillas-facturacion/{id}']['put']['requestBody']['content']['application/json']
export type CanalReglasPromesa = keyof ReglasPromesa['canales']

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const MENSAJE_MONTO = 'Escribe un monto con hasta 2 decimales, sin comas (ej. 500.00)'

/** Canales en el orden en que se muestran (los de la API, `reglas_promesa.ts`). */
export const CANALES_REGLAS: readonly CanalReglasPromesa[] = ['operador', 'supervisor', 'portal', 'ia']

function entero(min: number, max: number, etiqueta: string) {
    const mensaje = `${etiqueta}: entre ${min} y ${max}`
    return z.number({ message: `Escribe ${etiqueta.toLowerCase()}` }).int('Solo números enteros').min(min, mensaje).max(max, mensaje)
}

function enteroNulable(min: number, max: number, etiqueta: string) {
    const mensaje = `${etiqueta}: entre ${min} y ${max}`
    return z.number().int('Solo números enteros').min(min, mensaje).max(max, mensaje).nullable()
}

/** Monto opcional: vacío = sin límite (`null` en la API). */
const montoOpcional = z.string().trim().refine(valor => valor === '' || MONTO.test(valor), MENSAJE_MONTO)

const esquemaCanal = z.object({
    permitido: z.boolean(),
    requiere_aprobacion: z.boolean(),
    plazo_max_dias: enteroNulable(1, 60, 'Plazo del canal'),
    max_por_periodo: enteroNulable(0, 12, 'Máximo del canal'),
    deuda_maxima: montoOpcional,
})

/**
 * Espejo de `crearPlantillaValidator` / `editarPlantillaValidator` y de `reglasPromesaSchema` (A3):
 * los mismos rangos por campo, y las reglas entre campos de `validarCoherencia`
 * (`apps/api/app/billing/plantillas.ts`): `dia_fijo` exige el día, limitar ≤ cortar, la mora con
 * valor mayor que 0 (porcentaje ≤ 100) y el máximo con buen historial ≥ el máximo base. Los nombres
 * de campo son los de la API, así un 422 cae junto a su campo (`reglas_promesa.canales.portal…`).
 */
export const esquemaPlantilla = z.object({
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    por_defecto: z.boolean(),
    ciclo: z.enum(['dia_fijo', 'aniversario']),
    dia: enteroNulable(1, 28, 'Día de facturación'),
    prorrateo: z.boolean(),
    dias_gracia: entero(0, 90, 'Días de gracia'),
    facturas_para_limitar: entero(0, 24, 'Facturas para limitar'),
    facturas_para_cortar: entero(1, 24, 'Facturas para cortar'),
    hora_corte: z.string().trim().regex(HORA, 'Hora en formato HH:MM (24 h)'),
    mora_tipo: z.enum(['ninguna', 'fija', 'porcentaje']),
    mora_valor: z.string().trim(),
    mora_recurrente: z.boolean(),
    certificar_al: z.enum(['emitir', 'pagar', 'nunca']),
    reglas_promesa: z.object({
        habilitadas: z.boolean(),
        max_por_periodo: entero(0, 12, 'Máximo por periodo'),
        max_por_periodo_buen_historial: entero(0, 12, 'Máximo con buen historial'),
        buen_historial_pct: entero(0, 100, 'Buen historial'),
        historial_ventana: entero(1, 50, 'Ventana del historial'),
        plazo_max_dias: entero(1, 60, 'Plazo máximo'),
        no_exceder_siguiente_facturacion: z.boolean(),
        deuda_maxima: montoOpcional,
        abono_inicial_pct: entero(0, 100, 'Abono inicial'),
        antiguedad_minima_dias: entero(0, 3650, 'Antigüedad mínima'),
        cumplimiento_minimo_pct: enteroNulable(0, 100, 'Cumplimiento mínimo'),
        bloqueo_tras_incumplida_dias: entero(0, 365, 'Bloqueo tras incumplir'),
        canales: z.object({
            portal: esquemaCanal,
            ia: esquemaCanal,
            operador: esquemaCanal,
            supervisor: esquemaCanal,
        }),
    }),
}).superRefine((datos, ctx) => {
    if (datos.ciclo === 'dia_fijo' && datos.dia === null) {
        ctx.addIssue({ code: 'custom', path: ['dia'], message: 'El ciclo de día fijo exige el día de facturación' })
    }
    if (datos.facturas_para_limitar > datos.facturas_para_cortar) {
        ctx.addIssue({ code: 'custom', path: ['facturas_para_limitar'], message: 'No puede ser mayor que las facturas para cortar (0 = no limitar)' })
    }
    if (datos.mora_tipo !== 'ninguna') {
        if (!MONTO.test(datos.mora_valor)) {
            ctx.addIssue({ code: 'custom', path: ['mora_valor'], message: MENSAJE_MONTO })
        }
        else if (new Decimal(datos.mora_valor).lte(0)) {
            ctx.addIssue({ code: 'custom', path: ['mora_valor'], message: 'La mora exige un valor mayor que 0' })
        }
        else if (datos.mora_tipo === 'porcentaje' && new Decimal(datos.mora_valor).gt(100)) {
            ctx.addIssue({ code: 'custom', path: ['mora_valor'], message: 'El porcentaje de mora no puede pasar de 100' })
        }
    }
    const reglas = datos.reglas_promesa
    if (reglas.max_por_periodo_buen_historial < reglas.max_por_periodo) {
        ctx.addIssue({ code: 'custom', path: ['reglas_promesa', 'max_por_periodo_buen_historial'], message: 'No puede ser menor que el máximo base' })
    }
})

export type EntradaPlantilla = z.input<typeof esquemaPlantilla>
export type SalidaPlantilla = z.output<typeof esquemaPlantilla>
type EntradaCanal = EntradaPlantilla['reglas_promesa']['canales'][CanalReglasPromesa]

/**
 * Valores por defecto de una plantilla nueva: los de `CrearPlantilla` (`VALORES_POR_DEFECTO`) y
 * `REGLAS_PROMESA_POR_DEFECTO` de la API, para que el formulario muestre lo que se guardaría.
 */
export function entradaPlantillaVacia(): EntradaPlantilla {
    const sinLimites = (): EntradaCanal => ({ permitido: true, requiere_aprobacion: false, plazo_max_dias: null, max_por_periodo: null, deuda_maxima: '' })
    return {
        nombre: '',
        por_defecto: false,
        ciclo: 'dia_fijo',
        dia: 1,
        prorrateo: true,
        dias_gracia: 0,
        facturas_para_limitar: 1,
        facturas_para_cortar: 1,
        hora_corte: '08:00',
        mora_tipo: 'ninguna',
        mora_valor: '0.00',
        mora_recurrente: false,
        certificar_al: 'pagar',
        reglas_promesa: {
            habilitadas: true,
            max_por_periodo: 1,
            max_por_periodo_buen_historial: 2,
            buen_historial_pct: 100,
            historial_ventana: 6,
            plazo_max_dias: 5,
            no_exceder_siguiente_facturacion: true,
            deuda_maxima: '',
            abono_inicial_pct: 0,
            antiguedad_minima_dias: 0,
            cumplimiento_minimo_pct: null,
            bloqueo_tras_incumplida_dias: 30,
            canales: {
                portal: { ...sinLimites(), plazo_max_dias: 3 },
                ia: { ...sinLimites(), plazo_max_dias: 3 },
                operador: sinLimites(),
                supervisor: { ...sinLimites(), plazo_max_dias: 15, max_por_periodo: 3 },
            },
        },
    }
}

/** `HH:MM` aunque la base mande `HH:MM:SS`. */
function horaCorta(hora: string): string {
    return hora.slice(0, 5)
}

export function entradaDesdePlantilla(plantilla: Plantilla): EntradaPlantilla {
    const reglas = plantilla.reglas_promesa
    const canal = (c: CanalReglasPromesa): EntradaCanal => ({ ...reglas.canales[c], deuda_maxima: reglas.canales[c].deuda_maxima ?? '' })
    return {
        nombre: plantilla.nombre,
        por_defecto: plantilla.por_defecto ?? false,
        ciclo: plantilla.ciclo,
        dia: plantilla.dia,
        prorrateo: plantilla.prorrateo,
        dias_gracia: plantilla.dias_gracia,
        facturas_para_limitar: plantilla.facturas_para_limitar,
        facturas_para_cortar: plantilla.facturas_para_cortar,
        hora_corte: horaCorta(plantilla.hora_corte),
        mora_tipo: plantilla.mora_tipo,
        mora_valor: plantilla.mora_valor,
        mora_recurrente: plantilla.mora_recurrente,
        certificar_al: plantilla.certificar_al,
        reglas_promesa: {
            ...reglas,
            deuda_maxima: reglas.deuda_maxima ?? '',
            canales: { portal: canal('portal'), ia: canal('ia'), operador: canal('operador'), supervisor: canal('supervisor') },
        },
    }
}

const montoONulo = (valor: string): string | null => (valor === '' ? null : new Decimal(valor).toFixed(2))

/** Cuerpo de `POST /plantillas-facturacion`: todo explícito (la API no rellena nada a escondidas). */
export function cuerpoPlantilla(datos: SalidaPlantilla): DatosPlantilla {
    const reglas = datos.reglas_promesa
    const canal = (c: CanalReglasPromesa) => ({ ...reglas.canales[c], deuda_maxima: montoONulo(reglas.canales[c].deuda_maxima) })
    return {
        nombre: datos.nombre,
        ciclo: datos.ciclo,
        dia: datos.ciclo === 'aniversario' ? null : datos.dia,
        prorrateo: datos.prorrateo,
        dias_gracia: datos.dias_gracia,
        facturas_para_limitar: datos.facturas_para_limitar,
        facturas_para_cortar: datos.facturas_para_cortar,
        hora_corte: datos.hora_corte,
        mora_tipo: datos.mora_tipo,
        mora_valor: datos.mora_tipo === 'ninguna' ? '0.00' : new Decimal(datos.mora_valor).toFixed(2),
        mora_recurrente: datos.mora_tipo === 'ninguna' ? false : datos.mora_recurrente,
        certificar_al: datos.certificar_al,
        reglas_promesa: {
            ...reglas,
            deuda_maxima: montoONulo(reglas.deuda_maxima),
            canales: { portal: canal('portal'), ia: canal('ia'), operador: canal('operador'), supervisor: canal('supervisor') },
        },
        por_defecto: datos.por_defecto,
    }
}

/**
 * Cuerpo de `PUT /plantillas-facturacion/:id`: todos los campos con la `version` leída. `por_defecto`
 * solo viaja si cambió (quitarla a la que lo es deja los servicios nuevos sin plantilla por defecto).
 */
export function cambiosPlantilla(datos: SalidaPlantilla, plantilla: Pick<Plantilla, 'version' | 'por_defecto'>): CambiosPlantilla {
    const { por_defecto: porDefecto, ...resto } = cuerpoPlantilla(datos)
    return {
        ...resto,
        version: plantilla.version,
        ...(porDefecto === (plantilla.por_defecto ?? false) ? {} : { por_defecto: porDefecto }),
    }
}

/*
 * Textos de la lista y la ficha: lo guardado, en palabras.
 */

export function resumenCiclo(plantilla: Pick<Plantilla, 'ciclo' | 'dia' | 'prorrateo'>): string {
    const base = plantilla.ciclo === 'aniversario' ? 'Aniversario (día de instalación)' : `Día ${plantilla.dia ?? '—'} de cada mes`
    return plantilla.prorrateo ? `${base} · prorrateo` : base
}

export function resumenCorte(plantilla: Pick<Plantilla, 'dias_gracia' | 'facturas_para_limitar' | 'facturas_para_cortar' | 'hora_corte'>): string {
    const limitar = plantilla.facturas_para_limitar === 0
        ? 'nunca limita'
        : `limita con ${plantilla.facturas_para_limitar} ${plantilla.facturas_para_limitar === 1 ? 'factura vencida' : 'facturas vencidas'}`
    const cortar = `corta con ${plantilla.facturas_para_cortar}`
    const gracia = plantilla.dias_gracia === 0 ? 'sin gracia' : `${plantilla.dias_gracia} ${plantilla.dias_gracia === 1 ? 'día' : 'días'} de gracia`
    return `${gracia} · ${limitar} · ${cortar} · ${horaCorta(plantilla.hora_corte)} h`
}

export function resumenMora(plantilla: Pick<Plantilla, 'mora_tipo' | 'mora_valor' | 'mora_recurrente'>): string {
    if (plantilla.mora_tipo === 'ninguna') {
        return 'Sin mora'
    }
    const valor = plantilla.mora_tipo === 'fija' ? formatearQuetzales(plantilla.mora_valor) : `${plantilla.mora_valor} %`
    return plantilla.mora_recurrente ? `${valor} por periodo vencido` : `${valor} una vez`
}

export function resumenPromesas(reglas: ReglasPromesa): string {
    if (!reglas.habilitadas) {
        return 'Promesas deshabilitadas'
    }
    const maximo = reglas.max_por_periodo === reglas.max_por_periodo_buen_historial
        ? `${reglas.max_por_periodo}`
        : `${reglas.max_por_periodo} (${reglas.max_por_periodo_buen_historial} con buen historial)`
    return `Hasta ${maximo} por periodo · ${reglas.plazo_max_dias} ${reglas.plazo_max_dias === 1 ? 'día' : 'días'}`
}
