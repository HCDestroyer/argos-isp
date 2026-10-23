import Decimal from 'decimal.js'
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd } from '../bd'
import { conPermiso, datosInvalidos, empresasDeLista, problemaTipado, usuariosPorToken } from '../comun'
import { vistaObligacion } from '../calendario/rutas'
import { calcularDatos } from '../declaraciones/rutas'
import { resolverValor } from '../fiscal/rutas'

/**
 * Tablero fiscal (A3, fase 8 PR A; `start/routes/tablero.ts`, `app/fiscal/tablero.ts`). Como la API, cada
 * bloque se calcula por separado con lo mismo que usan las otras pantallas del fixture: el facturado
 * con los renglones de ventas de `datosDeclaraciones` (el libro de ventas), los estimados con
 * `calcularDatos` de las declaraciones (las mismas cifras que el borrador; el ISO sale en error por
 * `iso_base_periodo` sin confirmar), los vencimientos con `fiscal.obligaciones` y la última versión de
 * su declaración, los libros con las emisiones con folio y la FEL con su configuración y los DTE.
 *
 * Diferencias del mundo del fixture: el régimen de la instalación se capturó con vigencia 17/10/2026
 * (dos días después de `HOY_FIXTURES`), así que sin un régimen de la empresa vigente a hoy se usa el
 * de la instalación y no el valor por defecto del paquete; los libros cuentan desde el 1/1/2025, el mismo `inicio_libros` de las declaraciones.
 * Los parámetros que el paquete del fixture no trae usan el valor del paquete gt-2026.1 de la API.
 */

type Tablero = Schema<'TableroFiscal'>
type Empresa = Tablero['empresas'][number]
type Bloques = Empresa['bloques']
type Nombre = keyof Bloques
type Estimado = Schema<'EstimadoDeclaracion'>
type Impuesto = Schema<'Declaracion'>['impuesto']

const DIAS_VENCIMIENTOS = 30
const MAX_MESES_LISTADOS = 24
const LIBROS = ['ventas', 'compras', 'diario', 'mayor'] as const
const INICIO_LIBROS = '2025-01-01'
/** Valores del paquete gt-2026.1 (`l10n/gt/parametros.ts`) que el paquete del fixture no trae. */
const PAQUETE: Record<string, unknown> = {
    pc_alertas: ['80.00', '100.00'],
    libros_ventana_meses: 2,
    mora_tributaria: '0.05',
    isr_trimestral_plazo: { plazo: 'mes_siguiente', cuarto_trimestre: 'con_la_anual', formulario: 'SAT-1361' },
    reserva_incobrables_max: '3.00',
}

/**
 * Activos fijos del fixture (`ledger.activos` sin bajas; el panel aún no tiene pantalla de activos): el
 * servidor de ArgosNet y el mostrador de Fibra del Sur se deprecian por debajo del máximo de su clase.
 */
const ACTIVOS: { id: number, empresa_id: number, clase: string, descripcion: string, costo: string, valor_residual: string, tasa_anual: string }[] = [
    { id: 1, empresa_id: 1, clase: 'equipo_red', descripcion: 'Router de borde MikroTik CCR2116', costo: '18500.00', valor_residual: '0.00', tasa_anual: '10.00' },
    { id: 2, empresa_id: 1, clase: 'computacion', descripcion: 'Servidor del RADIUS', costo: '12000.00', valor_residual: '1200.00', tasa_anual: '20.00' },
    { id: 3, empresa_id: 1, clase: 'vehiculos', descripcion: 'Pickup de instalaciones', costo: '95000.00', valor_residual: '15000.00', tasa_anual: '20.00' },
    { id: 4, empresa_id: 2, clase: 'mobiliario', descripcion: 'Mostrador de atención', costo: '6000.00', valor_residual: '0.00', tasa_anual: '10.00' },
]

