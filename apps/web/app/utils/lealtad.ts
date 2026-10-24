import type { Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Programa de lealtad, fase 1 (A3, `contratos/lealtad.md` §4 y §15.1): etiquetas, espejos de los
 * validadores VineJS (`apps/api/app/lealtad/validators.ts`) y la vista previa del valor de una regla.
 */

type Programa = Schema<'ProgramaLealtad'>
type Regla = Schema<'ReglaLealtad'>
type Movimiento = Schema<'MovimientoPuntos'>
type Referido = Schema<'ReferidoLealtad'>
type TipoRegla = Regla['tipo']
type CuerpoPrograma = paths['/api/v1/lealtad/programas']['post']['requestBody']['content']['application/json']
type CuerpoEdicionPrograma = paths['/api/v1/lealtad/programas/{id}']['put']['requestBody']['content']['application/json']
type CuerpoRegla = paths['/api/v1/lealtad/reglas']['post']['requestBody']['content']['application/json']
type CuerpoEdicionRegla = paths['/api/v1/lealtad/reglas/{id}']['put']['requestBody']['content']['application/json']
type Color = NonNullable<BadgeProps['color']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const PORCENTAJE = /^\d{1,3}(\.\d{1,6})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export const TIPOS_REGLA_LEALTAD: Record<TipoRegla, { etiqueta: string, icono: string, descripcion: string }> = {
    pago_a_tiempo: { etiqueta: 'Pago a tiempo', icono: 'i-lucide-calendar-check', descripcion: 'Cada factura de servicio pagada antes de su vencimiento.' },
    antiguedad: { etiqueta: 'Antigüedad', icono: 'i-lucide-award', descripcion: 'Cada tantos meses de servicio sin cortes.' },
    referido: { etiqueta: 'Referido', icono: 'i-lucide-user-plus', descripcion: 'Cuando el cliente referido paga sus primeras facturas.' },
    pago_adelantado: { etiqueta: 'Pago adelantado', icono: 'i-lucide-fast-forward', descripcion: 'Cuando un pago deja meses pagados por adelantado.' },
}

export const TIPOS_MOVIMIENTO_PUNTOS: Record<Movimiento['tipo'], { etiqueta: string, color: Color, icono: string }> = {
    acumulacion: { etiqueta: 'Ganados', color: 'success', icono: 'i-lucide-plus' },
    canje: { etiqueta: 'Canje', color: 'info', icono: 'i-lucide-gift' },
    vencimiento: { etiqueta: 'Vencidos', color: 'neutral', icono: 'i-lucide-hourglass' },
    reverso: { etiqueta: 'Reverso', color: 'warning', icono: 'i-lucide-undo-2' },
    ajuste: { etiqueta: 'Ajuste', color: 'neutral', icono: 'i-lucide-pencil' },
}

export const ORIGENES_PUNTOS: Record<Movimiento['origen_tipo'], string> = {
    factura: 'Factura',
    pago: 'Pago',
    servicio: 'Servicio',
    referido: 'Referido',
    canje: 'Canje',
    sorteo: 'Sorteo',
    ajuste: 'Ajuste manual',
    nota_credito: 'Nota de crédito',
    lote: 'Lote',
}

export const ESTADOS_REFERIDO: Record<Referido['estado'], { etiqueta: string, color: Color, icono: string }> = {
    pendiente: { etiqueta: 'Pendiente', color: 'warning', icono: 'i-lucide-hourglass' },
    calificado: { etiqueta: 'Calificado', color: 'success', icono: 'i-lucide-circle-check' },
    rechazado: { etiqueta: 'Rechazado', color: 'neutral', icono: 'i-lucide-ban' },
}

export const ESTADOS_SERVICIO_ANTIGUEDAD = ['activo', 'limitado', 'suspendido'] as const

/** Puntos con miles: `1,250 pts`. */
export function formatearPuntos(puntos: number): string {
    const signo = puntos < 0 ? '−' : ''
    return `${signo}${Math.abs(puntos).toLocaleString('en-US')} pts`
}

/** `80.000000` → `80`; `12.500000` → `12.5` (el porcentaje de la API viene con 6 decimales). */
export function formatearPorcentaje(valor: string): string {
    try {
        return new Decimal(valor).toString()
    }
    catch {
        return valor
    }
}

/* Programa. */

function fechaOpcional(mensaje = 'Fecha inválida') {
    return z.string().trim().refine(valor => valor === '' || FECHA.test(valor), mensaje)
}

/**
 * Espejo de `crearProgramaValidator`: nombre de 1 a 120, `valor_punto` en Q con hasta 2 decimales,
 * `canje_esperado_pct` de 0 a 100 con hasta 6 decimales, vencimiento de 1 a 120 meses (o sin
 * vencimiento), aviso de 0 a 365 días, mínimo de canje ≥ 0 y términos hasta 20 000 caracteres.
 */
export const esquemaPrograma = z.object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120, 'Máximo 120 caracteres'),
    valor_punto: z.string().trim().regex(MONTO, 'Q por punto con hasta 2 decimales (ej. 0.10)'),
    diferimiento: z.boolean(),
    canje_esperado_pct: z.string()
        .trim()
        .regex(PORCENTAJE, 'Porcentaje de 0 a 100 con hasta 6 decimales')
        .refine(valor => !PORCENTAJE.test(valor) || new Decimal(valor).lte(100), 'Porcentaje de 0 a 100'),
    vence: z.boolean(),
    vencimiento_meses: z.number({ message: 'Meses de 1 a 120' }).int('Meses enteros').min(1, 'Meses de 1 a 120').max(120, 'Meses de 1 a 120'),
    aviso_vencimiento_dias: z.number({ message: 'Días de 0 a 365' }).int('Días enteros').min(0, 'Días de 0 a 365').max(365, 'Días de 0 a 365'),
    minimo_canje: z.number({ message: 'Puntos enteros' }).int('Puntos enteros').min(0, 'No puede ser negativo'),
    terminos: z.string().trim().max(20000, 'Máximo 20 000 caracteres'),
    vigente_desde: fechaOpcional(),
    vigente_hasta: fechaOpcional(),
    /** Fase 2 (A3): mostrar los puntos en el portal y dejar canjear desde ahí (solo al editar). */
    visible_portal: z.boolean(),
    canje_portal: z.boolean(),
}).superRefine((datos, ctx) => {
    if (datos.vigente_desde && datos.vigente_hasta && datos.vigente_hasta < datos.vigente_desde) {
        ctx.addIssue({ code: 'custom', path: ['vigente_hasta'], message: 'No puede ser anterior al inicio' })
    }
    // Como la API: 422 en `canje_portal` sin `visible_portal`.
    if (datos.canje_portal && !datos.visible_portal) {
        ctx.addIssue({ code: 'custom', path: ['canje_portal'], message: 'Para canjear en el portal, los puntos deben verse en él' })
    }
})

