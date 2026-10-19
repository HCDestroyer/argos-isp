import type { Problem, Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Sorteos (A3, `contratos/lealtad.md` §7, §8 y §15.3): estados, pasos, checklist legal, tipos de
 * premio y espejos de los validadores VineJS (`apps/api/app/lealtad/validators.ts`).
 */

type Sorteo = Schema<'SorteoDetalle'>
type EstadoSorteoApi = Sorteo['estado']
type Premio = Sorteo['premios'][number]
type Ganador = Sorteo['ganadores'][number]
type Requisito = Schema<'RequisitoSorteo'>
type ClaveRequisito = Requisito['clave']
type CuerpoSorteo = paths['/api/v1/lealtad/sorteos']['post']['requestBody']['content']['application/json']
type CuerpoEdicionSorteo = paths['/api/v1/lealtad/sorteos/{id}']['put']['requestBody']['content']['application/json']
type CuerpoEntrega = paths['/api/v1/lealtad/sorteos/{id}/ganadores/{ganadorId}/entregar']['post']['requestBody']['content']['application/json']
type Color = NonNullable<BadgeProps['color']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const PORCENTAJE = /^\d{1,3}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export const ESTADOS_SORTEO: Record<EstadoSorteoApi, { etiqueta: string, color: Color, icono: string }> = {
    borrador: { etiqueta: 'Borrador', color: 'neutral', icono: 'i-lucide-pencil-line' },
    bases_publicadas: { etiqueta: 'Bases publicadas', color: 'info', icono: 'i-lucide-scroll-text' },
    participacion_abierta: { etiqueta: 'Participación abierta', color: 'primary', icono: 'i-lucide-ticket' },
    corte_cerrado: { etiqueta: 'Corte cerrado', color: 'warning', icono: 'i-lucide-list-checks' },
    ejecutado: { etiqueta: 'Ejecutado', color: 'success', icono: 'i-lucide-trophy' },
    acta_cerrada: { etiqueta: 'Acta cerrada', color: 'success', icono: 'i-lucide-file-signature' },
    premios_entregados: { etiqueta: 'Premios entregados', color: 'success', icono: 'i-lucide-gift' },
    cancelado: { etiqueta: 'Cancelado', color: 'neutral', icono: 'i-lucide-ban' },
}

/** Un estado que la API agregue después se muestra por su nombre. */
export function estadoSorteoVisual(estado: string): { etiqueta: string, color: Color, icono: string } {
    if (Object.hasOwn(ESTADOS_SORTEO, estado)) {
        return ESTADOS_SORTEO[estado as EstadoSorteoApi]
    }
    const texto = estado.replace(/_/g, ' ')
    return { etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), color: 'neutral', icono: 'i-lucide-circle-help' }
}

/** Los pasos del sorteo en orden (sin `cancelado`), para el avance de la ficha. */
export const PASOS_SORTEO: readonly EstadoSorteoApi[] = ['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado', 'ejecutado', 'acta_cerrada', 'premios_entregados']

/** Ya hay resultado (ganadores): ejecutado, con el acta cerrada o con todo entregado. */
export const ESTADOS_CON_RESULTADO: readonly EstadoSorteoApi[] = ['ejecutado', 'acta_cerrada', 'premios_entregados']

/** Hasta antes de ejecutar se puede anunciar (o dejar de anunciar) en el portal (`PUT .../aviso-portal`). */
export const ESTADOS_AVISO_PORTAL: readonly EstadoSorteoApi[] = ['borrador', 'bases_publicadas', 'participacion_abierta', 'corte_cerrado']

export type AccionSorteo = 'editar' | 'publicar_bases' | 'abrir' | 'cerrar_corte' | 'ejecutar' | 'cancelar'

/** Qué acción toca en cada estado (la API responde 409 `estado_sorteo` a las demás). */
export function accionesSorteo(estado: string): AccionSorteo[] {
    switch (estado) {
        case 'borrador':
            return ['editar', 'publicar_bases', 'cancelar']
        case 'bases_publicadas':
            return ['abrir', 'cancelar']
        case 'participacion_abierta':
            return ['cerrar_corte', 'cancelar']
        case 'corte_cerrado':
            return ['ejecutar', 'cancelar']
        default:
            return []
    }
}

