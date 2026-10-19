import type { Problem, Schema, paths } from '@argosisp/contracts'

/**
 * Etiquetas y formato de la localización fiscal (A3, fase 2; `contratos/localizacion-fiscal.md`).
 * Todo lo que se muestra sale de la API: aquí solo se traduce a texto legible.
 */

type Parametro = Schema<'ParametroFiscal'>
type Impuesto = Schema<'ImpuestoFiscal'>
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type RegimenFiscal = paths['/api/v1/fiscal/regimen']['post']['requestBody']['content']['application/json']['regimen']

export const REGIMENES_FISCALES: Record<RegimenFiscal, { etiqueta: string, descripcion: string }> = {
    utilidades: { etiqueta: 'Sobre utilidades', descripcion: 'ISR del 25 % sobre la renta; pagos trimestrales (LAT, art. 36)' },
    opcional_simplificado: { etiqueta: 'Opcional simplificado', descripcion: 'ISR sobre ingresos (5 % y 7 %), retención definitiva (LAT, art. 44)' },
    pequeno_contribuyente: { etiqueta: 'Pequeño contribuyente', descripcion: 'Impuesto del 5 % sobre ingresos; factura FPEQ sin crédito fiscal (Ley IVA, art. 45)' },
}

/** El aviso de la ley que acompaña a todo cambio de régimen (LAT, arts. 50 y 51). */
export const AVISO_REGIMEN = 'El cambio de régimen rige desde el 1 de enero de un año futuro y exige el aviso a la SAT presentado en diciembre del año anterior (LAT, art. 51). La primera configuración de la empresa admite cualquier fecha. El sistema nunca cambia el régimen por su cuenta.'

export function etiquetaRegimen(valor: unknown): string {
    return typeof valor === 'string' && valor in REGIMENES_FISCALES ? REGIMENES_FISCALES[valor as RegimenFiscal].etiqueta : 'Sin régimen'
}

type NivelParametro = NonNullable<Parametro['nivel']>

/** De dónde sale el valor vigente: la cadena empresa → instalación → global → paquete. */
export const NIVELES_FISCALES: Record<NivelParametro, { etiqueta: string, color: BadgeColor, ayuda: string }> = {
    empresa: { etiqueta: 'Empresa', color: 'primary', ayuda: 'Valor propio de esta empresa' },
    instalacion: { etiqueta: 'Instalación', color: 'info', ayuda: 'Lo dejó el instalador al instalar el paquete' },
    global: { etiqueta: 'Global', color: 'warning', ayuda: 'Valor de toda la instalación (todas las empresas)' },
    paquete: { etiqueta: 'Paquete', color: 'neutral', ayuda: 'Valor provisto por el paquete de localización' },
    derivado: { etiqueta: 'Derivado', color: 'neutral', ayuda: 'Se calcula de otros parámetros' },
}

export const ALCANCES_FISCALES: Record<Parametro['alcance'], string> = {
    N: 'Ley (no editable)',
    G: 'Global o por empresa',
    E: 'Por empresa',
}

export const CONFIANZA_FISCAL: Record<Parametro['confianza'], string> = {
    'alta': 'Confianza alta',
    'media-alta': 'Confianza media-alta',
    'media': 'Confianza media',
    'baja-media': 'Confianza baja-media',
    'baja': 'Confianza baja',
    'no_verificado': 'No verificado',
    'diseno': 'Decisión de diseño',
}

export const GRUPOS_IMPUESTO: Record<Impuesto['grupo'], string> = {
    iva: 'IVA',
    retencion_iva: 'Retención de IVA',
    retencion_isr: 'Retención de ISR',
    pequeno_contribuyente: 'Pequeño contribuyente',
}

export const USOS_IMPUESTO: Record<Impuesto['uso'], string> = {
    venta: 'Ventas',
    compra: 'Compras',
}

export const CALCULOS_IMPUESTO: Record<Impuesto['calculo'], string> = {
    porcentaje_incluido: 'Incluido en el precio',
    porcentaje_del_impuesto: 'Porcentaje del impuesto',
    porcentaje_de_base: 'Porcentaje de la base',
    porcentaje_del_total: 'Porcentaje del total',
}

/** Banderas de la empresa: parámetros sí/no de alcance empresa (agente de retención, contribuyente especial…). */
export function esBandera(parametro: Parametro): boolean {
    return parametro.tipo === 'bool' && parametro.alcance === 'E' && !parametro.derivado
}

/** El parámetro se edita desde la lista (no el régimen, que tiene su acción, ni los de la ley). */
export function editableEnLista(parametro: Parametro): boolean {
    return parametro.editable && parametro.accion === null && !parametro.derivado
}

