import type { Schema } from '@argosisp/contracts'

/**
 * Textos y alertas del tablero fiscal (A3, fase 8 PR A; contrato §22). Las cifras salen tal cual de la
 * API: aquí solo se nombran los bloques, se traduce el motivo de `no_aplica` y se reúnen las alertas
 * que la API ya trae (`mensaje`, `alerta`) más las vencidas, para destacarlas arriba de la sección.
 */

type Empresa = Schema<'TableroFiscal'>['empresas'][number]
type Bloques = Empresa['bloques']
type Libro = NonNullable<Schema<'BloqueLibros'>['datos']>['libros'][number]['libro']

export type NombreBloqueTablero = keyof Bloques

export const BLOQUES_TABLERO: Record<NombreBloqueTablero, { titulo: string, icono: string }> = {
    facturado: { titulo: 'Facturado', icono: 'i-lucide-receipt-text' },
    iva: { titulo: 'IVA del mes', icono: 'i-lucide-percent' },
    isr: { titulo: 'ISR estimado', icono: 'i-lucide-landmark' },
    iso: { titulo: 'ISO del trimestre', icono: 'i-lucide-hand-heart' },
    pequeno_contribuyente: { titulo: 'Límite de pequeño contribuyente', icono: 'i-lucide-store' },
    vencimientos: { titulo: 'Vencimientos', icono: 'i-lucide-calendar-clock' },
    libros: { titulo: 'Libros por emitir', icono: 'i-lucide-book-marked' },
    fel: { titulo: 'Factura electrónica (FEL)', icono: 'i-lucide-shield-check' },
}

/** Orden de las tarjetas: lo que vence y las alertas primero, luego los estimados y el facturado. */
export const ORDEN_BLOQUES_TABLERO: readonly NombreBloqueTablero[] = ['vencimientos', 'iva', 'isr', 'iso', 'pequeno_contribuyente', 'facturado', 'libros', 'fel']

/** Aviso fijo de todo estimado: se calcula con los datos de hoy y no se guarda. */
export const AVISO_ESTIMADO = 'Estimado con los datos de hoy; no se guarda ni se presenta. Confirmar con contador.'

/**
 * Motivo de un bloque que no aplica (`regimen_<r>` y, tras «:», la explicación de la API) en palabras:
 * «No aplica al régimen Pequeño contribuyente: paga el 5 % sobre sus ventas (bloque iva)».
 */
export function motivoNoAplicaTablero(motivo: string | null): string {
    if (!motivo) {
        return 'No aplica a esta empresa'
    }
    const separador = motivo.indexOf(':')
    const codigo = (separador >= 0 ? motivo.slice(0, separador) : motivo).trim()
    const explicacion = separador >= 0 ? motivo.slice(separador + 1).trim() : ''
    const base = codigo.startsWith('regimen_')
        ? `No aplica al régimen ${etiquetaRegimen(codigo.slice('regimen_'.length))}`
        : `No aplica (${codigo})`
    return explicacion ? `${base}: ${explicacion}` : base
}

export const LIBROS_TABLERO: Record<Libro, string> = {
    ventas: 'Ventas',
    compras: 'Compras',
    diario: 'Diario',
    mayor: 'Mayor',
}

/** `AAAA-MM` → «ene 2026». */
export function mesAtrasado(mes: string): string {
    const [anio = 0, numero = 1] = mes.split('-').map(Number)
    const nombre = new Intl.DateTimeFormat('es-GT', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(anio, numero - 1, 1)))
    return `${nombre.replace('.', '')} ${anio}`
}

export interface AlertaTablero {
    clave: 'pequeno_contribuyente' | 'fel' | 'libros' | 'vencidas'
    titulo: string
    descripcion: string
    icono: string
    /** Destino para resolverla; la pantalla lo muestra solo con el permiso de esa página. */
    enlace: { etiqueta: string, ruta: string, permiso: string } | null
}

/** Alertas destacadas de una empresa: las que trae la API y las vencidas sin presentar. */
export function alertasTablero(empresa: Empresa): AlertaTablero[] {
    const alertas: AlertaTablero[] = []
    const { pequeno_contribuyente: pc, fel, libros, vencimientos } = empresa.bloques
    if (vencimientos.estado === 'ok' && vencimientos.datos && vencimientos.datos.vencidas > 0) {
        const n = vencimientos.datos.vencidas
        alertas.push({
            clave: 'vencidas',
            titulo: n === 1 ? '1 obligación vencida sin presentar' : `${n} obligaciones vencidas sin presentar`,
            descripcion: `${n === 1 ? 'Preséntela' : 'Preséntelas'} cuanto antes: la mora y la multa crecen cada día. La mora del tablero es una estimación; confirmar con contador.`,
            icono: 'i-lucide-alarm-clock-off',
            enlace: { etiqueta: 'Ver calendario', ruta: '/fiscal/calendario', permiso: 'declaraciones.ver' },
        })
    }
    if (pc.estado === 'ok' && pc.datos?.mensaje) {
        alertas.push({
            clave: 'pequeno_contribuyente',
            titulo: 'Debe pasar al régimen general',
            descripcion: pc.datos.mensaje,
            icono: 'i-lucide-triangle-alert',
            enlace: { etiqueta: 'Régimen fiscal', ruta: '/configuracion/fiscal', permiso: 'fiscal.ver' },
        })
    }
    if (fel.estado === 'ok' && fel.datos?.alerta) {
        alertas.push({
            clave: 'fel',
            titulo: 'FEL obligatoria desactivada',
            descripcion: fel.datos.alerta,
            icono: 'i-lucide-shield-off',
            enlace: { etiqueta: 'Configurar FEL', ruta: '/configuracion/fel', permiso: 'fel.ver' },
        })
    }
    if (libros.estado === 'ok' && libros.datos?.alerta) {
        alertas.push({
            clave: 'libros',
            titulo: 'Libros atrasados',
            descripcion: libros.datos.alerta,
            icono: 'i-lucide-book-x',
            enlace: { etiqueta: 'Libros legales', ruta: '/libros', permiso: 'libros.ver' },
        })
    }
    return alertas
}
