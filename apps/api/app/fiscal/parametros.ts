import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ErrorCampo } from '#shared/errores'
import { NoEncontrado } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { LocalizacionNoInstalada, ParametroFueraDeRango, ParametroSinConfirmar } from '#fiscal/errores'
import { instalacionVigente } from '#fiscal/instalador'
import { cacheParametros } from '#fiscal/cache_parametros'
import type { AlcanceParametro, Confianza, TipoParametro } from '#fiscal/localizacion'

/**
 * Lectura de parámetros fiscales con vigencia (contrato §3.2 y §4).
 *
 * `fiscal.parametros_valores` es **solo de inserción**: editar = insertar una fila con
 * `vigente_desde`. Leer `parametro(empresaId, clave, fecha)` = en cada nivel, la fila más reciente
 * con `vigente_desde <= fecha`; gana el primer nivel que tenga una:
 *
 *  1. **empresa**: `empresa_id = empresaId`, `origen = usuario` (lo que puso la empresa);
 *  2. **instalacion**: `empresa_id = empresaId`, `origen = instalacion` (lo que dejó el instalador:
 *     `inicio_libros`, el régimen de `core.empresas.regimen_isr`); un valor del usuario lo reemplaza
 *     aunque tenga una fecha anterior (p. ej. la primera configuración del régimen);
 *  3. **global**: `empresa_id IS NULL`, `origen = usuario` (el administrador de la instalación);
 *  4. **paquete**: `empresa_id IS NULL`, `origen = paquete` (lo que trae la versión instalada).
 *
 * El contrato habla de «empresa → global → paquete»: `instalacion` es la parte de la empresa que
 * no eligió nadie, por debajo de lo que sí eligió.
 *
 * Así un valor nuevo nunca cambia el pasado: una declaración de 2014 se recalcula con lo vigente
 * en 2014. Sin valor en ningún nivel: 422 `parametro_sin_confirmar` (`errors[0].field` = clave).
 *
 * Caché en memoria del proceso por empresa (`cache_parametros.ts`), invalidada por el evento
 * `fiscal.parametros_cambiados` (regla 5, sin TTL). Dentro de una transacción se lee la base.
 */

export type NivelParametro = 'empresa' | 'instalacion' | 'global' | 'paquete' | 'derivado'
export type OrigenValor = 'paquete' | 'instalacion' | 'usuario'

export interface DefinicionCatalogo {
    pais: string
    clave: string
    tipo: TipoParametro
    alcance: AlcanceParametro
    descripcion: string
    fuente: string
    confianza: Confianza
    confirmar_contador: boolean
    opciones: string[] | null
    minimo: string | null
    maximo: string | null
    accion: string | null
    derivado: boolean
    tope_por_clave: boolean
}

export interface FilaValor {
    id: number
    pais: string
    empresa_id: number | null
    clave: string
    valor: unknown
    vigente_desde: string
    origen: OrigenValor
    motivo: string | null
    creado_por: number | null
    created_at: string
}

export interface ValorVigente {
    clave: string
    valor: unknown
    vigente_desde: string | null
    nivel: NivelParametro
    origen: OrigenValor | 'derivado'
    /** id de `fiscal.parametros_valores` (null si es derivado) */
    valor_id: number | null
}

/** Catálogo de un país, por clave. */
export async function catalogo(
    pais: string,
    cliente: QueryClientContract = db.connection(),
): Promise<Map<string, DefinicionCatalogo>> {
    const filas = (await cliente
        .from('fiscal.parametros')
        .where('pais', pais)
        .orderBy('clave', 'asc')
        .select(
            'pais',
            'clave',
            'tipo',
            'alcance',
            'descripcion',
            'fuente',
            'confianza',
            'confirmar_contador',
            'opciones',
            db.raw('minimo::text as minimo'),
            db.raw('maximo::text as maximo'),
            'accion',
            'derivado',
            'tope_por_clave',
        )) as DefinicionCatalogo[]
    return new Map(filas.map((f) => [f.clave, f]))
}

/** Definición de una clave; 404 si el país no la tiene. */
export async function definicion(
    pais: string,
    clave: string,
    cliente: QueryClientContract = db.connection(),
): Promise<DefinicionCatalogo> {
    const leido112 = await catalogo(pais, cliente)
    const def = leido112.get(clave)
    if (!def) throw new NoEncontrado(`El parámetro fiscal ${clave} no existe para ${pais}`)
    return def
}

