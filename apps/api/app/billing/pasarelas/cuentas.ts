import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { descifrar, ErrorCifrado } from '#shared/cifrado'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import {
    FirmaInvalida,
    PasarelaNoConfigurada,
    pasarela,
    proveedorConfigurado,
    type ConfigCuenta,
    type Pasarela,
} from '#billing/pasarelas/pasarela'

/**
 * Cuentas de pasarela por empresa y proveedor (D0, `contratos/debito-automatico.md` §2).
 *
 * Resolución (regla 14, nunca un único global implícito):
 * - **Sin ninguna cuenta en la base**: respaldo, todo como antes de D0, con `PASARELA_PROVEEDOR` y
 *   `RECURRENTE_*` del entorno (`cuenta = null`).
 * - **Con cuentas**: solo manda la cuenta activa de la empresa para el uso pedido (la predeterminada
 *   del uso). Una empresa sin cuenta no usa las llaves de otra: 503 `pasarela_no_configurada`.
 *   `pasarela.sembrar_cuenta` pasa el entorno a la cuenta de la empresa principal al arrancar.
 */

export const USOS_PASARELA = ['pago_en_linea', 'debito'] as const
export type UsoPasarela = (typeof USOS_PASARELA)[number]
export const MODOS_PASARELA = ['pruebas', 'produccion'] as const
export type ModoPasarela = (typeof MODOS_PASARELA)[number]

export interface FilaCuentaPasarela {
    id: number
    empresa_id: number
    proveedor: string
    alias: string
    proveedor_cobro_id: number | null
    credenciales_cifradas: string | null
    credenciales_claves: string[]
    webhook_secreto_cifrado: string | null
    clave_publica: string
    opciones: Record<string, unknown>
    modo: ModoPasarela
    usos: UsoPasarela[]
    predeterminada_pago_en_linea: boolean
    predeterminada_debito: boolean
    activa: boolean
    prueba_ok: boolean
    probada_en: Date | null
    prueba_detalle: string | null
    sembrada_desde_entorno: boolean
    version: number
    created_at: Date
    updated_at: Date
}

/** Lo que devuelve la API: nunca credenciales ni el secreto del webhook. */
export interface CuentaPasarelaVista {
    id: number
    empresa_id: number
    proveedor: string
    alias: string
    proveedor_cobro_id: number | null
    modo: ModoPasarela
    usos: UsoPasarela[]
    predeterminada_para: UsoPasarela[]
    activa: boolean
    prueba_ok: boolean
    probada_en: Date | null
    prueba_detalle: string | null
    /** nombres de las credenciales guardadas (nunca los valores) */
    credenciales_configuradas: string[]
    tiene_webhook_secreto: boolean
    opciones: Record<string, unknown>
    clave_publica: string
    webhook_ruta: string
    webhook_url: string | null
    sembrada_desde_entorno: boolean
    version: number
    created_at: Date
    updated_at: Date
}

export function rutaWebhook(proveedor: string, clavePublica: string): string {
    return `/api/v1/pasarela/webhook/${proveedor}/${clavePublica}`
}

export function vistaDeCuenta(f: FilaCuentaPasarela): CuentaPasarelaVista {
    const base = (env.get('PASARELA_URL_PUBLICA') ?? '').replace(/\/$/, '')
    const ruta = rutaWebhook(f.proveedor, f.clave_publica)
    const predeterminada: UsoPasarela[] = []
    if (f.predeterminada_pago_en_linea) predeterminada.push('pago_en_linea')
    if (f.predeterminada_debito) predeterminada.push('debito')
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        proveedor: f.proveedor,
        alias: f.alias,
        proveedor_cobro_id: f.proveedor_cobro_id === null ? null : Number(f.proveedor_cobro_id),
        modo: f.modo,
        usos: f.usos,
        predeterminada_para: predeterminada,
        activa: f.activa,
        prueba_ok: f.prueba_ok,
        probada_en: f.probada_en,
        prueba_detalle: f.prueba_detalle,
        credenciales_configuradas: f.credenciales_claves,
        tiene_webhook_secreto: f.webhook_secreto_cifrado !== null,
        opciones: f.opciones,
        clave_publica: f.clave_publica,
        webhook_ruta: ruta,
        webhook_url: base ? `${base}${ruta}` : null,
        sembrada_desde_entorno: f.sembrada_desde_entorno,
        version: Number(f.version),
        created_at: f.created_at,
        updated_at: f.updated_at,
    }
}