/** Permiso de cada acción (`apps/api/app/core/permisos.ts`, contrato §14). */
export const PERMISO_ACCION_SORTEO: Record<AccionSorteo, string> = {
    editar: 'sorteos.gestionar',
    publicar_bases: 'sorteos.publicar',
    abrir: 'sorteos.publicar',
    cerrar_corte: 'sorteos.publicar',
    ejecutar: 'sorteos.ejecutar',
    cancelar: 'sorteos.publicar',
}

export type PasoRequisito = 'abrir' | 'ejecutar' | 'acta' | 'cierre'

export interface RequisitoVisual {
    etiqueta: string
    requisito: string
    fuente: string
    /** Para qué paso se exige (§8). */
    para: PasoRequisito
    /** Qué se anota en `valor` (número de resolución, monto…). */
    valor: string | null
    /** Se puede marcar pero no bloquea su paso (decisión del PM: Gobernación y fianza). */
    noBloquea?: true
}

/**
 * Checklist legal (§8). La API exige hoy los de abrir y ejecutar (menos Gobernación y fianza, que se
 * marcan sin bloquear: decisión del PM, 19 oct); los otros llegan con el acta.
 */
export const REQUISITOS_SORTEO: Record<ClaveRequisito, RequisitoVisual> = {
    bases_diaco: {
        etiqueta: 'Bases publicadas (DIACO)',
        requisito: 'Bases con los campos obligatorios publicadas en un medio idóneo.',
        fuente: 'inv. F.4',
        para: 'abrir',
        valor: 'Medio y fecha de publicación',
    },
    autorizacion_gobernacion: {
        etiqueta: 'Autorización de la Gobernación',
        requisito: 'Resolución de la Gobernación Departamental del departamento del sorteo (número y fecha). En un sorteo gratuito entre clientes, «No aplica» solo con un criterio escrito de la Gobernación.',
        fuente: 'inv. F.5; NO VERIFICADO 15',
        para: 'ejecutar',
        valor: 'Número y fecha de la resolución',
        noBloquea: true,
    },
    fianza: {
        etiqueta: 'Fianza',
        requisito: 'Fianza fijada en la resolución (en Escuintla, 10 % de la emisión; varía).',
        fuente: 'inv. F.5',
        para: 'ejecutar',
        valor: 'Número y monto de la fianza',
        noBloquea: true,
    },
    isr_premios: {
        etiqueta: 'ISR de los premios',
        requisito: 'ISR del 10 % sobre el valor de los premios, retenido o pagado antes; en especie, sobre el valor de libre competencia.',
        fuente: 'inv. F.2 (arts. 84.4 y 92), F.5',
        para: 'ejecutar',
        valor: 'Formulario o recibo de pago',
    },
    timbre_fiscal: {
        etiqueta: 'Timbre fiscal',
        requisito: 'Timbre del 3 % que pide la Gobernación.',
        fuente: 'inv. F.5; tasa NO VERIFICADO 1',
        para: 'ejecutar',
        valor: 'Recibo del timbre',
    },
    delegado_o_notario: {
        etiqueta: 'Delegado o notario',
        requisito: 'Delegado del Ministerio de Gobernación o notario presente, con nombre.',
        fuente: 'inv. F.5',
        para: 'ejecutar',
        valor: 'Nombre y colegiado o cargo',
    },
    publicacion_resultados: {
        etiqueta: 'Resultados publicados',
        requisito: 'Resultados publicados inmediatamente después, por medios idóneos.',
        fuente: 'inv. F.4',
        para: 'acta',
        valor: 'Medio y fecha',
    },
    lista_a_gobernacion: {
        etiqueta: 'Lista a la Gobernación',
        requisito: 'Lista de ganadores y constancias de entrega entregadas a la Gobernación.',
        fuente: 'inv. F.5',
        para: 'cierre',
        valor: 'Número de memorial o recibido',
    },
}

export const PASOS_REQUISITO: Record<PasoRequisito, string> = {
    abrir: 'Para abrir la participación',
    ejecutar: 'Para ejecutar el sorteo',
    acta: 'Para cerrar el acta',
    cierre: 'Para cerrar el sorteo',
}

export const AVISO_REQUISITOS = 'Referencia; valídelo con su contador o abogado. El sistema no presenta memoriales ni paga impuestos: solo registra lo que usted hizo.'

