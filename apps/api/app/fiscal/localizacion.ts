import type { DefinicionCuenta } from '#ledger/plan_cuentas'

/**
 * Localización fiscal (`contratos/localizacion-fiscal.md` §2 y §4).
 *
 * Un **paquete** (`l10n/<pais>/`) es código versionado: cuentas, parámetros con su vigencia,
 * régimenes, frases y tipos de DTE. `instalarPaquete` (`#fiscal/instalador`) lo aplica a una empresa insertando solo lo que
 * falta; nunca borra ni cambia una cuenta, un valor o una frase. Otro país = otra carpeta con la
 * misma forma, en `ULTIMO_PAQUETE`. El núcleo la instala por su punto de extensión
 * (`#core/localizacion`), que registra `#fiscal/instalador_localizacion`.
 */

export const TIPOS_PARAMETRO = [
    'porcentaje',
    'monto',
    'entero',
    'fecha',
    'texto',
    'enum',
    'bool',
    'json',
] as const
export type TipoParametro = (typeof TIPOS_PARAMETRO)[number]

/** N = lo fija la ley (no editable); G = global que la empresa puede sobrescribir; E = de la empresa. */
export const ALCANCES_PARAMETRO = ['N', 'G', 'E'] as const
export type AlcanceParametro = (typeof ALCANCES_PARAMETRO)[number]

/** Escala de confianza de la investigación (inv., encabezado); `diseno` = decisión de diseño. */
export const CONFIANZAS = [
    'alta',
    'media-alta',
    'media',
    'baja-media',
    'baja',
    'no_verificado',
    'diseno',
] as const
export type Confianza = (typeof CONFIANZAS)[number]

export type ValorParametro =
    string | number | boolean | ValorParametro[] | { [clave: string]: ValorParametro | null }

export interface ValorPaquete {
    /** YYYY-MM-DD: desde cuándo rige (la fecha de la reforma que cita la fuente o 2013-01-01) */
    vigente_desde: string
    valor: ValorParametro
}

export interface DefinicionParametro {
    clave: string
    tipo: TipoParametro
    alcance: AlcanceParametro
    descripcion: string
    /** cita de la investigación: `inv. A.1 (Ley IVA, art. 10)` */
    fuente: string
    confianza: Confianza
    /** tabla «Confirmar con contador» del contrato (§14) */
    confirmar_contador: boolean
    /** valores admitidos (`enum`) */
    opciones?: readonly string[]
    /** límites (porcentaje, monto, entero), como string decimal */
    minimo?: string
    maximo?: string
    /**
     * Valores del paquete con su vigencia. Vacío = **sin valor**: el cálculo que lo necesite
     * responde 422 `parametro_sin_confirmar` hasta que el contador lo llene (nada se inventa).
     */
    valores: readonly ValorPaquete[]
    /**
     * Solo se cambia con su acción propia, que valida la ley (`regimen` → `fiscal.cambiar_regimen`);
     * `POST /fiscal/parametros/:clave/valores` responde 422.
     */
    accion?: string
    /** Sin valor propio se deriva de otros parámetros (`requiere_auditoria`). */
    derivado?: boolean
    /** `json` con tope por clave: el valor de la empresa no supera el del paquete (depreciación) */
    tope_por_clave?: boolean
}

export interface DefinicionCuentaPaquete extends Omit<DefinicionCuenta, 'tipo'> {
    tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto'
    /** naturaleza contraria a la del tipo (depreciación acumulada, ingresos diferidos) */
    contracuenta?: boolean
    auxiliar_proveedor?: boolean
    categoria_fiscal?: CategoriaFiscal
    libro_inventario?: boolean
    /** flujo de efectivo (método indirecto); si falta, la regla por prefijo del paquete */
    categoria_flujo?: CategoriaFlujo
}

/** Clasificación del flujo de efectivo por cuenta (estudio de Odoo, tabla final #1). */
export const CATEGORIAS_FLUJO = ['efectivo', 'operacion', 'inversion', 'financiamiento'] as const
export type CategoriaFlujo = (typeof CATEGORIAS_FLUJO)[number]

export const CATEGORIAS_FISCALES = [
    // decisión del PM (19 oct): deducible explícito (5.1.03 Premios y promociones)
    'deducible',
    'no_deducible',
    'limite_parientes',
    'limite_exterior',
    'limite_viaticos',
    'donacion_ong',
    'publicidad',
    'depreciacion',
] as const
export type CategoriaFiscal = (typeof CATEGORIAS_FISCALES)[number]

/** Frase que se deriva del régimen vigente (inv. C.2). */
export interface DefinicionFrase {
    /** identidad de la frase dentro de la empresa */
    clave: string
    tipo_frase: number | null
    escenario: number | null
    texto: string
    tipos_dte: readonly string[]
    fuente: string
    confirmar_contador: boolean
}

export interface DefinicionTipoDte {
    codigo: string
    nombre: string
    regimenes: readonly string[]
    fuente: string
}