/** Proveedor no identificado con NIT: sin NIT o «CF» (consumidor final). */
function sinNit(nit: string | null): boolean {
    return !nit || nit.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === 'CF'
}

/** Señal de `no_aplica` dentro del cálculo de un bloque (`NoAplica` de la API). */
class NoAplica {
    constructor(readonly motivo: string) {}
}

/** Problema de un bloque, como `Problema.toJSON()`. */
class FallaBloque {
    constructor(readonly problema: Problem) {}
}

function problemaDe(respuesta: RespuestaFixture): Problem {
    return respuesta.cuerpo as Problem
}

function sinConfirmar(clave: string, fecha: string): FallaBloque {
    return new FallaBloque(problemaDe(problemaTipado(422, 'parametro_sin_confirmar', 'Parámetro sin confirmar', `El parámetro ${clave} no tiene valor vigente al ${fecha}; debe confirmarlo el contador`, [{ field: clave, message: `Sin valor vigente al ${fecha}`, rule: 'parametro_sin_confirmar' }])))
}

function valor(empresaId: number, clave: string, hoy: string): unknown {
    const fila = resolverValor(empresaId, clave, hoy)
    return fila ? fila.valor : (PAQUETE[clave] ?? null)
}

function regimenDe(empresaId: number, hoy: string): string | null {
    const vigente = resolverValor(empresaId, 'regimen', hoy)
    if (vigente && vigente.origen !== 'paquete' && typeof vigente.valor === 'string') {
        return vigente.valor
    }
    const instalado = bd.fiscal.valores.find(v => v.clave === 'regimen' && v.empresa_id === empresaId && v.origen === 'instalacion')?.valor
    if (typeof instalado === 'string') {
        return instalado
    }
    return typeof vigente?.valor === 'string' ? vigente.valor : null
}

const texto = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2)
const mesDe = (fecha: string) => `${fecha.slice(0, 7)}-01`