export type EntradaPrograma = z.input<typeof esquemaPrograma>
export type SalidaPrograma = z.output<typeof esquemaPrograma>

export function entradaProgramaVacia(): EntradaPrograma {
    return { nombre: 'Puntos Argos', valor_punto: '0.10', diferimiento: false, canje_esperado_pct: '100', vence: true, vencimiento_meses: 12, aviso_vencimiento_dias: 30, minimo_canje: 0, terminos: '', vigente_desde: '', vigente_hasta: '', visible_portal: false, canje_portal: false }
}

export function entradaDePrograma(programa: Programa): EntradaPrograma {
    return {
        nombre: programa.nombre,
        valor_punto: programa.valor_punto,
        diferimiento: programa.diferimiento,
        canje_esperado_pct: programa.canje_esperado_pct,
        vence: programa.vencimiento_meses !== null,
        vencimiento_meses: programa.vencimiento_meses ?? 12,
        aviso_vencimiento_dias: programa.aviso_vencimiento_dias,
        minimo_canje: programa.minimo_canje,
        terminos: programa.terminos,
        vigente_desde: programa.vigente_desde,
        vigente_hasta: programa.vigente_hasta ?? '',
        visible_portal: programa.visible_portal ?? false,
        canje_portal: programa.canje_portal ?? false,
    }
}

export function cuerpoPrograma(datos: SalidaPrograma): CuerpoPrograma {
    const cuerpo: CuerpoPrograma = {
        nombre: datos.nombre,
        valor_punto: new Decimal(datos.valor_punto).toFixed(2),
        diferimiento: datos.diferimiento,
        canje_esperado_pct: datos.canje_esperado_pct,
        vencimiento_meses: datos.vence ? datos.vencimiento_meses : null,
        aviso_vencimiento_dias: datos.aviso_vencimiento_dias,
        minimo_canje: datos.minimo_canje,
        terminos: datos.terminos,
        vigente_hasta: datos.vigente_hasta || null,
    }
    if (datos.vigente_desde) {
        cuerpo.vigente_desde = datos.vigente_desde
    }
    return cuerpo
}

