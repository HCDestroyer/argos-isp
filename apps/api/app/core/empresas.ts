import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'
import { EmpresaRequerida, exigirAccesoEmpresa } from '#shared/empresa_activa'
import { normalizarNitCui } from '#core/nit_cui'
import { PREFIJO_API } from '#shared/rutas'

/**
 * Empresas (NIT) de la instalación (`contratos/multiempresa.md`). La empresa 1 es la principal: la
 * migración la creó con los datos de la antigua `core.empresa`. Con `version = 0` nunca se guardó y
 * las lecturas públicas (`#portal/empresa`) devuelven los valores por defecto del entorno.
 */

export const EMPRESA_PRINCIPAL = 1

export const REGIMENES_ISR = [
    'sujeto_pagos_trimestrales',
    'retencion_definitiva',
    'pequeno_contribuyente',
] as const
export type RegimenIsr = (typeof REGIMENES_ISR)[number]

/** Campos de datos editables (sin logo, que va por su propia acción). */
export const CAMPOS_DATOS_EMPRESA = [
    'nit',
    'razon_social',
    'nombre_comercial',
    'direccion_fiscal',
    'municipio',
    'departamento',
    'telefono',
    'telefono_alterno',
    'whatsapp',
    'correo',
    'sitio_web',
    'horario',
    'instrucciones_pago',
    'color_marca',
    'regimen_isr',
    'codigo_establecimiento',
] as const
export type CampoDatoEmpresa = (typeof CAMPOS_DATOS_EMPRESA)[number]

export interface DatosEmpresaCompleta {
    nit: string | null
    razon_social: string | null
    nombre_comercial: string
    direccion_fiscal: string | null
    municipio: string | null
    departamento: string | null
    telefono: string | null
    telefono_alterno: string | null
    whatsapp: string | null
    correo: string | null
    sitio_web: string | null
    horario: string | null
    instrucciones_pago: string | null
    color_marca: string | null
    regimen_isr: RegimenIsr | null
    codigo_establecimiento: number | null
}

export interface EmpresaCompleta extends DatosEmpresaCompleta {
    id: number
    /** `/api/v1/empresas/:id/logo?v=<etag>`; null sin logo */
    logo_url: string | null
    logo_tipo: 'image/png' | 'image/svg+xml' | null
    activa: boolean
    principal: boolean
    version: number
    created_at: string
    updated_at: string
}

/** Fila interna (con la ruta del logo en el almacenamiento). */
export interface FilaEmpresa extends Omit<EmpresaCompleta, 'logo_url' | 'principal'> {
    logo: string | null
    logo_etag: string | null
}

const COLUMNAS = [
    'id',
    ...CAMPOS_DATOS_EMPRESA,
    'logo',
    'logo_tipo',
    'logo_etag',
    'activa',
    'version',
    'created_at',
    'updated_at',
]

/** URL pública del logo; lleva el ETag para que un logo nuevo no quede en la caché del navegador. */
export function urlLogoEmpresa(id: number, etag: string | null): string | null {
    return etag ? `${PREFIJO_API}/empresas/${id}/logo?v=${etag.slice(0, 16)}` : null
}

function aVista(fila: FilaEmpresa): EmpresaCompleta {
    const { logo, logo_etag: etag, ...resto } = fila
    void logo
    return {
        ...resto,
        id: Number(fila.id),
        version: Number(fila.version),
        codigo_establecimiento:
            fila.codigo_establecimiento === null ? null : Number(fila.codigo_establecimiento),
        logo_url: urlLogoEmpresa(Number(fila.id), etag),
        principal: Number(fila.id) === EMPRESA_PRINCIPAL,
    }
}