export const ESTADOS_REQUISITO: Record<Requisito['estado'], { etiqueta: string, color: Color, icono: string }> = {
    cumplido: { etiqueta: 'Cumplido', color: 'success', icono: 'i-lucide-circle-check' },
    no_aplica: { etiqueta: 'No aplica', color: 'info', icono: 'i-lucide-circle-slash' },
    pendiente: { etiqueta: 'Pendiente', color: 'warning', icono: 'i-lucide-circle-dashed' },
}

/**
 * Claves que el paso exige (las mismas que `REQUISITOS_PARA_ABRIR` y `_EJECUTAR` de la API). Gobernación
 * y fianza quedan en el checklist pero no bloquean la ejecución (decisión del PM, 19 oct).
 */
export function requisitosDelPaso(paso: 'abrir' | 'ejecutar'): ClaveRequisito[] {
    const claves = (Object.keys(REQUISITOS_SORTEO) as ClaveRequisito[]).filter(c => !REQUISITOS_SORTEO[c].noBloquea)
    return paso === 'abrir'
        ? claves.filter(c => REQUISITOS_SORTEO[c].para === 'abrir')
        : claves.filter(c => ['abrir', 'ejecutar'].includes(REQUISITOS_SORTEO[c].para))
}

/** Requisitos del paso aún pendientes (la API respondería 422 `requisito_pendiente` con el primero). */
export function requisitosFaltantes(requisitos: readonly Requisito[], paso: 'abrir' | 'ejecutar'): ClaveRequisito[] {
    return requisitosDelPaso(paso).filter(clave => (requisitos.find(r => r.clave === clave)?.estado ?? 'pendiente') === 'pendiente')
}

export const TIPOS_PREMIO_SORTEO: Record<Premio['tipo'], { etiqueta: string, icono: string, entrega: string }> = {
    efectivo: { etiqueta: 'Efectivo', icono: 'i-lucide-banknote', entrega: 'Egreso de caja o banco por el valor menos el ISR retenido.' },
    bien: { etiqueta: 'Bien', icono: 'i-lucide-package', entrega: 'Gasto 5.1.03 con la línea de su compra registrada o contra una cuenta de activo.' },
    servicio: { etiqueta: 'Servicio', icono: 'i-lucide-wifi', entrega: 'Descuento o mes gratis del catálogo, reservado para la próxima factura.' },
}

export const ESTADOS_GANADOR: Record<Ganador['estado'], { etiqueta: string, color: Color }> = {
    por_notificar: { etiqueta: 'Por notificar', color: 'warning' },
    notificado: { etiqueta: 'Notificado', color: 'info' },
    entregado: { etiqueta: 'Entregado', color: 'success' },
    no_reclamado: { etiqueta: 'No reclamado', color: 'neutral' },
    sustituido: { etiqueta: 'Sustituido', color: 'neutral' },
}

/** Titulares = Σ cantidad de los premios (`titularesDe` de la API). */
export function titularesSorteo(premios: readonly Pick<Premio, 'cantidad'>[]): number {
    return premios.reduce((suma, p) => suma + p.cantidad, 0)
}

/** Valor total de los premios (valor × cantidad), con `decimal.js`. */
export function valorPremiosSorteo(premios: readonly Pick<Premio, 'cantidad' | 'valor'>[]): Decimal {
    return premios.reduce((suma, p) => suma.plus(new Decimal(p.valor).times(p.cantidad)), new Decimal(0))
}

/** ISR del premio si lo retiene (`valor × isr_pct / 100`, a centavos), o cero. */
export function isrPremio(premio: Pick<Premio, 'valor' | 'retiene_isr' | 'isr_pct'>): Decimal {
    return premio.retiene_isr ? new Decimal(premio.valor).times(premio.isr_pct).div(100).toDecimalPlaces(2) : new Decimal(0)
}

/** Lo que se le paga al ganador: en efectivo, el valor menos el ISR retenido; en especie, el valor. */
export function netoPremio(premio: Pick<Premio, 'valor' | 'retiene_isr' | 'isr_pct' | 'tipo'>): Decimal {
    return premio.tipo === 'efectivo' ? new Decimal(premio.valor).minus(isrPremio(premio)) : new Decimal(premio.valor)
}

/** Premio que le toca a un titular (`premio_posicion`), o `null` para un suplente. */
export function premioDeGanador(sorteo: Pick<Sorteo, 'premios'>, ganador: Pick<Ganador, 'premio_posicion'>): Premio | null {
    return ganador.premio_posicion === null ? null : sorteo.premios.find(p => p.posicion === ganador.premio_posicion) ?? null
}