export async function filaCuentaPasarela(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<FilaCuentaPasarela> {
    const q = cliente.from('billing.pasarela_cuentas').where('id', id)
    if (bloquear) q.forUpdate()
    const fila = (await q.first()) as FilaCuentaPasarela | null
    if (!fila) throw new NoEncontrado(`La cuenta de pasarela ${id} no existe`)
    return fila
}

export async function verCuentaPasarela(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<CuentaPasarelaVista> {
    return vistaDeCuenta(await filaCuentaPasarela(id, cliente))
}

export async function listarCuentasPasarela(
    empresas: number[] | null,
    cliente: QueryClientContract = db.connection(),
): Promise<CuentaPasarelaVista[]> {
    const consulta = cliente.from('billing.pasarela_cuentas').orderBy('empresa_id').orderBy('id')
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('empresa_id', ids))
    return ((await consulta) as FilaCuentaPasarela[]).map(vistaDeCuenta)
}

export async function empresaDeCuentaPasarela(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('billing.pasarela_cuentas').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`La cuenta de pasarela ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Configuración descifrada de una cuenta (solo para construir el adaptador; nunca se devuelve). */
export function configDeCuenta(f: FilaCuentaPasarela): ConfigCuenta {
    try {
        return {
            cuentaId: Number(f.id),
            empresaId: Number(f.empresa_id),
            modo: f.modo,
            credenciales: f.credenciales_cifradas
                ? (JSON.parse(descifrar(f.credenciales_cifradas)) as Record<string, string>)
                : {},
            webhookSecreto: f.webhook_secreto_cifrado ? descifrar(f.webhook_secreto_cifrado) : null,
            opciones: f.opciones ?? {},
        }
    } catch (error) {
        if (error instanceof ErrorCifrado) {
            throw new PasarelaNoConfigurada(
                `No se pudieron descifrar las credenciales de la cuenta de pasarela ${f.id}: vuelve a escribirlas`,
            )
        }
        throw error
    }
}

/** De dónde sale la pasarela de una operación: una cuenta, o el entorno (`cuenta = null`). */
export interface FuentePasarela {
    cuenta: FilaCuentaPasarela | null
    proveedor: string
    adaptador: Pasarela
}

async function fuenteDeEntorno(): Promise<FuentePasarela> {
    const proveedor = proveedorConfigurado()
    if (!proveedor) throw new PasarelaNoConfigurada()
    return { cuenta: null, proveedor, adaptador: await pasarela(proveedor) }
}

export async function fuenteDeCuenta(cuenta: FilaCuentaPasarela): Promise<FuentePasarela> {
    return {
        cuenta,
        proveedor: cuenta.proveedor,
        adaptador: await pasarela(cuenta.proveedor, configDeCuenta(cuenta)),
    }
}

/** Hay al menos una cuenta en la base: ya no vale el entorno como respaldo. */
export async function hayCuentasPasarela(cliente: QueryClientContract = db.connection()): Promise<boolean> {
    return (await cliente.from('billing.pasarela_cuentas').select('id').first()) !== null
}

/** La pasarela de la empresa para un uso (la predeterminada). 503 `pasarela_no_configurada` si no hay. */
export async function resolverFuente(
    cliente: QueryClientContract,
    empresaId: number,
    uso: UsoPasarela,
): Promise<FuentePasarela> {
    if (!(await hayCuentasPasarela(cliente))) return fuenteDeEntorno()
    const predeterminada = uso === 'pago_en_linea' ? 'predeterminada_pago_en_linea' : 'predeterminada_debito'
    const cuentas = (await cliente
        .from('billing.pasarela_cuentas')
        .where('empresa_id', empresaId)
        .where('activa', true)
        .whereRaw('? = ANY (usos)', [uso])
        .orderBy(predeterminada, 'desc')
        .orderBy('id', 'asc')) as FilaCuentaPasarela[]
    const cuenta = cuentas[0]
    if (!cuenta) {
        throw new PasarelaNoConfigurada(
            `La empresa ${empresaId} no tiene una cuenta de pasarela activa para ${uso}`,
        )
    }
    return fuenteDeCuenta(cuenta)
}

/** ¿La empresa puede cobrar en línea? (el portal ofrece o no el botón). */
export async function pagoEnLineaDeEmpresa(empresaId: number): Promise<boolean> {
    try {
        await resolverFuente(db.connection(), empresaId, 'pago_en_linea')
        return true
    } catch (error) {
        if (error instanceof PasarelaNoConfigurada) return false
        throw error
    }
}

/**
 * Quién firma un webhook. Con `clave_publica` (`/pasarela/webhook/:proveedor/:clave`): esa cuenta,
 * aunque esté desactivada (un cobro ya hecho todavía puede avisar). Sin ella (ruta anterior): la
 * cuenta sembrada del entorno para ese proveedor o, sin cuentas en la base, el entorno. Lo que no
 * existe da 401 igual que una firma mala: no se revela qué claves existen.
 */
export async function fuenteDeWebhook(
    cliente: QueryClientContract,
    proveedor: string,
    clavePublica: string | null,
): Promise<FuentePasarela> {
    if (clavePublica) {
        const cuenta = (await cliente
            .from('billing.pasarela_cuentas')
            .where({ proveedor, clave_publica: clavePublica })
            .first()) as FilaCuentaPasarela | null
        if (!cuenta) throw new FirmaInvalida(`La pasarela ${proveedor} no está configurada`)
        return fuenteDeCuenta(cuenta)
    }
    if (!(await hayCuentasPasarela(cliente))) {
        if (proveedor !== proveedorConfigurado()) {
            throw new FirmaInvalida(`La pasarela ${proveedor} no está configurada`)
        }
        return fuenteDeEntorno()
    }
    const cuenta = (await cliente
        .from('billing.pasarela_cuentas')
        .where({ proveedor, sembrada_desde_entorno: true })
        .first()) as FilaCuentaPasarela | null
    if (!cuenta) throw new FirmaInvalida(`La pasarela ${proveedor} no está configurada`)
    return fuenteDeCuenta(cuenta)
}

/**
 * Fuentes que recorre la conciliación diaria: todas las cuentas activas o, sin cuentas en la base,
 * el entorno (`null`).
 */
export async function idsCuentasAConciliar(
    cliente: QueryClientContract = db.connection(),
): Promise<Array<number | null>> {
    if (!(await hayCuentasPasarela(cliente))) return proveedorConfigurado() ? [null] : []
    const filas = await cliente
        .from('billing.pasarela_cuentas')
        .where('activa', true)
        .orderBy('id')
        .select('id')
    return filas.map((f) => Number(f.id))
}