/**
 * Impuesto como entidad con vigencia (contrato §10.2; estudio de Odoo #6 y #7). Las retenciones son
 * impuestos negativos (`signo = -1`, como en Odoo), con nuestras tasas; la `tasa` va siempre en
 * positivo.
 *
 * - `calculo`: `porcentaje_incluido` (IVA dentro del precio: `cuota = total − total / (1 + tasa)`),
 *   `porcentaje_de_base` (tasa × base sin IVA), `porcentaje_del_impuesto` (tasa × la cuota de
 *   `base_impuesto`: las retenciones de IVA son un porcentaje del IVA) o `porcentaje_del_total`.
 * - `uso`: `venta` (lo cobra o lo sufre la empresa al vender) o `compra` (al comprar o como agente).
 *   Un código por uso: los de compras llevan el sufijo `_C` (`IVA12_C`).
 * - `exigibilidad`: `factura` o `certificacion` (la cuota va a `cuenta_transicion` hasta certificar).
 * - `cuadricula_base` / `cuadricula_cuota`: etiquetas (`CUADRICULAS_GT`) que llevan los movimientos
 *   del libro de la base y de la cuota (`ledger.movimientos.cuadricula`, con signo `+` o `-`).
 */
export const CALCULOS_IMPUESTO = [
    'porcentaje_incluido',
    'porcentaje_del_impuesto',
    'porcentaje_de_base',
    'porcentaje_del_total',
] as const
export type CalculoImpuesto = (typeof CALCULOS_IMPUESTO)[number]
export const USOS_IMPUESTO = ['venta', 'compra'] as const
export type UsoImpuesto = (typeof USOS_IMPUESTO)[number]
export const GRUPOS_IMPUESTO = ['iva', 'retencion_iva', 'retencion_isr', 'pequeno_contribuyente'] as const
export type GrupoImpuesto = (typeof GRUPOS_IMPUESTO)[number]
export const EXIGIBILIDADES = ['factura', 'certificacion'] as const

export interface VersionImpuesto {
    vigente_desde: string
    /** por ciento, string decimal positivo: "12.00" */
    tasa: string
}

export interface DefinicionImpuesto {
    codigo: string
    nombre: string
    grupo: GrupoImpuesto
    uso: UsoImpuesto
    calculo: CalculoImpuesto
    /** +1 impuesto; -1 retención */
    signo: 1 | -1
    /** impuesto sobre cuya cuota se calcula (`porcentaje_del_impuesto`) */
    base_impuesto: string | null
    incluido: boolean
    exigibilidad: (typeof EXIGIBILIDADES)[number]
    /** código de la cuenta de la cuota */
    cuenta_cuota: string
    /** cuenta de transición mientras no es exigible (IVA de avisos sin certificar) */
    cuenta_transicion: string | null
    /** null en las retenciones: su base es la cuota de otro impuesto o el total */
    cuadricula_base: string | null
    cuadricula_cuota: string
    fuente: string
    confianza: Confianza
    confirmar_contador: boolean
    descripcion: string
    versiones: readonly VersionImpuesto[]
}

/** Lo que el paquete necesita saber de la empresa al instalarse por primera vez. */
export interface DatosEmpresaInstalacion {
    regimen_isr: string | null
    codigo_establecimiento: number | null
    nombre_comercial: string
    direccion_fiscal: string | null
    municipio: string | null
    departamento: string | null
}

export interface PaqueteLocalizacion {
    /** `gt-2026.1` */
    codigo: string
    pais: string
    /** semver */
    version: string
    publicada_en: string
    /** códigos de cuenta del paquete, incluido el plan base del que parte */
    cuentas: readonly DefinicionCuentaPaquete[]
    parametros: readonly DefinicionParametro[]
    impuestos: readonly DefinicionImpuesto[]
    /** etiquetas de impuesto que admiten los movimientos del libro (sin signo) */
    cuadriculas: readonly string[]
    regimenes: readonly string[]
    /** frases de cada régimen */
    frases_por_regimen: Readonly<Record<string, readonly DefinicionFrase[]>>
    tipos_dte: readonly DefinicionTipoDte[]
    /** régimen inicial de una empresa existente (de `core.empresas.regimen_isr`); null = el del paquete */
    regimenInicial(datos: DatosEmpresaInstalacion): string | null
}

/** Qué agregó una instalación (se guarda en `fiscal.instalaciones.resumen`). */
export interface ResumenInstalacion {
    empresa_id: number
    codigo: string
    de_codigo: string | null
    /** true si la empresa ya tenía esta versión: no se agregó nada de la empresa */
    ya_instalada: boolean
    cuentas: string[]
    parametros: string[]
    valores: Array<{ clave: string; vigente_desde: string; empresa_id: number | null }>
    /** versiones de impuestos agregadas: `IVA12@2013-01-01` */
    impuestos: string[]
    establecimientos: number[]
    /** id de `fiscal.instalaciones` creada (null si ya estaba instalada) */
    instalacion_id: number | null
}

export interface OpcionesInstalacion {
    /** `core.usuarios.id` de quien instala; null en la migración o el sistema */
    instaladaPor: number | null
    /** fecha (YYYY-MM-DD, Guatemala) de los valores de la empresa (`inicio_libros`, régimen migrado) */
    hoy: string
}