/**
 * Cuerpo de `PUT /lealtad/programas/:id`: todo lo del formulario más la `version` leída, con
 * `visible_portal` y `canje_portal` (el alta no los acepta: el programa nace oculto en el portal).
 */
export function cuerpoEdicionPrograma(programa: Programa, datos: SalidaPrograma): CuerpoEdicionPrograma {
    return { version: programa.version, ...cuerpoPrograma(datos), visible_portal: datos.visible_portal, canje_portal: datos.visible_portal && datos.canje_portal }
}

/** `valor_punto × canje_esperado_pct / 100` con 6 decimales (lo que calcula la API como `valor_pasivo_punto`). */
export function valorPasivoPunto(valorPunto: string, canjeEsperadoPct: string): Decimal | null {
    if (!MONTO.test(valorPunto.trim()) || !PORCENTAJE.test(canjeEsperadoPct.trim())) {
        return null
    }
    return new Decimal(valorPunto.trim()).times(canjeEsperadoPct.trim()).div(100).toDecimalPlaces(6)
}

/** Términos sin plazo de vencimiento a la vista (inv. F.4): aviso, no bloqueo (lo decide el abogado). */
export function terminosSinPlazo(terminos: string, vence: boolean): boolean {
    return vence && terminos.trim() !== '' && !/(vence|vencen|vencimiento|caduca)/i.test(terminos)
}

/* Reglas. */

/**
 * Formulario de una regla: los campos comunes y las condiciones de todos los tipos (solo se
 * envían las del tipo elegido). Valores por defecto: `CONDICIONES_POR_DEFECTO` de la API.
 */
export const esquemaReglaLealtad = z.object({
    tipo: z.enum(['pago_a_tiempo', 'antiguedad', 'referido', 'pago_adelantado']),
    puntos: z.number({ message: 'Puntos enteros' }).int('Puntos enteros').min(0, 'No puede ser negativo').max(1_000_000, 'Máximo 1 000 000'),
    con_tope: z.boolean(),
    tope_por_cliente: z.number({ message: 'Entero ≥ 1' }).int('Entero ≥ 1').min(1, 'Entero ≥ 1'),
    periodo_tope: z.enum(['mes', 'anio']),
    activa: z.boolean(),
    vigente_desde: fechaOpcional(),
    vigente_hasta: fechaOpcional(),
    // pago_a_tiempo
    dias_antes_vencimiento: z.number({ message: 'Días de 0 a 365' }).int().min(0, 'Días de 0 a 365').max(365, 'Días de 0 a 365'),
    solo_servicio: z.boolean(),
    sin_promesa: z.boolean(),
    con_racha: z.boolean(),
    racha_periodos: z.number({ message: 'De 1 a 120' }).int().min(1, 'De 1 a 120').max(120, 'De 1 a 120'),
    racha_puntos_extra: z.number({ message: 'Entero ≥ 1' }).int().min(1, 'Entero ≥ 1'),
    monto_minimo: z.string().trim().refine(valor => valor === '' || MONTO.test(valor), 'Monto con hasta 2 decimales'),
    // antiguedad
    cada_meses: z.number({ message: 'De 1 a 240' }).int().min(1, 'De 1 a 240').max(240, 'De 1 a 240'),
    con_limite_vencidas: z.boolean(),
    sin_vencidas_mas_de_dias: z.number({ message: 'Días ≥ 0' }).int().min(0, 'Días ≥ 0'),
    estados_validos: z.array(z.enum(ESTADOS_SERVICIO_ANTIGUEDAD)),
    // referido
    facturas_pagadas_minimas: z.number({ message: 'De 1 a 60' }).int().min(1, 'De 1 a 60').max(60, 'De 1 a 60'),
    dias_maximos: z.number({ message: 'Entero ≥ 1' }).int().min(1, 'Entero ≥ 1').nullable(),
    tope_por_referidor: z.number({ message: 'Entero ≥ 1' }).int().min(1, 'Entero ≥ 1').nullable(),
    puntos_referido: z.number({ message: 'Puntos ≥ 0' }).int().min(0, 'Puntos ≥ 0'),
    // pago_adelantado
    periodos_minimos: z.number({ message: 'De 1 a 60' }).int().min(1, 'De 1 a 60').max(60, 'De 1 a 60'),
    puntos_por_periodo: z.number({ message: 'Puntos ≥ 0' }).int().min(0, 'Puntos ≥ 0'),
}).superRefine((datos, ctx) => {
    if (datos.tipo === 'antiguedad' && !datos.estados_validos.length) {
        ctx.addIssue({ code: 'custom', path: ['estados_validos'], message: 'Elige al menos un estado' })
    }
    if (datos.vigente_desde && datos.vigente_hasta && datos.vigente_hasta < datos.vigente_desde) {
        ctx.addIssue({ code: 'custom', path: ['vigente_hasta'], message: 'No puede ser anterior al inicio' })
    }
})