/** Filas de valores de la empresa y globales del país, ordenadas por vigencia. */
export async function filasValores(
    pais: string,
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
    clave?: string,
): Promise<FilaValor[]> {
    const filas = (await cliente
        .from('fiscal.parametros_valores')
        .where('pais', pais)
        .where((q) => {
            q.whereNull('empresa_id')
            if (empresaId !== null) q.orWhere('empresa_id', empresaId)
        })
        .if(clave, (q) => q.where('clave', clave!))
        .orderBy([
            { column: 'clave', order: 'asc' },
            { column: 'vigente_desde', order: 'asc' },
            { column: 'id', order: 'asc' },
        ])
        .select(
            'id',
            'pais',
            'empresa_id',
            'clave',
            'valor',
            db.raw(`to_char(vigente_desde, 'YYYY-MM-DD') as vigente_desde`),
            'origen',
            'motivo',
            'creado_por',
            'created_at',
        )) as Array<FilaValor & { created_at: Date | string }>
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: f.empresa_id === null ? null : Number(f.empresa_id),
        creado_por: f.creado_por === null ? null : Number(f.creado_por),
        created_at: new Date(f.created_at).toISOString(),
    }))
}

function nivelDe(fila: FilaValor): Exclude<NivelParametro, 'derivado'> {
    if (fila.empresa_id !== null) return fila.origen === 'instalacion' ? 'instalacion' : 'empresa'
    return fila.origen === 'paquete' ? 'paquete' : 'global'
}

/** Valor vigente de `clave` en `fecha` entre `filas` (de una empresa y globales), o null. */
export function resolver(filas: FilaValor[], clave: string, fecha: string): ValorVigente | null {
    const porNivel = new Map<string, FilaValor>()
    for (const fila of filas) {
        if (fila.clave !== clave || fila.vigente_desde > fecha) continue
        const nivel = nivelDe(fila)
        const previa = porNivel.get(nivel)
        // filas ya ordenadas por vigente_desde e id: la última que pasa el filtro gana
        if (!previa || previa.vigente_desde <= fila.vigente_desde) porNivel.set(nivel, fila)
    }
    for (const nivel of ['empresa', 'instalacion', 'global', 'paquete'] as const) {
        const fila = porNivel.get(nivel)
        if (fila) {
            return {
                clave,
                valor: fila.valor,
                vigente_desde: fila.vigente_desde,
                nivel,
                origen: fila.origen,
                valor_id: fila.id,
            }
        }
    }
    return null
}

/** Derivaciones de los parámetros sin valor propio (`derivado = true`). */
const DERIVACIONES: Record<string, (filas: FilaValor[], fecha: string) => unknown> = {
    // inv. A.2 (LAT, art. 40): auditados si es agente de retención de IVA o contribuyente especial
    requiere_auditoria: (filas, fecha) =>
        resolver(filas, 'agente_retencion_iva', fecha)?.valor === true ||
        resolver(filas, 'contribuyente_especial', fecha)?.valor === true,
}

function resolverConDerivados(
    filas: FilaValor[],
    def: Pick<DefinicionCatalogo, 'clave' | 'derivado'>,
    fecha: string,
): ValorVigente | null {
    const propio = resolver(filas, def.clave, fecha)
    if (propio || !def.derivado) return propio
    const derivar = DERIVACIONES[def.clave]
    if (!derivar) return null
    return {
        clave: def.clave,
        valor: derivar(filas, fecha),
        vigente_desde: null,
        nivel: 'derivado',
        origen: 'derivado',
        valor_id: null,
    }
}

/** Versión de un impuesto (`fiscal.impuestos_versiones`) con su grupo y uso. */
export interface FilaImpuesto {
    id: number
    pais: string
    codigo: string
    grupo: string
    uso: string
    empresa_id: number | null
    vigente_desde: string
    origen: 'paquete' | 'usuario'
    nombre: string
    calculo: string
    base_impuesto: string | null
    tasa: string
    incluido: boolean
    exigibilidad: 'factura' | 'pago'
    cuenta_cuota: string
    cuenta_transicion: string | null
    cuadricula_base: string
    cuadricula_cuota: string
    descripcion: string
    fuente: string
    confianza: string
    confirmar_contador: boolean
    activo: boolean
    motivo: string | null
    creado_por: number | null
    created_at: string
}

