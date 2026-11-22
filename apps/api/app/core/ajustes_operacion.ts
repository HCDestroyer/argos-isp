import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'

/**
 * Ajustes de operación (decisiones del PM 17, 19, 22, 28 y 31, 21 nov 2026). Cada clave tiene su
 * valor de fábrica, sus límites y si admite un valor por empresa (`porEmpresa`). Se guardan en
 * `core.ajustes_operacion` (`empresa_id` null = global) y solo los cambia `ajustes_operacion.editar`.
 *
 * Valor efectivo de una clave para una empresa: el de la empresa (si la clave lo admite y existe),
 * si no el global, si no el de fábrica. Sin caché: se leen en cada uso (pocas filas, índice único).
 */

type Definicion =
    | { tipo: 'booleano'; defecto: boolean; porEmpresa: boolean; descripcion: string }
    | {
          tipo: 'entero'
          defecto: number
          min: number
          max: number
          porEmpresa: boolean
          descripcion: string
      }
    | {
          tipo: 'opcion'
          defecto: string
          opciones: readonly string[]
          porEmpresa: boolean
          descripcion: string
      }

export const AJUSTES_OPERACION = {
    // decisión 17
    'retiro.orden_iris': {
        tipo: 'booleano',
        defecto: true,
        porEmpresa: false,
        descripcion:
            'Al retirar un servicio, pedir a Iris la orden de retiro y dejar sus equipos en comodato «por recuperar»',
    },
    // decisión 19
    'codigo_corte.vigencia_min': {
        tipo: 'entero',
        defecto: 15,
        min: 5,
        max: 60,
        porEmpresa: true,
        descripcion: 'Minutos que vale el código para identificarse en el portal que da el personal',
    },
    // decisión 22
    'auth.recuperar_contrasena': {
        tipo: 'booleano',
        defecto: true,
        porEmpresa: false,
        descripcion: 'Permitir recuperar la contraseña del panel por correo (enlace de un solo uso)',
    },
    // decisión 28
    'ip_historial.retencion_dias': {
        tipo: 'entero',
        defecto: 730,
        min: 30,
        max: 3650,
        porEmpresa: false,
        descripcion: 'Días hacia atrás en que se puede buscar quién tenía una IP',
    },
    // decisión 31: caídas repetidas de un servicio (contrato Iris 0.13.0: Iris decide el ticket)
    'caidas.activo': {
        tipo: 'booleano',
        defecto: true,
        porEmpresa: true,
        descripcion: 'Avisar cuando un servicio se cae varias veces en poco tiempo',
    },
    'caidas.umbral': {
        tipo: 'entero',
        defecto: 3,
        min: 2,
        max: 50,
        porEmpresa: true,
        descripcion: 'Caídas dentro de la ventana que disparan el aviso',
    },
    'caidas.ventana_min': {
        tipo: 'entero',
        defecto: 60,
        min: 5,
        max: 1440,
        porEmpresa: true,
        descripcion: 'Ventana en minutos para contar las caídas',
    },
    // decisión 31: falla general (un router, OLT, PON o zona es de varias empresas: solo global)
    'falla_general.activo': {
        tipo: 'booleano',
        defecto: true,
        porEmpresa: false,
        descripcion:
            'Detectar fallas generales (muchos servicios del mismo router, OLT, PON o zona a la vez)',
    },
    'falla_general.modo': {
        tipo: 'opcion',
        defecto: 'porcentaje',
        opciones: ['porcentaje', 'cantidad'],
        porEmpresa: false,
        descripcion:
            'Si el umbral de la falla general es un porcentaje de los servicios del alcance o una cantidad',
    },
    'falla_general.umbral': {
        tipo: 'entero',
        defecto: 30,
        min: 1,
        max: 10000,
        porEmpresa: false,
        descripcion: 'Porcentaje (1 a 100) o cantidad de servicios caídos que abren el incidente',
    },
    'falla_general.minimo_servicios': {
        tipo: 'entero',
        defecto: 5,
        min: 2,
        max: 10000,
        porEmpresa: false,
        descripcion: 'Servicios caídos mínimos para abrir un incidente (también en modo porcentaje)',
    },
    'falla_general.ventana_min': {
        tipo: 'entero',
        defecto: 5,
        min: 1,
        max: 60,
        porEmpresa: false,
        descripcion: 'Ventana en minutos en que deben caer los servicios',
    },
} as const satisfies Record<string, Definicion>

export type ClaveAjuste = keyof typeof AJUSTES_OPERACION
export const CLAVES_AJUSTE = Object.keys(AJUSTES_OPERACION) as ClaveAjuste[]
export type ValorAjuste = boolean | number | string
export type MapaAjustes = Record<ClaveAjuste, ValorAjuste>