/** Texto de un 422 `requisito_pendiente` con el nombre del requisito (`errors[0].message` = la clave). */
export function problemaSorteoLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    if (codigo === 'requisito_pendiente') {
        const clave = problema.errors?.find(e => e.field === 'requisitos')?.message
        const visual = clave && Object.hasOwn(REQUISITOS_SORTEO, clave) ? REQUISITOS_SORTEO[clave as ClaveRequisito] : null
        return {
            ...problema,
            title: visual ? `Falta el requisito «${visual.etiqueta}»` : 'Falta un requisito legal',
            detail: visual
                ? `${visual.requisito} Márquelo como cumplido o «No aplica», con su evidencia, en el checklist.`
                : problema.detail,
        }
    }
    if (codigo === 'bases_incompletas') {
        return { ...problema, title: 'Bases incompletas', detail: problema.errors?.[0]?.message ?? problema.detail }
    }
    if (codigo === 'estado_sorteo') {
        return { ...problema, title: 'El sorteo ya cambió de paso', detail: `${problema.detail ?? ''} Recargue la ficha.`.trim() }
    }
    if (codigo === 'corte_no_vencido') {
        return { ...problema, title: 'Aún no llega la fecha de corte' }
    }
    if (codigo === 'sin_participantes') {
        return { ...problema, title: 'Sin participantes' }
    }
    return problema
}

/* Formulario del sorteo (borrador). */

const textoBases = (maximo: number) => z.string().trim().max(maximo, `Hasta ${maximo} caracteres`)

const esquemaPremio = z.object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200, 'Hasta 200 caracteres'),
    cantidad: z.number({ message: 'Cantidad inválida' }).int('Sin decimales').min(1, 'Al menos 1').max(100, 'Hasta 100'),
    valor: z.string().trim().regex(MONTO, 'Monto con hasta 2 decimales, sin comas').refine(v => !MONTO.test(v) || new Decimal(v).gt(0), 'Mayor que 0'),
    tipo: z.enum(['efectivo', 'bien', 'servicio']),
    premio_id: z.number().int().positive().nullable(),
    retiene_isr: z.boolean(),
    isr_pct: z.string().trim().regex(PORCENTAJE, 'Porcentaje con hasta 2 decimales'),
}).refine(p => p.tipo !== 'servicio' || p.premio_id !== null, { path: ['premio_id'], message: 'Elija el descuento o mes gratis del catálogo' })

export const esquemaSorteo = z.object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200, 'Hasta 200 caracteres'),
    descripcion: textoBases(4000),
    mecanica: textoBases(4000),
    regla_participacion: textoBases(2000),
    plazo_reclamo_dias: z.number({ message: 'Número de días' }).int('Sin decimales').min(0).max(3650).nullable(),
    no_reclamados: textoBases(2000),
    publicacion_resultados: textoBases(2000),
    resolucion_gobernacion: textoBases(200),
    fuente_valor_publico: textoBases(500),
    boletos_por_servicio: z.number({ message: 'Número de boletos' }).int('Sin decimales').min(0, 'De 0 a 100').max(100, 'De 0 a 100'),
    admite_canje: z.boolean(),
    inscripcion_desde: z.string().trim().refine(v => v === '' || FECHA.test(v), 'Fecha inválida'),
    corte_en: z.string().trim().refine(v => v === '' || LOCAL.test(v), 'Fecha y hora inválidas'),
    fecha_sorteo: z.string().trim().refine(v => v === '' || LOCAL.test(v), 'Fecha y hora inválidas'),
    lugar: textoBases(300),
    suplentes: z.number({ message: 'Número de suplentes' }).int('Sin decimales').min(0, 'De 0 a 20').max(20, 'De 0 a 20'),
    premios: z.array(esquemaPremio).max(50, 'Hasta 50 premios'),
}).refine(d => !d.corte_en || !d.fecha_sorteo || d.fecha_sorteo >= d.corte_en, { path: ['fecha_sorteo'], message: 'El sorteo no puede ser antes del corte' })

export type EntradaSorteo = z.input<typeof esquemaSorteo>
export type SalidaSorteo = z.output<typeof esquemaSorteo>
export type EntradaPremioSorteo = EntradaSorteo['premios'][number]