export type EntradaReglaLealtad = z.input<typeof esquemaReglaLealtad>
export type SalidaReglaLealtad = z.output<typeof esquemaReglaLealtad>

export function entradaReglaLealtadVacia(tipo: TipoRegla = 'pago_a_tiempo'): EntradaReglaLealtad {
    return {
        tipo,
        puntos: 10,
        con_tope: false,
        tope_por_cliente: 1,
        periodo_tope: 'mes',
        activa: true,
        vigente_desde: '',
        vigente_hasta: '',
        dias_antes_vencimiento: 0,
        solo_servicio: true,
        sin_promesa: true,
        con_racha: false,
        racha_periodos: 6,
        racha_puntos_extra: 50,
        monto_minimo: '',
        cada_meses: 12,
        con_limite_vencidas: false,
        sin_vencidas_mas_de_dias: 15,
        estados_validos: ['activo'],
        facturas_pagadas_minimas: 2,
        dias_maximos: null,
        tope_por_referidor: null,
        puntos_referido: 0,
        periodos_minimos: 1,
        puntos_por_periodo: 0,
    }
}

export function entradaDeReglaLealtad(regla: Regla): EntradaReglaLealtad {
    const base = entradaReglaLealtadVacia(regla.tipo)
    const c: Record<string, unknown> = { ...regla.condiciones }
    const numero = (clave: string, defecto: number) => (typeof c[clave] === 'number' ? c[clave] : defecto)
    const racha = typeof c.racha === 'object' && c.racha !== null ? c.racha as { periodos: number, puntos_extra: number } : null
    return {
        ...base,
        puntos: regla.puntos,
        con_tope: regla.tope_por_cliente !== null,
        tope_por_cliente: regla.tope_por_cliente ?? 1,
        periodo_tope: regla.periodo_tope ?? 'mes',
        activa: regla.activa,
        vigente_desde: regla.vigente_desde,
        vigente_hasta: regla.vigente_hasta ?? '',
        dias_antes_vencimiento: numero('dias_antes_vencimiento', base.dias_antes_vencimiento),
        solo_servicio: typeof c.solo_servicio === 'boolean' ? c.solo_servicio : base.solo_servicio,
        sin_promesa: typeof c.sin_promesa === 'boolean' ? c.sin_promesa : base.sin_promesa,
        con_racha: racha !== null,
        racha_periodos: racha?.periodos ?? base.racha_periodos,
        racha_puntos_extra: racha?.puntos_extra ?? base.racha_puntos_extra,
        monto_minimo: typeof c.monto_minimo === 'string' ? c.monto_minimo : '',
        cada_meses: numero('cada_meses', base.cada_meses),
        con_limite_vencidas: typeof c.sin_vencidas_mas_de_dias === 'number',
        sin_vencidas_mas_de_dias: numero('sin_vencidas_mas_de_dias', base.sin_vencidas_mas_de_dias),
        estados_validos: Array.isArray(c.estados_validos) ? c.estados_validos.filter((e): e is typeof ESTADOS_SERVICIO_ANTIGUEDAD[number] => (ESTADOS_SERVICIO_ANTIGUEDAD as readonly string[]).includes(String(e))) : base.estados_validos,
        facturas_pagadas_minimas: numero('facturas_pagadas_minimas', base.facturas_pagadas_minimas),
        dias_maximos: typeof c.dias_maximos === 'number' ? c.dias_maximos : null,
        tope_por_referidor: typeof c.tope_por_referidor === 'number' ? c.tope_por_referidor : null,
        puntos_referido: numero('puntos_referido', base.puntos_referido),
        periodos_minimos: numero('periodos_minimos', base.periodos_minimos),
        puntos_por_periodo: numero('puntos_por_periodo', base.puntos_por_periodo),
    }
}