/** Texto del valor de un parámetro según su tipo; `null` = «Sin valor» (nada se inventa). */
export function formatearValorFiscal(tipo: Parametro['tipo'], valor: unknown, clave?: string): string {
    if (valor === null || valor === undefined) {
        return 'Sin valor'
    }
    if (clave === 'regimen') {
        return etiquetaRegimen(valor)
    }
    switch (tipo) {
        case 'bool':
            return valor === true ? 'Sí' : 'No'
        case 'monto':
            return typeof valor === 'string' ? formatearQuetzales(valor) : String(valor)
        case 'porcentaje':
            return `${String(valor)} %`
        case 'fecha':
            return typeof valor === 'string' ? formatearFecha(valor) : String(valor)
        case 'enum':
            return String(valor).replace(/_/g, ' ')
        case 'json':
            return JSON.stringify(valor)
        default:
            return String(valor)
    }
}

/** `-15.00 %` en las retenciones (`signo = -1`); la tasa siempre llega en positivo. */
export function tasaConSigno(impuesto: Pick<Impuesto, 'tasa' | 'signo'>): string {
    return `${impuesto.signo === -1 ? '−' : ''}${impuesto.tasa} %`
}

/** Cuadrícula con su signo para mostrar (`V_IVA`, `−RET_IVA_REC` en retenciones), o `—`. */
export function cuadriculaConSigno(cuadricula: string | null, signo: Impuesto['signo']): string {
    if (!cuadricula) {
        return '—'
    }
    return signo === -1 ? `−${cuadricula}` : cuadricula
}

const TITULOS_FISCALES: Record<string, string> = {
    parametro_sin_confirmar: 'Falta un valor que debe confirmar el contador',
    parametro_no_editable: 'Este parámetro no se puede editar',
    parametro_fuera_de_rango: 'El valor está fuera de lo permitido',
    vigencia_en_periodo_bloqueado: 'La fecha cae en un mes cerrado',
    vigencia_duplicada: 'Ya hay un valor con esa fecha',
    regimen_fuera_de_plazo: 'El régimen no puede cambiar en esa fecha',
    localizacion_no_instalada: 'La empresa no tiene localización fiscal',
    pais_no_soportado: 'País sin paquete fiscal',
    empresa_con_documentos: 'La empresa ya tiene documentos',
    establecimiento_duplicado: 'Ese código de establecimiento ya existe',
    establecimiento_por_defecto: 'Cambia primero el establecimiento por defecto',
    frase_del_regimen: 'Esa frase sale del régimen',
    frase_inactiva: 'La frase no está activa en esa fecha',
    alcance_global_requerido: 'Hace falta alcance global',
    empresa_requerida: 'Elige una empresa',
    campo_solo_lectura: 'Se cambia en Configuración → Fiscal',
}

/** Clave de parámetro del primer error (`errors[0].field`), para nombrarlo en el mensaje. */
function claveDe(problema: Problem): string | null {
    return problema.errors?.[0]?.field ?? null
}

/**
 * Problema RFC 9457 con título legible para las pantallas fiscales. El `detail` de la API se
 * conserva (trae la fecha, el periodo o el plazo); solo se agrega la indicación de qué hacer.
 */
export function problemaFiscalLegible(problema: Problem): Problem {
    // `codigoProblema` de `utils/cobro.ts`: `urn:argosisp:problema:<codigo>` → `<codigo>`.
    const codigo = codigoProblema(problema)
    const titulo = codigo ? TITULOS_FISCALES[codigo] : undefined
    if (!titulo) {
        return problema
    }
    let detalle = problema.detail
    if (codigo === 'parametro_sin_confirmar') {
        const clave = claveDe(problema)
        detalle = `${clave ? `«${clave}» no tiene valor vigente` : 'Un parámetro no tiene valor vigente'}: el valor no está verificado y el sistema no lo inventa. Pide al contador que lo confirme en Configuración → Fiscal → Parámetros.`
    }
    else if (codigo === 'vigencia_en_periodo_bloqueado') {
        detalle = `${problema.detail ?? ''} Lo ya declarado no cambia: elige una fecha posterior al cierre.`.trim()
    }
    else if (codigo === 'empresa_requerida') {
        detalle = 'La configuración fiscal es de cada empresa: elige una en el selector de empresa.'
    }
    return { ...problema, title: titulo, detail: detalle }
}

/** Errores 422 que se entienden solos junto al campo (sin alerta aparte en el formulario). */
export const MOTIVOS_SOLO_CAMPO: readonly string[] = ['validacion', 'parametro_fuera_de_rango']