export function entradaPremioVacia(): EntradaPremioSorteo {
    return { nombre: '', cantidad: 1, valor: '', tipo: 'efectivo', premio_id: null, retiene_isr: true, isr_pct: '10' }
}

export function entradaSorteoVacia(): EntradaSorteo {
    return {
        nombre: '',
        descripcion: '',
        mecanica: '',
        regla_participacion: '',
        plazo_reclamo_dias: 30,
        no_reclamados: '',
        publicacion_resultados: '',
        resolucion_gobernacion: '',
        fuente_valor_publico: '',
        boletos_por_servicio: 1,
        admite_canje: false,
        inscripcion_desde: '',
        corte_en: '',
        fecha_sorteo: '',
        lugar: '',
        suplentes: 0,
        premios: [entradaPremioVacia()],
    }
}

function textoDe(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

export function entradaDeSorteo(sorteo: Sorteo): EntradaSorteo {
    const plazo = sorteo.bases.plazo_reclamo_dias
    return {
        nombre: sorteo.nombre,
        descripcion: sorteo.descripcion ?? '',
        mecanica: textoDe(sorteo.bases.mecanica),
        regla_participacion: textoDe(sorteo.bases.regla_participacion),
        plazo_reclamo_dias: typeof plazo === 'number' ? plazo : null,
        no_reclamados: textoDe(sorteo.bases.no_reclamados),
        publicacion_resultados: textoDe(sorteo.bases.publicacion_resultados),
        resolucion_gobernacion: textoDe(sorteo.bases.resolucion_gobernacion),
        fuente_valor_publico: textoDe(sorteo.bases.fuente_valor_publico),
        boletos_por_servicio: sorteo.criterios.boletos_por_servicio,
        admite_canje: sorteo.criterios.admite_canje,
        inscripcion_desde: sorteo.inscripcion_desde ?? '',
        corte_en: sorteo.corte_en ? localGuatemala(sorteo.corte_en) : '',
        fecha_sorteo: sorteo.fecha_sorteo ? localGuatemala(sorteo.fecha_sorteo) : '',
        lugar: sorteo.lugar ?? '',
        suplentes: sorteo.suplentes,
        premios: sorteo.premios.map(p => ({
            nombre: p.nombre,
            cantidad: p.cantidad,
            valor: p.valor,
            tipo: p.tipo,
            premio_id: p.premio_id,
            retiene_isr: p.retiene_isr,
            isr_pct: new Decimal(p.isr_pct).toString(),
        })),
    }
}

/** Cuerpo de `POST /lealtad/sorteos` (los vacíos no se mandan o van como `null`). */
export function cuerpoSorteo(datos: SalidaSorteo): CuerpoSorteo {
    const bases: NonNullable<CuerpoSorteo['bases']> = {
        resolucion_gobernacion: datos.resolucion_gobernacion || null,
    }
    if (datos.mecanica) {
        bases.mecanica = datos.mecanica
    }
    if (datos.regla_participacion) {
        bases.regla_participacion = datos.regla_participacion
    }
    if (datos.plazo_reclamo_dias !== null) {
        bases.plazo_reclamo_dias = datos.plazo_reclamo_dias
    }
    if (datos.no_reclamados) {
        bases.no_reclamados = datos.no_reclamados
    }
    if (datos.publicacion_resultados) {
        bases.publicacion_resultados = datos.publicacion_resultados
    }
    if (datos.fuente_valor_publico) {
        bases.fuente_valor_publico = datos.fuente_valor_publico
    }
    const cuerpo: CuerpoSorteo = {
        nombre: datos.nombre,
        descripcion: datos.descripcion || null,
        bases,
        criterios: { boletos_por_servicio: datos.boletos_por_servicio, admite_canje: datos.admite_canje },
        inscripcion_desde: datos.inscripcion_desde || null,
        lugar: datos.lugar || null,
        suplentes: datos.suplentes,
        premios: datos.premios.map(p => ({
            nombre: p.nombre,
            cantidad: p.cantidad,
            valor: new Decimal(p.valor).toFixed(2),
            tipo: p.tipo,
            premio_id: p.tipo === 'servicio' ? p.premio_id : null,
            retiene_isr: p.retiene_isr,
            isr_pct: new Decimal(p.isr_pct).toFixed(2),
        })),
    }
    const corte = instanteGuatemala(datos.corte_en)
    const fecha = instanteGuatemala(datos.fecha_sorteo)
    if (corte) {
        cuerpo.corte_en = corte
    }
    if (fecha) {
        cuerpo.fecha_sorteo = fecha
    }
    return cuerpo
}

export function cuerpoEdicionSorteo(sorteo: Pick<Sorteo, 'version'>, datos: SalidaSorteo): CuerpoEdicionSorteo {
    return { version: sorteo.version, ...cuerpoSorteo(datos) }
}

/* Requisito, ejecución y entrega. */

export const esquemaRequisitoSorteo = z.object({
    estado: z.enum(['cumplido', 'no_aplica', 'pendiente']),
    valor: textoBases(500),
    evidencia: textoBases(2000),
    nota: textoBases(2000),
}).refine(d => d.estado === 'pendiente' || d.evidencia.length > 0, {
    path: ['evidencia'],
    message: 'Un requisito cumplido o que no aplica lleva su evidencia (número, referencia o texto)',
})

export type EntradaRequisitoSorteo = z.input<typeof esquemaRequisitoSorteo>

export const esquemaEjecutarSorteo = z.object({
    valor_publico: z.string().trim().min(1, 'El valor público del acto es obligatorio').max(500, 'Hasta 500 caracteres'),
    valor_publico_evidencia: z.string().trim().min(1, 'Diga cómo se obtuvo el valor en el acto').max(2000, 'Hasta 2000 caracteres'),
    asistentes: z.array(z.object({
        nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200, 'Hasta 200 caracteres'),
        rol: textoBases(200),
    })).max(20, 'Hasta 20 asistentes'),
})