/** Las condiciones del tipo elegido, con la forma de la unión del OpenAPI. */
function condicionesDe(datos: SalidaReglaLealtad) {
    switch (datos.tipo) {
        case 'pago_a_tiempo':
            return {
                dias_antes_vencimiento: datos.dias_antes_vencimiento,
                solo_servicio: datos.solo_servicio,
                sin_promesa: datos.sin_promesa,
                ...(datos.con_racha ? { racha: { periodos: datos.racha_periodos, puntos_extra: datos.racha_puntos_extra } } : {}),
                monto_minimo: datos.monto_minimo ? new Decimal(datos.monto_minimo).toFixed(2) : null,
            }
        case 'antiguedad':
            return {
                cada_meses: datos.cada_meses,
                sin_vencidas_mas_de_dias: datos.con_limite_vencidas ? datos.sin_vencidas_mas_de_dias : null,
                estados_validos: datos.estados_validos,
            }
        case 'referido':
            return {
                facturas_pagadas_minimas: datos.facturas_pagadas_minimas,
                dias_maximos: datos.dias_maximos,
                tope_por_referidor: datos.tope_por_referidor,
                puntos_referido: datos.puntos_referido,
            }
        case 'pago_adelantado':
            return { periodos_minimos: datos.periodos_minimos, puntos_por_periodo: datos.puntos_por_periodo }
    }
}

function comunes(datos: SalidaReglaLealtad) {
    return {
        recompensa: 'puntos' as const,
        puntos: datos.puntos,
        tope_por_cliente: datos.con_tope ? datos.tope_por_cliente : null,
        periodo_tope: datos.con_tope ? datos.periodo_tope : null,
        activa: datos.activa,
        vigente_hasta: datos.vigente_hasta || null,
        ...(datos.vigente_desde ? { vigente_desde: datos.vigente_desde } : {}),
    }
}

/** Cuerpo de `POST /lealtad/reglas`: una rama de la unión por `tipo`. */
export function cuerpoReglaLealtad(programaId: number, datos: SalidaReglaLealtad): CuerpoRegla {
    const base = { programa_id: programaId, ...comunes(datos) }
    switch (datos.tipo) {
        case 'pago_a_tiempo':
            return { ...base, tipo: 'pago_a_tiempo', condiciones: condicionesDe({ ...datos, tipo: 'pago_a_tiempo' }) as Extract<CuerpoRegla, { tipo: 'pago_a_tiempo' }>['condiciones'] }
        case 'antiguedad':
            return { ...base, tipo: 'antiguedad', condiciones: condicionesDe({ ...datos, tipo: 'antiguedad' }) as Extract<CuerpoRegla, { tipo: 'antiguedad' }>['condiciones'] }
        case 'referido':
            return { ...base, tipo: 'referido', condiciones: condicionesDe({ ...datos, tipo: 'referido' }) as Extract<CuerpoRegla, { tipo: 'referido' }>['condiciones'] }
        case 'pago_adelantado':
            return { ...base, tipo: 'pago_adelantado', condiciones: condicionesDe({ ...datos, tipo: 'pago_adelantado' }) as Extract<CuerpoRegla, { tipo: 'pago_adelantado' }>['condiciones'] }
    }
}

/** Cuerpo de `PUT /lealtad/reglas/:id` (el tipo no cambia). */
export function cuerpoEdicionReglaLealtad(regla: Regla, datos: SalidaReglaLealtad): CuerpoEdicionRegla {
    return { version: regla.version, ...comunes({ ...datos, tipo: regla.tipo }), condiciones: condicionesDe({ ...datos, tipo: regla.tipo }) }
}

export interface LineaVistaPrevia {
    concepto: string
    puntos: number
    /** Q del pasivo que difiere (`puntos × valor_pasivo_punto`); `null` sin diferimiento. */
    pasivo: Decimal | null
    /** Q que vale para el cliente (`puntos × valor_punto`). */
    valor: Decimal
}

