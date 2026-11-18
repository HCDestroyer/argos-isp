import type { Schema } from '@argosisp/contracts'
import type { PresentacionEstadoUi } from './estados'

/**
 * Contrato Iris 0.8.0 en la pantalla del conector: qué contrato habla cada lado, qué queda apagado
 * con un Iris anterior y lo que Iris informó de su primera sincronización
 * (`ConectorIris.sincronizacion`, `PUT /integraciones/iris/sincronizacion` de A1).
 */

export type SincronizacionIris = Schema<'SincronizacionIris'>
export type EtapaSincronizacionIris = SincronizacionIris['etapas'][number]
export type RecursoSincronizacionIris = EtapaSincronizacionIris['recurso']
export type EstadoConectorIrisPublico = Schema<'EstadoConectorIris'>

/** Desde esta versión Argos manda a Iris lo nuevo de 0.8.0 (`conectorAdmite('0.8.0')` en la API). */
export const CONTRATO_IRIS_080 = '0.8.0'

/** Lo que un Iris anterior a 0.8.0 no recibe o no puede pedir, en palabras del manual. */
export const FUNCIONES_DESDE_080: readonly string[] = [
    'Iris no se entera al momento cuando se crea o edita una cuenta bancaria; la ve en la próxima sincronización.',
    'Iris no puede pedir una reconexión temporal porque no hay personal de caja (solo fuera de horario).',
    'Iris no informa aquí el avance de su sincronización.',
    'Iris no recibe el precio mensual del servicio ni los avisos de cambio de precio.',
]

/** Compara dos versiones `mayor.menor.parche`; lo que no es número cuenta como 0. */
export function compararContratos(a: string, b: string): number {
    const partes = (v: string) => v.split('.').map(p => Number.parseInt(p, 10) || 0)
    const [x, y] = [partes(a), partes(b)]
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const diferencia = (x[i] ?? 0) - (y[i] ?? 0)
        if (diferencia !== 0) {
            return diferencia
        }
    }
    return 0
}

/** `al_dia`: Iris habla 0.8.0 o más; `anterior`: algo queda apagado; `sin_dato`: Iris nunca lo informó. */
export type EstadoContratoIris = 'al_dia' | 'anterior' | 'sin_dato'

export function estadoContratoIris(contrato: string | null): EstadoContratoIris {
    if (!contrato) {
        return 'sin_dato'
    }
    return compararContratos(contrato, CONTRATO_IRIS_080) >= 0 ? 'al_dia' : 'anterior'
}

/** Orden y nombre de cada recurso, como los copia Iris. */
export const RECURSOS_SINCRONIZACION_IRIS: Record<RecursoSincronizacionIris, string> = {
    empresas: 'Empresas',
    zonas: 'Zonas',
    planes: 'Planes',
    routers: 'Routers',
    bancos: 'Bancos',
    cuentas_bancarias: 'Cuentas bancarias',
    clientes: 'Clientes',
    servicios: 'Servicios',
}

/** Siempre icono + texto + color. */
export const ESTADOS_SINCRONIZACION_IRIS: Record<EtapaSincronizacionIris['estado'], PresentacionEstadoUi> = {
    pendiente: { etiqueta: 'Sin empezar', color: 'neutral', icono: 'i-lucide-circle-dashed' },
    en_curso: { etiqueta: 'En curso', color: 'info', icono: 'i-lucide-loader' },
    completa: { etiqueta: 'Completa', color: 'success', icono: 'i-lucide-circle-check' },
    con_errores: { etiqueta: 'Con errores', color: 'warning', icono: 'i-lucide-triangle-alert' },
}

export const SIN_SINCRONIZACION_IRIS = 'Iris aún no ha informado la sincronización'

/** Etapas en el orden de `RECURSOS_SINCRONIZACION_IRIS` (Iris puede mandarlas en otro). */
export function etapasOrdenadas(sincronizacion: SincronizacionIris): EtapaSincronizacionIris[] {
    const orden = Object.keys(RECURSOS_SINCRONIZACION_IRIS)
    return [...sincronizacion.etapas].sort((a, b) => orden.indexOf(a.recurso) - orden.indexOf(b.recurso))
}

const numero = new Intl.NumberFormat('es-GT')

/** «120 de 300», «120 copiados» si Iris aún no sabe el total, «Sin empezar» en cero. */
export function textoProgresoEtapa(etapa: Pick<EtapaSincronizacionIris, 'procesados' | 'total' | 'estado'>): string {
    if (etapa.total !== null) {
        return `${numero.format(etapa.procesados)} de ${numero.format(etapa.total)}`
    }
    if (etapa.procesados === 0 && etapa.estado === 'pendiente') {
        return 'Sin empezar'
    }
    return `${numero.format(etapa.procesados)} ${etapa.procesados === 1 ? 'copiado' : 'copiados'}`
}

/** Porcentaje 0–100 de la etapa; null si Iris no informó el total. */
export function porcentajeEtapa(etapa: Pick<EtapaSincronizacionIris, 'procesados' | 'total'>): number | null {
    if (etapa.total === null) {
        return null
    }
    if (etapa.total === 0) {
        return 100
    }
    return Math.min(100, Math.round((etapa.procesados / etapa.total) * 100))
}

/** Alcance del usuario técnico Iris en palabras, con los nombres de las empresas. */
export function textoAlcanceTecnicoIris(alcance: Schema<'ResumenEnviosIris'>['alcance'], nombre: (id: number) => string): string {
    if (alcance === null) {
        return 'Todavía no hay usuario técnico de Iris: nace al conectar y, sin otra indicación, ve todas las empresas.'
    }
    if (alcance.global) {
        return 'Alcance global: Iris ve todas las empresas, también las que se creen después.'
    }
    if (!alcance.empresas.length) {
        return 'Sin empresas: Iris no ve nada.'
    }
    return alcance.empresas.map(nombre).join(', ')
}

/** Rótulo de la configuración a mano (`iris_pat_`) y de los tokens generados a mano. */
export const ETIQUETA_RECUPERACION_IRIS = 'Vía de recuperación (avanzado)'

/** Aviso de la aprobación con el botón y del enlace de conexión (contrato Iris 0.8.0). */
export const AVISO_COPIA_IRIS = 'Iris copiará los clientes, los servicios y las cuentas bancarias de estas empresas.'