export type EntradaEjecutarSorteo = z.input<typeof esquemaEjecutarSorteo>

export const esquemaEntregaPremio = z.object({
    tipo: z.enum(['efectivo', 'bien', 'servicio']),
    metodo: z.enum(['caja', 'banco', 'cuenta_bancaria']).nullable(),
    caja_id: z.number().int().positive().nullable(),
    banco_id: z.number().int().positive().nullable(),
    cuenta_bancaria_id: z.number().int().positive().nullable(),
    contrapartida: z.enum(['compra', 'cuenta']).nullable(),
    compra_linea_id: z.number().int().positive().nullable(),
    cuenta_codigo: textoBases(30),
    nota: textoBases(2000),
}).superRefine((d, ctx) => {
    if (d.tipo === 'efectivo') {
        if (!d.metodo) {
            ctx.addIssue({ code: 'custom', path: ['metodo'], message: 'Indique de dónde sale el efectivo' })
        }
        if (d.metodo === 'caja' && d.caja_id === null) {
            ctx.addIssue({ code: 'custom', path: ['caja_id'], message: 'Elija la caja' })
        }
        if (d.metodo === 'banco' && d.banco_id === null) {
            ctx.addIssue({ code: 'custom', path: ['banco_id'], message: 'Elija el banco' })
        }
        if (d.metodo === 'cuenta_bancaria' && d.cuenta_bancaria_id === null) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_bancaria_id'], message: 'Elija la cuenta bancaria' })
        }
    }
    if (d.tipo === 'bien') {
        if (!d.contrapartida) {
            ctx.addIssue({ code: 'custom', path: ['contrapartida'], message: 'La compra del bien o una cuenta de activo' })
        }
        if (d.contrapartida === 'compra' && d.compra_linea_id === null) {
            ctx.addIssue({ code: 'custom', path: ['compra_linea_id'], message: 'Elija la línea de la compra con la que se compró el bien' })
        }
        if (d.contrapartida === 'cuenta' && !d.cuenta_codigo) {
            ctx.addIssue({ code: 'custom', path: ['cuenta_codigo'], message: 'Elija la cuenta de activo' })
        }
    }
})

export type EntradaEntregaPremio = z.input<typeof esquemaEntregaPremio>

/** Anular la entrega (H22): motivo de al menos 3 caracteres, como la API. */
export const esquemaAnularEntrega = z.object({
    motivo: z.string().trim().min(3, 'El motivo es obligatorio (mínimo 3 caracteres)').max(2000, 'Hasta 2000 caracteres'),
})

export type EntradaAnularEntrega = z.input<typeof esquemaAnularEntrega>