/**
 * Vista previa de lo que entrega una regla por otorgamiento, con el valor del programa: los
 * puntos base y los extras (racha, bono al referido, puntos por mes adelantado al mínimo).
 */
export function vistaPreviaRegla(datos: EntradaReglaLealtad, programa: Pick<Programa, 'valor_punto' | 'valor_pasivo_punto' | 'diferimiento'>): LineaVistaPrevia[] {
    const linea = (concepto: string, puntos: number): LineaVistaPrevia => ({
        concepto,
        puntos,
        pasivo: programa.diferimiento ? new Decimal(programa.valor_pasivo_punto).times(puntos).toDecimalPlaces(2) : null,
        valor: new Decimal(programa.valor_punto).times(puntos).toDecimalPlaces(2),
    })
    const lineas = [linea('Por otorgamiento', Number.isFinite(datos.puntos) ? datos.puntos : 0)]
    if (datos.tipo === 'pago_a_tiempo' && datos.con_racha) {
        lineas.push(linea(`Bono cada ${datos.racha_periodos} facturas seguidas`, datos.racha_puntos_extra))
    }
    if (datos.tipo === 'referido' && datos.puntos_referido > 0) {
        lineas.push(linea('Bono al cliente referido', datos.puntos_referido))
    }
    if (datos.tipo === 'pago_adelantado' && datos.puntos_por_periodo > 0) {
        lineas.push(linea(`Por mes adelantado (mínimo ${datos.periodos_minimos})`, datos.puntos_por_periodo * datos.periodos_minimos))
    }
    return lineas
}

/** Condiciones de una regla en una frase para la lista. */
export function resumenCondiciones(regla: Pick<Regla, 'tipo' | 'condiciones'>): string {
    const c: Record<string, unknown> = { ...regla.condiciones }
    switch (regla.tipo) {
        case 'pago_a_tiempo': {
            const partes = [Number(c.dias_antes_vencimiento) > 0 ? `${String(c.dias_antes_vencimiento)} días antes del vencimiento` : 'A más tardar el día que vence']
            if (c.solo_servicio) {
                partes.push('solo servicio')
            }
            if (c.sin_promesa) {
                partes.push('sin promesa')
            }
            const racha = c.racha as { periodos?: number, puntos_extra?: number } | null | undefined
            if (racha?.periodos) {
                partes.push(`racha de ${racha.periodos}: +${racha.puntos_extra ?? 0}`)
            }
            if (typeof c.monto_minimo === 'string') {
                partes.push(`desde ${formatearQuetzales(c.monto_minimo)}`)
            }
            return partes.join(' · ')
        }
        case 'antiguedad': {
            const estados = Array.isArray(c.estados_validos) ? c.estados_validos.join(', ') : 'activo'
            return [`Cada ${String(c.cada_meses ?? 12)} meses`, `estados: ${estados}`, typeof c.sin_vencidas_mas_de_dias === 'number' ? `sin vencidas de más de ${c.sin_vencidas_mas_de_dias} días` : null].filter(Boolean).join(' · ')
        }
        case 'referido':
            return [`${String(c.facturas_pagadas_minimas ?? 2)} facturas pagadas`, typeof c.dias_maximos === 'number' ? `en ${c.dias_maximos} días` : null, Number(c.puntos_referido) > 0 ? `bono al referido +${String(c.puntos_referido)}` : null, typeof c.tope_por_referidor === 'number' ? `tope ${c.tope_por_referidor} por referidor` : null].filter(Boolean).join(' · ')
        case 'pago_adelantado':
            return `Mínimo ${String(c.periodos_minimos ?? 1)} meses · +${String(c.puntos_por_periodo ?? 0)} por mes`
    }
}

/* Ajustes. */

/** Espejo de `ajusteValidator`: puntos con signo distintos de 0 (±1 000 000) y motivo de 3 a 500. */
export const esquemaAjustePuntos = z.object({
    puntos: z.number({ message: 'Puntos enteros' }).int('Puntos enteros').min(-1_000_000, 'Máximo 1 000 000').max(1_000_000, 'Máximo 1 000 000').refine(valor => valor !== 0, 'Distinto de cero: positivo agrega, negativo descuenta'),
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
    servicio_id: z.number().int().positive().nullable(),
})

export type EntradaAjustePuntos = z.input<typeof esquemaAjustePuntos>