export async function filaEmpresa(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<FilaEmpresa> {
    const consulta = cliente.from('core.empresas').where('id', id).select(COLUMNAS)
    if (bloquear) consulta.forUpdate()
    const fila = (await consulta.first()) as FilaEmpresa | null
    if (!fila) throw new NoEncontrado(`La empresa ${id} no existe`)
    return fila
}

export async function verEmpresaCompleta(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EmpresaCompleta> {
    return aVista(await filaEmpresa(id, cliente))
}

/**
 * Empresas, la principal primero. `ids` = solo esas (alcance del usuario); `null` = todas.
 * `soloActivas` deja fuera las desactivadas.
 */
export async function listarEmpresas(
    opciones: { ids?: number[] | null; soloActivas?: boolean } = {},
    cliente: QueryClientContract = db.connection(),
): Promise<EmpresaCompleta[]> {
    const consulta = cliente.from('core.empresas').select(COLUMNAS).orderBy('id', 'asc')
    if (opciones.ids) consulta.whereIn('id', opciones.ids)
    if (opciones.soloActivas) consulta.where('activa', true)
    return ((await consulta) as FilaEmpresa[]).map(aVista)
}

/** Ids de las empresas activas, en orden. */
export async function idsEmpresasActivas(cliente: QueryClientContract = db.connection()): Promise<number[]> {
    const filas = (await cliente
        .from('core.empresas')
        .where('activa', true)
        .orderBy('id', 'asc')
        .select('id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

/** La única empresa activa de la instalación, o null si hay varias (o ninguna). */
export async function unicaEmpresaActiva(
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const ids = await idsEmpresasActivas(cliente)
    return ids.length === 1 ? ids[0]! : null
}

/** 422 en `campo` si la empresa no existe o está desactivada. */
export async function exigirEmpresaActiva(
    cliente: QueryClientContract,
    id: number,
    campo = 'empresa_id',
): Promise<void> {
    const fila = (await cliente.from('core.empresas').where('id', id).select('activa').first()) as {
        activa: boolean
    } | null
    if (!fila) {
        throw new ValidacionFallida([{ field: campo, message: 'La empresa no existe', rule: 'exists' }])
    }
    if (!fila.activa) {
        throw new ValidacionFallida([
            { field: campo, message: 'La empresa está desactivada', rule: 'activa' },
        ])
    }
}

/** NIT de una empresa: normalizado (sin guion, mayúsculas); `CF` no es un NIT de emisor. */
export function normalizarNitEmpresa(valor: string | null | undefined): string | null {
    const nit = normalizarNitCui(valor, 'nit')
    if (nit === 'CF') {
        throw new ValidacionFallida([
            { field: 'nit', message: 'Una empresa necesita un NIT; CF no aplica', rule: 'nit' },
        ])
    }
    return nit
}

/** Empresa del servicio (`core.servicios.empresa_id`); 404 si el servicio no existe. */
export async function empresaDeServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number> {
    const fila = (await cliente
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id')
        .first()) as {
        empresa_id: number
    } | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    return Number(fila.empresa_id)
}

/**
 * Empresa activa para crear algo que no depende de un servicio: la del contexto
 * (`X-Empresa-Id` o la única del usuario) o, sin ella (crons, consola, pruebas), la única empresa
 * activa de la instalación. 422 `empresa_requerida` si hay varias y no se eligió; 403
 * `empresa_no_permitida` si el actor no tiene acceso.
 */
export async function resolverEmpresaActiva(
    ctx: ContextoAccion,
    cliente: QueryClientContract = db.connection(),
): Promise<number> {
    const id = ctx.empresaId ?? (await unicaEmpresaActiva(cliente))
    if (id === null) throw new EmpresaRequerida()
    exigirAccesoEmpresa(ctx, id)
    return id
}

/** Empresa sugerida activa de una fila (`empresa_sugerida_id`), o null. */
async function sugerida(
    cliente: QueryClientContract,
    tabla: string,
    id: number | null,
): Promise<number | null> {
    if (id === null) return null
    const fila = (await cliente
        .from(`${tabla} as t`)
        .join('core.empresas as e', 'e.id', 't.empresa_sugerida_id')
        .where('t.id', id)
        .where('e.activa', true)
        .select('e.id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/**
 * Empresa de un servicio nuevo (`contratos/multiempresa.md`), en este orden:
 * 1. la explícita (`empresa_id`; 422 si no existe o está desactivada);
 * 2. la sugerida de la zona del cliente;
 * 3. la sugerida del router;
 * 4. la empresa activa del contexto o, sin ella, la única empresa activa.
 * Sin ninguna: 422 `empresa_requerida`. El actor debe tener acceso a la elegida (403).
 */
export async function resolverEmpresaServicio(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    datos: { empresa_id?: number | null; zona_id: number | null; router_id: number },
): Promise<number> {
    let id: number | null = null
    if (datos.empresa_id) {
        await exigirEmpresaActiva(cliente, datos.empresa_id)
        id = datos.empresa_id
    }
    id ??= await sugerida(cliente, 'core.zonas', datos.zona_id)
    id ??= await sugerida(cliente, 'network.routers', datos.router_id)
    id ??= ctx.empresaId ?? (await unicaEmpresaActiva(cliente))
    if (id === null) {
        throw new EmpresaRequerida(
            'No se pudo deducir la empresa del servicio: indica empresa_id, define la empresa sugerida de la zona o del router, o elige la empresa activa (X-Empresa-Id)',
        )
    }
    exigirAccesoEmpresa(ctx, id)
    return id
}