function trimestreDe(fecha: string): string {
    const mes = Number(fecha.slice(5, 7))
    return `${fecha.slice(0, 4)}-${String(Math.floor((mes - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
}

function finDe(impuesto: Impuesto, desde: string): string {
    const [anio = 0, mes = 0] = desde.split('-').map(Number)
    const meses = impuesto === 'isr_anual' ? 12 : impuesto === 'isr_trimestral' || impuesto === 'iso_trimestral' ? 3 : 1
    return new Date(Date.UTC(anio, mes - 1 + meses, 0)).toISOString().slice(0, 10)
}

function textoPeriodo(impuesto: Impuesto, desde: string): string {
    if (impuesto === 'isr_trimestral' || impuesto === 'iso_trimestral') {
        return `${desde.slice(0, 4)}-T${Math.floor((Number(desde.slice(5, 7)) - 1) / 3) + 1}`
    }
    return impuesto === 'isr_anual' ? desde.slice(0, 4) : desde.slice(0, 7)
}

function diasEntre(hoy: string, fecha: string): number {
    return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000)
}

function ultimaVersion(empresaId: number, impuesto: string, desde: string): Schema<'Declaracion'> | null {
    return bd.declaraciones
        .filter(d => d.empresa_id === empresaId && d.impuesto === impuesto && d.periodo_desde === desde)
        .sort((a, b) => a.version - b.version)
        .at(-1) ?? null
}

interface Contexto {
    empresaId: number
    hoy: string
    regimen: string | null
}

function exigirRegimen(ctx: Contexto): string {
    if (!ctx.regimen) {
        throw sinConfirmar('regimen', ctx.hoy)
    }
    return ctx.regimen
}

/** Resumen del libro de ventas entre `desde` y hoy (`resumenVentas`). */
function resumenVentas(ctx: Contexto, desde: string) {
    const filas = bd.datosDeclaraciones
        .filter(d => d.empresa_id === ctx.empresaId)
        .flatMap(d => d.renglones)
        .filter(r => r.seccion === 'ventas' && r.fecha >= desde && r.fecha <= ctx.hoy)
    const tipos = new Map<string, { documentos: number, base: Decimal, iva: Decimal, total: Decimal }>()
    for (const r of filas) {
        const tipo = r.tipo ?? 'sin_dte'
        const actual = tipos.get(tipo) ?? { documentos: 0, base: new Decimal(0), iva: new Decimal(0), total: new Decimal(0) }
        tipos.set(tipo, { documentos: actual.documentos + 1, base: actual.base.plus(r.base), iva: actual.iva.plus(r.iva), total: actual.total.plus(r.total) })
    }
    const suma = (campo: 'base' | 'iva' | 'total') => texto(filas.reduce((s, r) => s.plus(r[campo]), new Decimal(0)))
    return {
        desde,
        hasta: ctx.hoy,
        documentos: filas.length,
        base: suma('base'),
        iva: suma('iva'),
        total: suma('total'),
        por_tipo: [...tipos.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tipo, v]) => ({ tipo, documentos: v.documentos, base: texto(v.base), iva: texto(v.iva), total: texto(v.total) })),
    }
}

/** Declaración del periodo calculada con los datos de hoy, sin guardarla (`estimado`). */
function estimado(ctx: Contexto, impuesto: Impuesto, desde: string): Estimado {
    const hasta = finDe(impuesto, desde)
    const calculo = calcularDatos(ctx.empresaId, impuesto, desde, hasta)
    if ('status' in calculo) {
        throw new FallaBloque(problemaDe(calculo))
    }
    const version = ultimaVersion(ctx.empresaId, impuesto, desde)
    return {
        impuesto,
        periodo: textoPeriodo(impuesto, desde),
        periodo_desde: desde,
        periodo_hasta: hasta,
        formulario: version?.formulario ?? bd.obligacionesFiscales.find(o => o.empresa_id === ctx.empresaId && o.impuesto === impuesto && o.periodo_desde === desde)?.formulario ?? null,
        totales: calculo.totales,
        notas: calculo.detalle.notas ?? [],
        declaracion: version ? { id: version.id, version: version.version, estado: version.estado, al_dia: version.datos_hash === calculo.datos_hash } : null,
    }
}

const CALCULOS: { [N in Nombre]: (ctx: Contexto) => NonNullable<Bloques[N]['datos']> } = {
    facturado: ctx => ({ mes: resumenVentas(ctx, mesDe(ctx.hoy)), anio: resumenVentas(ctx, `${ctx.hoy.slice(0, 4)}-01-01`) }),

    iva: (ctx) => {
        const regimen = exigirRegimen(ctx)
        return estimado(ctx, regimen === 'pequeno_contribuyente' ? 'pc_mensual' : 'iva_mensual', mesDe(ctx.hoy))
    },

    isr: (ctx) => {
        const regimen = exigirRegimen(ctx)
        if (regimen === 'pequeno_contribuyente') {
            throw new NoAplica('regimen_pequeno_contribuyente: paga el 5 % sobre sus ventas (bloque iva)')
        }
        if (regimen === 'opcional_simplificado') {
            return { regimen, mensual: estimado(ctx, 'isr_opcional_mensual', mesDe(ctx.hoy)), trimestral: null, anual: null }
        }
        const trimestre = trimestreDe(ctx.hoy)
        const plazo = valor(ctx.empresaId, 'isr_trimestral_plazo', ctx.hoy) as { cuarto_trimestre?: string } | null
        const conLaAnual = trimestre.slice(5, 7) === '10' && plazo?.cuarto_trimestre === 'con_la_anual'
        const trimestral = conLaAnual ? null : estimado(ctx, 'isr_trimestral', trimestre)
        const anual = estimado(ctx, 'isr_anual', `${ctx.hoy.slice(0, 4)}-01-01`)
        const meses = Number(ctx.hoy.slice(5, 7))
        const proyectado = (clave: string) => texto(new Decimal(anual.totales[clave] ?? '0').times(12).dividedBy(meses))
        return {
            regimen,
            mensual: null,
            trimestral,
            trimestral_con_la_anual: conLaAnual,
            anual: { ...anual, meses_transcurridos: meses, renta_proyectada: proyectado('renta_imponible'), isr_proyectado: proyectado('isr') },
        }
    },

    iso: (ctx) => {
        const regimen = exigirRegimen(ctx)
        if (regimen !== 'utilidades') {
            throw new NoAplica(`regimen_${regimen}: el ISO es del régimen sobre utilidades`)
        }
        return estimado(ctx, 'iso_trimestral', trimestreDe(ctx.hoy))
    },

    pequeno_contribuyente: (ctx) => {
        const regimen = exigirRegimen(ctx)
        if (regimen !== 'pequeno_contribuyente') {
            throw new NoAplica(`regimen_${regimen}`)
        }
        const anio = ctx.hoy.slice(0, 4)
        const limite = resolverValor(ctx.empresaId, 'pc_limite_anual', ctx.hoy)
        if (!limite || typeof limite.valor !== 'string' || !limite.vigente_desde?.startsWith(anio)) {
            throw sinConfirmar('pc_limite_anual', `${anio}-01-01`)
        }
        const acumulado = new Decimal(resumenVentas(ctx, `${anio}-01-01`).total)
        const tope = new Decimal(limite.valor)
        const porcentaje = tope.gt(0) ? acumulado.times(100).dividedBy(tope).toDecimalPlaces(2) : new Decimal(0)
        const umbrales = valor(ctx.empresaId, 'pc_alertas', ctx.hoy)
        const lista = Array.isArray(umbrales) ? umbrales.map(u => new Decimal(String(u))) : []
        const alcanzado = lista.filter(u => porcentaje.gte(u)).sort((a, b) => a.comparedTo(b)).at(-1) ?? null
        return {
            anio: Number(anio),
            acumulado: texto(acumulado),
            limite: texto(tope),
            porcentaje: texto(porcentaje),
            disponible: texto(Decimal.max(tope.minus(acumulado), 0)),
            umbrales: lista.map(texto),
            umbral_alcanzado: alcanzado ? texto(alcanzado) : null,
            supera_limite: acumulado.gt(tope),
            mensaje: acumulado.gt(tope)
                ? 'Superó el límite anual del pequeño contribuyente: debe pasar al régimen general (inv. A.3). El sistema no cambia el régimen; hágalo con su contador'
                : null,
        }
    },

    vencimientos: (ctx) => {
        const limite = new Date(Date.parse(`${ctx.hoy}T00:00:00Z`) + DIAS_VENCIMIENTOS * 86_400_000).toISOString().slice(0, 10)
        const mora = valor(ctx.empresaId, 'mora_tributaria', ctx.hoy)
        const obligaciones = bd.obligacionesFiscales
            .filter(o => o.empresa_id === ctx.empresaId && (o.estado === 'pendiente' || o.estado === 'borrador') && o.vence_en <= limite)
            .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.id - b.id)
            .map((fila) => {
                const o = vistaObligacion(fila, ctx.hoy)
                const dias = diasEntre(ctx.hoy, o.vence_en)
                const declaracion = o.declaracion_id !== null ? ultimaVersion(ctx.empresaId, o.impuesto, o.periodo_desde) : null
                const aPagar = declaracion ? texto(new Decimal(declaracion.totales.a_pagar ?? '0')) : null
                const moraEstimada = dias < 0 && aPagar !== null && typeof mora === 'string'
                    ? texto(new Decimal(aPagar).times(mora).dividedBy(100).times(-dias))
                    : null
                return {
                    obligacion_id: o.id,
                    impuesto: o.impuesto,
                    nombre: o.nombre,
                    periodo_desde: o.periodo_desde,
                    periodo_hasta: o.periodo_hasta,
                    formulario: o.formulario,
                    vence_en: o.vence_en,
                    dias_restantes: dias,
                    vencida: dias < 0,
                    estado: o.estado === 'borrador' ? 'borrador' as const : 'pendiente' as const,
                    declaracion_id: o.declaracion_id,
                    a_pagar: aPagar,
                    mora_estimada: moraEstimada,
                }
            })
        return {
            hasta: limite,
            mora_tributaria: typeof mora === 'string' ? mora : null,
            vencidas: obligaciones.filter(o => o.vencida).length,
            obligaciones,
        }
    },

    libros: (ctx) => {
        const ventana = valor(ctx.empresaId, 'libros_ventana_meses', ctx.hoy)
        if (typeof ventana !== 'number') {
            throw sinConfirmar('libros_ventana_meses', ctx.hoy)
        }
        const [anio = 0, mes = 0] = ctx.hoy.split('-').map(Number)
        const mesTexto = (desplazamiento: number) => new Date(Date.UTC(anio, mes - 1 - desplazamiento, 1)).toISOString().slice(0, 7)
        const ultimoTerminado = mesTexto(1)
        const limiteAtraso = mesTexto(ventana + 1)
        const terminados: string[] = []
        for (let i = 1; mesTexto(i) >= INICIO_LIBROS.slice(0, 7); i++) {
            terminados.unshift(mesTexto(i))
        }
        const libros = LIBROS.map((libro) => {
            const propias = bd.librosEmisiones.filter(e => e.empresa_id === ctx.empresaId && e.libro === libro)
            const cubierto = (m: string) => propias.some(e => e.desde <= `${m}-01` && e.hasta >= finDe('iva_mensual', `${m}-01`))
            const sinEmitir = terminados.filter(m => m <= ultimoTerminado && !cubierto(m))
            const atrasados = sinEmitir.filter(m => m <= limiteAtraso)
            return {
                libro,
                habilitado: bd.librosHabilitaciones.some(h => h.empresa_id === ctx.empresaId && h.libro === libro),
                ultimo_emitido_hasta: propias.map(e => e.hasta).sort().at(-1) ?? null,
                meses_sin_emitir: sinEmitir.length,
                meses_atrasados: atrasados.length,
                atrasados: atrasados.slice(0, MAX_MESES_LISTADOS),
                al_dia: atrasados.length === 0,
            }
        })
        const atrasados = libros.filter(l => !l.al_dia)
        return {
            ventana_meses: ventana,
            inicio_libros: INICIO_LIBROS,
            libros,
            alerta: atrasados.length
                ? `Libros sin emitir fuera del plazo (${ventana} meses): ${atrasados.map(l => l.libro).join(', ')}. La multa de referencia es de Q5,000 por libro (inv. E.2); valídelo con su contador`
                : null,
        }
    },

    fel: (ctx) => {
        const config = bd.fel.configuraciones[ctx.empresaId]
        const modo = config?.modo ?? 'desactivada'
        const legal = valor(ctx.empresaId, 'fel_modo', ctx.hoy)
        const pendientes = new Map<string, number>()
        for (const dte of bd.fel.dte) {
            if (dte.empresa_id === ctx.empresaId && ['pendiente', 'enviando', 'error_temporal', 'contingencia'].includes(dte.estado)) {
                pendientes.set(dte.estado, (pendientes.get(dte.estado) ?? 0) + 1)
            }
        }
        return {
            modo,
            obligacion_legal: typeof legal === 'string' ? legal : null,
            proveedor: config?.proveedor ?? null,
            contingencia_activa: config?.contingencia_activa ?? false,
            dte_pendientes: [...pendientes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([estado, cantidad]) => ({ estado, cantidad })),
            alerta: legal === 'obligatoria' && modo === 'desactivada' ? 'FEL es obligatoria para su régimen: la empresa emite sin DTE (FEL desactivada)' : null,
        }
    },

    compras_sin_nit: (ctx) => {
        const limite = valor(ctx.empresaId, 'consumidor_final_limite', ctx.hoy)
        if (typeof limite !== 'string') {
            throw sinConfirmar('consumidor_final_limite', ctx.hoy)
        }
        const anio = ctx.hoy.slice(0, 4)
        const filas = bd.compras
            .filter(c => c.empresa_id === ctx.empresaId && c.estado !== 'anulada' && c.tipo_documento !== 'NCRE'
                && c.fecha_documento >= `${anio}-01-01` && c.fecha_documento <= ctx.hoy
                && new Decimal(c.total).gte(limite) && sinNit(c.proveedor_nit))
            .sort((a, b) => a.fecha_documento.localeCompare(b.fecha_documento) || a.id - b.id)
        return {
            anio: Number(anio),
            limite: texto(new Decimal(limite)),
            cantidad: filas.length,
            total: texto(filas.reduce((s, c) => s.plus(c.total), new Decimal(0))),
            compras: filas.slice(0, 50).map(c => ({
                compra_id: c.id,
                fecha: c.fecha_documento,
                documento: `${c.tipo_documento} ${c.serie} ${c.numero}`.replace(/\s+/g, ' ').trim(),
                total: texto(new Decimal(c.total)),
                proveedor_id: c.proveedor_id,
                proveedor: c.proveedor_nombre,
                identificacion: `nit: ${c.proveedor_nit || 'sin número'}`,
            })),
        }
    },

    incobrables: (ctx) => {
        // Σ saldos deudores por cliente (facturas abiertas) y estimación registrada en 1.1.12.
        const porCliente = new Map<number, Decimal>()
        for (const f of bd.facturas) {
            if ((f.empresa_id ?? 1) === ctx.empresaId && ['emitida', 'parcial', 'vencida'].includes(f.estado) && f.emitida_en.slice(0, 10) <= ctx.hoy) {
                porCliente.set(f.cliente_id, (porCliente.get(f.cliente_id) ?? new Decimal(0)).plus(f.total).minus(f.pagado))
            }
        }
        const base = [...porCliente.values()].filter(s => s.gt(0)).reduce((s, x) => s.plus(x), new Decimal(0))
        const porcentaje = valor(ctx.empresaId, 'reserva_incobrables_max', ctx.hoy)
        if (typeof porcentaje !== 'string') {
            throw sinConfirmar('reserva_incobrables_max', ctx.hoy)
        }
        const tope = base.times(porcentaje).dividedBy(100).toDecimalPlaces(2)
        const provisto = bd.provisiones.filter(p => p.empresa_id === ctx.empresaId && p.fecha <= ctx.hoy).reduce((s, p) => s.plus(p.monto), new Decimal(0))
        const usado = bd.castigos.filter(c => c.empresa_id === ctx.empresaId).reduce((s, c) => s.plus(c.estimacion), new Decimal(0))
        const estimacion = provisto.minus(usado)
        return {
            corte: ctx.hoy,
            base: texto(base),
            porcentaje: texto(new Decimal(porcentaje)),
            tope: texto(tope),
            estimacion: texto(estimacion),
            disponible: texto(Decimal.max(tope.minus(estimacion), 0)),
            sobre_tope: estimacion.gt(tope),
        }
    },

    depreciacion: (ctx) => {
        const topes = valor(ctx.empresaId, 'depreciacion', ctx.hoy)
        if (!topes || typeof topes !== 'object') {
            throw sinConfirmar('depreciacion', ctx.hoy)
        }
        const tope = topes as Record<string, string>
        const activos = ACTIVOS.filter(a => a.empresa_id === ctx.empresaId)
        const bajo = activos
            .filter(a => tope[a.clase] !== undefined && new Decimal(a.tasa_anual).lt(tope[a.clase]!))
            .map((a) => {
                const depreciable = new Decimal(a.costo).minus(a.valor_residual)
                const actual = depreciable.times(a.tasa_anual).dividedBy(100).toDecimalPlaces(2)
                const maxima = depreciable.times(tope[a.clase]!).dividedBy(100).toDecimalPlaces(2)
                return {
                    activo_id: a.id,
                    clase: a.clase,
                    descripcion: a.descripcion,
                    costo: texto(new Decimal(a.costo)),
                    tasa_anual: texto(new Decimal(a.tasa_anual)),
                    tasa_maxima: texto(new Decimal(tope[a.clase]!)),
                    depreciacion_anual: texto(actual),
                    depreciacion_anual_maxima: texto(maxima),
                    diferencia_anual: texto(maxima.minus(actual)),
                }
            })
        return {
            activos: activos.length,
            bajo_maximo: bajo.length,
            diferencia_anual: texto(bajo.reduce((s, b) => s.plus(b.diferencia_anual), new Decimal(0))),
            detalle: bajo.slice(0, 50),
        }
    },
}

function calcularBloque<N extends Nombre>(ctx: Contexto, nombre: N): Bloques[N] {
    try {
        return { estado: 'ok', motivo: null, error: null, datos: CALCULOS[nombre](ctx) } as Bloques[N]
    }
    catch (error) {
        if (error instanceof NoAplica) {
            return { estado: 'no_aplica', motivo: error.motivo, error: null, datos: null } as Bloques[N]
        }
        const problema = error instanceof FallaBloque
            ? error.problema
            : problemaDe(problemaTipado(500, 'error_interno', 'Error interno', `No se pudo calcular el bloque ${nombre}`))
        return { estado: 'error', motivo: null, error: problema, datos: null } as Bloques[N]
    }
}

export function tableroEmpresa(empresaId: number, hoy: string): Empresa {
    const ctx: Contexto = { empresaId, hoy, regimen: regimenDe(empresaId, hoy) }
    const instalada = (bd.fiscal.instalaciones[empresaId] ?? []).length > 0
    const sinLocalizacion = instalada
        ? null
        : problemaDe(problemaTipado(422, 'localizacion_no_instalada', 'Localización no instalada', `La empresa ${empresaId} no tiene localización fiscal instalada`))
    const bloque = <N extends Nombre>(nombre: N): Bloques[N] => (sinLocalizacion
        ? { estado: 'error', motivo: null, error: sinLocalizacion, datos: null } as Bloques[N]
        : calcularBloque(ctx, nombre))
    return {
        empresa_id: empresaId,
        regimen: instalada ? ctx.regimen : null,
        bloques: {
            facturado: bloque('facturado'),
            iva: bloque('iva'),
            isr: bloque('isr'),
            iso: bloque('iso'),
            pequeno_contribuyente: bloque('pequeno_contribuyente'),
            vencimientos: bloque('vencimientos'),
            libros: bloque('libros'),
            fel: bloque('fel'),
            compras_sin_nit: bloque('compras_sin_nit'),
            incobrables: bloque('incobrables'),
            depreciacion: bloque('depreciacion'),
        },
    }
}

export const rutasTablero: RutasFixture = {
    'GET /api/v1/fiscal/tablero': conPermiso('fiscal.ver', (solicitud) => {
        const pedido = solicitud.query.get('empresas')
        if (pedido !== null && pedido !== '' && pedido !== 'todas') {
            return datosInvalidos([{ field: 'empresas', message: 'Valor no permitido', rule: 'enum' }])
        }
        // `empresasDeLaLista`: el consolidado exige alcance global.
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (pedido === 'todas' && usuario?.alcance_global !== true) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'El consolidado de todas las empresas (empresas=todas) requiere alcance global')
        }
        const ids = empresasDeLista(solicitud)
        const hoy = hoyGuatemala()
        const empresas = (ids ?? bd.empresas.filter(e => e.activa).map(e => e.id)).map(id => tableroEmpresa(id, hoy))
        const cuerpo: Tablero = { hoy, empresas }
        return { status: 200, cuerpo }
    }),
}