export function entradaEntregaVacia(tipo: Premio['tipo']): EntradaEntregaPremio {
    return { tipo, metodo: tipo === 'efectivo' ? 'caja' : null, caja_id: null, banco_id: null, cuenta_bancaria_id: null, contrapartida: tipo === 'bien' ? 'compra' : null, compra_linea_id: null, cuenta_codigo: '', nota: '' }
}

/** Cuerpo de la entrega: solo la contrapartida del tipo del premio (servicio no lleva ninguna). */
export function cuerpoEntregaPremio(datos: z.output<typeof esquemaEntregaPremio>): CuerpoEntrega {
    const nota = datos.nota || null
    if (datos.tipo === 'efectivo') {
        return {
            metodo: datos.metodo,
            caja_id: datos.metodo === 'caja' ? datos.caja_id : null,
            banco_id: datos.metodo === 'banco' ? datos.banco_id : null,
            cuenta_bancaria_id: datos.metodo === 'cuenta_bancaria' ? datos.cuenta_bancaria_id : null,
            nota,
        }
    }
    if (datos.tipo === 'bien') {
        return datos.contrapartida === 'compra'
            ? { contrapartida: 'compra', compra_linea_id: datos.compra_linea_id, nota }
            : { contrapartida: datos.contrapartida, cuenta_codigo: datos.cuenta_codigo || null, nota }
    }
    return { nota }
}

/**
 * Contrapartida guardada en el ganador (`caja`, `compra 12`, `cuenta 1.1.14`, `canje`; `proveedor` en
 * entregas anteriores a la decisión del PM) en palabras.
 */
export function contrapartidaLegible(contrapartida: string | null): string {
    if (!contrapartida) {
        return '—'
    }
    const conocidas: Record<string, string> = {
        caja: 'Egreso de caja',
        banco: 'Egreso de banco',
        cuenta_bancaria: 'Egreso de cuenta bancaria',
        proveedor: 'Proveedores (2.1.03)',
        canje: 'Canje para la próxima factura',
    }
    if (Object.hasOwn(conocidas, contrapartida)) {
        return conocidas[contrapartida] ?? contrapartida
    }
    if (contrapartida.startsWith('compra ')) {
        return `Compra #${contrapartida.slice(7)}`
    }
    return contrapartida.startsWith('cuenta ') ? `Cuenta ${contrapartida.slice(7)}` : contrapartida
}

/**
 * Lista blanca de la contrapartida `cuenta` de un bien (H25, igual que `cuentaParaBienDePremio` de la
 * API): activo imputable de la empresa o global, sin contracuentas ni auxiliar de clientes y fuera de las
 * cuentas control (caja y bancos, CxC, impuestos, cobros por liquidar, fondos en tránsito, estimación,
 * gastos anticipados y el activo no corriente).
 */
const CUENTAS_CONTROL_BIEN = ['1.1.01', '1.1.02', '1.1.03', '1.1.04', '1.1.05', '1.1.06', '1.1.07', '1.1.08', '1.1.09', '1.1.10', '1.1.11', '1.1.12', '1.1.13', '1.2']

export function cuentaParaBienDePremio(c: Pick<Schema<'Cuenta'>, 'codigo' | 'tipo' | 'imputable' | 'contracuenta' | 'auxiliar_cliente' | 'empresa_id' | 'activa'>, empresaId: number | null): boolean {
    if (c.tipo !== 'activo' || !c.imputable || c.contracuenta || c.auxiliar_cliente || !c.activa) {
        return false
    }
    const empresaCuenta = c.empresa_id ?? null
    if (empresaCuenta !== null && empresaId !== null && empresaCuenta !== empresaId) {
        return false
    }
    return !CUENTAS_CONTROL_BIEN.some(p => c.codigo === p || c.codigo.startsWith(`${p}.`))
}

/** Línea de una compra que puede ser el bien entregado: un bien de una compra vigente que no sea NCRE. */
export function lineasDeBien(compras: readonly Schema<'Compra'>[], empresaId: number | null): { compra: Schema<'Compra'>, linea: Schema<'LineaCompra'> }[] {
    return compras
        .filter(c => c.estado === 'vigente' && c.tipo_documento !== 'NCRE' && (empresaId === null || c.empresa_id === empresaId))
        .flatMap(compra => compra.lineas.filter(l => l.tipo === 'bien').map(linea => ({ compra, linea })))
}