export function valoresDeFabrica(): MapaAjustes {
    return Object.fromEntries(CLAVES_AJUSTE.map((c) => [c, AJUSTES_OPERACION[c].defecto])) as MapaAjustes
}

/** 422 si la clave no existe o no admite un valor por empresa. */
export function exigirClaveAjuste(clave: string, conEmpresa: boolean): Definicion {
    const falla = (message: string, rule: string): never => {
        throw new ValidacionFallida([{ field: `valores.${clave}`, message, rule }], message)
    }
    if (!(clave in AJUSTES_OPERACION)) falla(`El ajuste ${clave} no existe`, 'clave')
    const def = AJUSTES_OPERACION[clave as ClaveAjuste] as Definicion
    if (conEmpresa && !def.porEmpresa) falla(`El ajuste ${clave} solo es global`, 'global')
    return def
}

/** 422 si el valor no cumple la definición de la clave (o la clave no admite empresa). */
export function validarAjuste(clave: string, valor: unknown, conEmpresa: boolean): ValorAjuste {
    const campo = `valores.${clave}`
    const falla = (message: string, rule: string): never => {
        const error: ErrorCampo = { field: campo, message, rule }
        throw new ValidacionFallida([error], message)
    }
    const def = exigirClaveAjuste(clave, conEmpresa)
    if (def.tipo === 'booleano') {
        if (typeof valor !== 'boolean') falla('Debe ser verdadero o falso', 'boolean')
        return valor as boolean
    }
    if (def.tipo === 'entero') {
        if (typeof valor !== 'number' || !Number.isInteger(valor)) {
            falla('Debe ser un número entero', 'number')
        }
        const n = valor as number
        if (n < def.min || n > def.max) falla(`Debe estar entre ${def.min} y ${def.max}`, 'range')
        return n
    }
    if (typeof valor !== 'string' || !def.opciones.includes(valor)) {
        falla(`Debe ser uno de: ${def.opciones.join(', ')}`, 'enum')
    }
    return valor as string
}

interface FilaAjuste {
    clave: string
    valor: unknown
    empresa_id: number | string | null
}

async function filas(cliente: QueryClientContract, empresaId: number | null): Promise<FilaAjuste[]> {
    return (await cliente
        .from('core.ajustes_operacion')
        .where((q) => {
            q.whereNull('empresa_id')
            if (empresaId !== null) q.orWhere('empresa_id', empresaId)
        })
        .select('clave', 'valor', 'empresa_id')) as FilaAjuste[]
}

export interface AjustesOperacionVista {
    empresa_id: number | null
    /** valor efectivo de cada clave para la empresa (o global con `empresa_id` null) */
    efectivo: MapaAjustes
    /** valores guardados en global (sin los de fábrica) */
    global: Partial<MapaAjustes>
    /** valores guardados para la empresa (solo claves `porEmpresa`) */
    empresa: Partial<MapaAjustes>
    fabrica: MapaAjustes
    definiciones: Array<{
        clave: ClaveAjuste
        tipo: Definicion['tipo']
        por_empresa: boolean
        descripcion: string
        min: number | null
        max: number | null
        opciones: string[] | null
    }>
}

export async function verAjustesOperacion(
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<AjustesOperacionVista> {
    const fabrica = valoresDeFabrica()
    const global: Partial<MapaAjustes> = {}
    const empresa: Partial<MapaAjustes> = {}
    for (const f of await filas(cliente, empresaId)) {
        if (!(f.clave in AJUSTES_OPERACION)) continue
        const clave = f.clave as ClaveAjuste
        if (f.empresa_id === null) global[clave] = f.valor as ValorAjuste
        else if (AJUSTES_OPERACION[clave].porEmpresa) empresa[clave] = f.valor as ValorAjuste
    }
    const efectivo = { ...fabrica, ...global, ...empresa }
    return {
        empresa_id: empresaId,
        efectivo,
        global,
        empresa,
        fabrica,
        definiciones: CLAVES_AJUSTE.map((clave) => {
            const def = AJUSTES_OPERACION[clave] as Definicion
            return {
                clave,
                tipo: def.tipo,
                por_empresa: def.porEmpresa,
                descripcion: def.descripcion,
                min: def.tipo === 'entero' ? def.min : null,
                max: def.tipo === 'entero' ? def.max : null,
                opciones: def.tipo === 'opcion' ? [...def.opciones] : null,
            }
        }),
    }
}

export async function ajusteBooleano(
    clave: ClaveAjuste,
    empresaId: number | null = null,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    const vista = await verAjustesOperacion(empresaId, cliente)
    return Boolean(vista.efectivo[clave])
}

export async function ajusteEntero(
    clave: ClaveAjuste,
    empresaId: number | null = null,
    cliente: QueryClientContract = db.connection(),
): Promise<number> {
    const vista = await verAjustesOperacion(empresaId, cliente)
    return Number(vista.efectivo[clave])
}
