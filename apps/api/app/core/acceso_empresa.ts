import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { exigirAlcance } from '#core/acl'
import { EmpresaNoPermitida, type EmpresaPeticion } from '#shared/empresa_activa'
import { dimensionesDeServicio } from '#core/consultas/servicios'
import { dimensionesDeCliente } from '#core/consultas/clientes'
import { empresaDeServicio } from '#core/empresas'

/**
 * Acceso a un recurso concreto por empresa (multiempresa). Se mira el **alcance** del usuario
 * (todas sus empresas), no solo la activa: un enlace directo a un servicio de otra de sus empresas
 * funciona. Con alcance global no se restringe nada.
 */

/** 403 `empresa_no_permitida` si el servicio es de una empresa fuera del alcance de la petición. */
export async function exigirEmpresaDeServicio(empresa: EmpresaPeticion | undefined, servicioId: number) {
    const permitidas = empresa?.permitidas
    if (!permitidas) return
    const id = await empresaDeServicio(servicioId)
    if (!permitidas.includes(id)) throw new EmpresaNoPermitida(id)
}

/**
 * 403 `empresa_no_permitida` si ningún servicio del cliente es de su alcance. Un cliente sin
 * servicios es visible para todas las empresas.
 */
export async function exigirEmpresaDeCliente(empresa: EmpresaPeticion | undefined, clienteId: number) {
    const permitidas = empresa?.permitidas
    if (!permitidas) return
    const filas = (await db
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .distinct('empresa_id')) as Array<{ empresa_id: number }>
    if (filas.length === 0) return
    const empresas = filas.map((f) => Number(f.empresa_id))
    if (!empresas.some((id) => permitidas.includes(id))) throw new EmpresaNoPermitida(empresas[0]!)
}

/** Alcance (router/zona) y empresa de un servicio: lo usan las rutas `/servicios/:id/...`. */
export async function exigirServicio(ctx: HttpContext, servicioId: number) {
    exigirAlcance(ctx.alcance, await dimensionesDeServicio(servicioId))
    await exigirEmpresaDeServicio(ctx.empresa, servicioId)
}

/** Alcance (router/zona) y empresa de un cliente: lo usan las rutas `/clientes/:id/...`. */
export async function exigirCliente(ctx: HttpContext, clienteId: number) {
    exigirAlcance(ctx.alcance, await dimensionesDeCliente(clienteId))
    await exigirEmpresaDeCliente(ctx.empresa, clienteId)
}