/** Versiones de impuestos de la empresa y globales del país, ordenadas por vigencia. */
export async function filasImpuestos(
    pais: string,
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaImpuesto[]> {
    const filas = (await cliente
        .from('fiscal.impuestos_versiones as v')
        .join('fiscal.impuestos as i', (j) => j.on('i.pais', 'v.pais').andOn('i.codigo', 'v.codigo'))
        .where('v.pais', pais)
        .where((q) => {
            q.whereNull('v.empresa_id')
            if (empresaId !== null) q.orWhere('v.empresa_id', empresaId)
        })
        .orderBy([
            { column: 'v.codigo', order: 'asc' },
            { column: 'v.vigente_desde', order: 'asc' },
            { column: 'v.id', order: 'asc' },
        ])
        .select(
            'v.id',
            'v.pais',
            'v.codigo',
            'i.grupo',
            'i.uso',
            'v.empresa_id',
            db.raw(`to_char(v.vigente_desde, 'YYYY-MM-DD') as vigente_desde`),
            'v.origen',
            'v.nombre',
            'v.calculo',
            'v.base_impuesto',
            db.raw('v.tasa::text as tasa'),
            'v.incluido',
            'v.exigibilidad',
            'v.cuenta_cuota',
            'v.cuenta_transicion',
            'v.cuadricula_base',
            'v.cuadricula_cuota',
            'v.descripcion',
            'v.fuente',
            'v.confianza',
            'v.confirmar_contador',
            'v.activo',
            'v.motivo',
            'v.creado_por',
            'v.created_at',
        )) as Array<FilaImpuesto & { created_at: Date | string }>
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: f.empresa_id === null ? null : Number(f.empresa_id),
        tasa: formatearTasa(f.tasa),
        creado_por: f.creado_por === null ? null : Number(f.creado_por),
        created_at: new Date(f.created_at).toISOString(),
    }))
}

/** Tasa `numeric(9,6)` → string con al menos 2 decimales y sin ceros de más: "12.00", "33.33", "-1.50". */
export function formatearTasa(valor: string): string {
    const [entera, decimales = ''] = dec(valor).toFixed(6).split('.')
    return `${entera}.${decimales.replace(/0+$/, '').padEnd(2, '0')}`
}

export interface DatosFiscales {
    pais: string
    filas: FilaValor[]
    impuestos: FilaImpuesto[]
}

/**
 * País (de la localización vigente), valores e impuestos de la empresa. 422
 * `localizacion_no_instalada` si la empresa no tiene una. `empresaId = null`: solo lo global de
 * `pais`. Sin `cliente`, de la caché; con `cliente` (una transacción), de la base.
 */
export async function datosFiscales(
    empresaId: number | null,
    cliente: QueryClientContract | undefined,
    pais = 'GT',
): Promise<DatosFiscales> {
    const cargar = async (c: QueryClientContract): Promise<DatosFiscales> => {
        let paisEmpresa = pais
        if (empresaId !== null) {
            const instalacion = await instalacionVigente(c, empresaId)
            if (!instalacion) throw new LocalizacionNoInstalada(empresaId)
            paisEmpresa = instalacion.pais
        }
        return {
            pais: paisEmpresa,
            filas: await filasValores(paisEmpresa, empresaId, c),
            impuestos: await filasImpuestos(paisEmpresa, empresaId, c),
        }
    }
    if (cliente) return cargar(cliente)
    return cacheParametros.obtener(empresaId === null ? `global:${pais}` : String(empresaId), () =>
        cargar(db.connection()),
    )
}

/**
 * Valor de `clave` vigente en `fecha` (YYYY-MM-DD) para la empresa. 422
 * `parametro_sin_confirmar` si no tiene valor en ningún nivel (nada se inventa). Con `cliente`
 * (una transacción) lee la base sin caché.
 */
export async function parametro(
    empresaId: number,
    clave: string,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<ValorVigente> {
    const datos = await datosFiscales(empresaId, cliente)
    const def = await definicion(datos.pais, clave, cliente)
    const valor = resolverConDerivados(datos.filas, def, fecha)
    if (!valor) throw new ParametroSinConfirmar(clave, fecha)
    return valor
}

/** Igual que `parametro`, pero devuelve solo el valor. */
export async function valorParametro<T = unknown>(
    empresaId: number,
    clave: string,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<T> {
    const leido369 = await parametro(empresaId, clave, fecha, cliente)
    return leido369.valor as T
}

export interface ParametroVista extends Omit<DefinicionCatalogo, 'pais'> {
    pais: string
    /** null = sin valor vigente en la fecha */
    valor: unknown
    vigente_desde: string | null
    nivel: NivelParametro | null
    origen: OrigenValor | 'derivado' | null
    /** marcado contador y el valor vigente es el provisional del paquete (o no hay) */
    pendiente_confirmar: boolean
    editable: boolean
}

function vista(def: DefinicionCatalogo, valor: ValorVigente | null): ParametroVista {
    return {
        ...def,
        opciones: def.opciones ?? null,
        valor: valor?.valor ?? null,
        vigente_desde: valor?.vigente_desde ?? null,
        nivel: valor?.nivel ?? null,
        origen: valor?.origen ?? null,
        pendiente_confirmar:
            def.confirmar_contador &&
            (valor === null || valor.nivel === 'paquete' || valor.nivel === 'derivado'),
        editable: def.alcance !== 'N' && def.accion === null,
    }
}

/** Todos los parámetros del país con su valor vigente en `fecha` para la empresa. */
export async function parametrosVigentes(
    empresaId: number,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<ParametroVista[]> {
    const datos = await datosFiscales(empresaId, cliente)
    const defs = await catalogo(datos.pais, cliente)
    return [...defs.values()].map((def) => vista(def, resolverConDerivados(datos.filas, def, fecha)))
}

export interface HistorialParametro {
    parametro: ParametroVista
    valores: Array<FilaValor & { nivel: Exclude<NivelParametro, 'derivado'> }>
}

/** Definición, valor vigente hoy y todas las filas (empresa y globales) de una clave. */
export async function historialParametro(
    empresaId: number,
    clave: string,
    fecha: string,
): Promise<HistorialParametro> {
    const datos = await datosFiscales(empresaId, db.connection())
    const def = await definicion(datos.pais, clave)
    const filas = datos.filas.filter((f) => f.clave === clave)
    return {
        parametro: vista(def, resolverConDerivados(datos.filas, def, fecha)),
        valores: filas.map((f) => ({ ...f, nivel: nivelDe(f) })),
    }
}

/*
|--------------------------------------------------------------------------
| Validación de un valor nuevo según su definición
|--------------------------------------------------------------------------
*/

const PORCENTAJE = /^\d{1,3}(\.\d{1,6})?$/
const MONTO = /^\d{1,12}\.\d{2}$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DECIMAL = /^-?\d+(\.\d+)?$/

function tipoJson(valor: unknown): string {
    if (valor === null) return 'null'
    if (Array.isArray(valor)) return 'array'
    if (typeof valor === 'string' && DECIMAL.test(valor)) return 'decimal'
    return typeof valor
}

/** Errores de forma de `valor` frente a `modelo` (el valor del paquete). */
function mismaForma(valor: unknown, modelo: unknown, ruta: string, errores: ErrorCampo[]) {
    const esperado = tipoJson(modelo)
    const recibido = tipoJson(valor)
    // null en el modelo admite null o el tipo que traiga el resto de la estructura
    if (esperado === 'null') return
    if (esperado === 'string' && recibido === 'decimal') return
    if (esperado !== recibido) {
        errores.push({ field: ruta, message: `Se esperaba ${esperado} y llegó ${recibido}`, rule: 'forma' })
        return
    }
    if (esperado === 'array') {
        const elementos = valor as unknown[]
        const plantilla = (modelo as unknown[])[0]
        if (elementos.length === 0) {
            errores.push({ field: ruta, message: 'La lista no puede estar vacía', rule: 'forma' })
        }
        if (plantilla !== undefined) {
            elementos.forEach((e, i) => mismaForma(e, plantilla, `${ruta}.${i}`, errores))
        }
        return
    }
    if (esperado === 'object') {
        const a = valor as Record<string, unknown>
        const m = modelo as Record<string, unknown>
        for (const clave of Object.keys(m)) {
            if (!(clave in a)) errores.push({ field: `${ruta}.${clave}`, message: 'Falta', rule: 'required' })
            else mismaForma(a[clave], m[clave], `${ruta}.${clave}`, errores)
        }
        for (const clave of Object.keys(a)) {
            if (!(clave in m)) {
                errores.push({ field: `${ruta}.${clave}`, message: 'No existe', rule: 'no_aplica' })
            }
        }
    }
}

function enRango(valor: string, def: DefinicionCatalogo, campo: string, errores: ErrorCampo[]) {
    const numero = dec(valor)
    if (def.minimo !== null && numero.lt(dec(def.minimo))) {
        errores.push({ field: campo, message: `Mínimo ${def.minimo}`, rule: 'minimo' })
    }
    if (def.maximo !== null && numero.gt(dec(def.maximo))) {
        errores.push({ field: campo, message: `Máximo ${def.maximo}`, rule: 'maximo' })
    }
}

/**
 * Valida `valor` para `def` y lo devuelve normalizado. `modelo` es el valor del paquete (forma de
 * los `json` y tope por clave). 422 `parametro_fuera_de_rango` con `errors[]` por campo.
 */
export function validarValor(def: DefinicionCatalogo, valor: unknown, modelo: unknown): unknown {
    const errores: ErrorCampo[] = []
    const campo = 'valor'
    switch (def.tipo) {
        case 'porcentaje':
        case 'monto': {
            const patron = def.tipo === 'monto' ? MONTO : PORCENTAJE
            if (typeof valor !== 'string' || !patron.test(valor)) {
                errores.push({
                    field: campo,
                    message:
                        def.tipo === 'monto'
                            ? 'Monto como string con 2 decimales ("2500.00")'
                            : 'Porcentaje como string decimal ("12.00")',
                    rule: def.tipo,
                })
                break
            }
            if (def.tipo === 'porcentaje' && dec(valor).gt(100)) {
                errores.push({ field: campo, message: 'Un porcentaje no pasa de 100', rule: 'maximo' })
            }
            enRango(valor, def, campo, errores)
            break
        }
        case 'entero':
            if (typeof valor !== 'number' || !Number.isInteger(valor)) {
                errores.push({ field: campo, message: 'Número entero', rule: 'entero' })
                break
            }
            enRango(String(valor), def, campo, errores)
            break
        case 'fecha':
            if (typeof valor !== 'string' || !FECHA.test(valor)) {
                errores.push({ field: campo, message: 'Fecha YYYY-MM-DD', rule: 'fecha' })
            }
            break
        case 'texto':
            if (typeof valor !== 'string' || valor.trim().length === 0) {
                errores.push({ field: campo, message: 'Texto no vacío', rule: 'texto' })
            }
            break
        case 'enum':
            if (typeof valor !== 'string' || !(def.opciones ?? []).includes(valor)) {
                errores.push({
                    field: campo,
                    message: `Una de: ${(def.opciones ?? []).join(', ')}`,
                    rule: 'enum',
                })
            }
            break
        case 'bool':
            if (typeof valor !== 'boolean') {
                errores.push({ field: campo, message: 'true o false', rule: 'bool' })
            }
            break
        case 'json':
            if (valor === null || typeof valor !== 'object') {
                errores.push({ field: campo, message: 'Objeto o lista JSON', rule: 'json' })
                break
            }
            if (modelo !== undefined && modelo !== null) mismaForma(valor, modelo, campo, errores)
            if (errores.length === 0 && def.tope_por_clave && modelo && typeof modelo === 'object') {
                for (const [clave, tope] of Object.entries(modelo as Record<string, string>)) {
                    const propio = (valor as Record<string, string>)[clave]!
                    if (dec(propio).lt(0)) {
                        errores.push({
                            field: `${campo}.${clave}`,
                            message: 'No puede ser negativo',
                            rule: 'minimo',
                        })
                    } else if (dec(propio).gt(dec(tope))) {
                        errores.push({
                            field: `${campo}.${clave}`,
                            message: `El máximo legal es ${tope}`,
                            rule: 'maximo',
                        })
                    }
                }
            }
            break
    }
    if (errores.length > 0) throw new ParametroFueraDeRango(errores)
    return typeof valor === 'string' ? valor.trim() : valor
}
