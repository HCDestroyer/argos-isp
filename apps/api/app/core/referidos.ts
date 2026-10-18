import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { ReglaNegocio } from '#shared/errores'

/**
 * Códigos de referido (`contratos/lealtad.md` §3 y §4; A1). Un código por cliente y empresa en
 * `core.codigos_referido`, creado por trigger con el primer servicio del cliente en esa empresa.
 * Ocho caracteres de `ALFABETO_REFERIDO` (sin 0/O, 1/I/L), únicos en la instalación.
 */

export const ALFABETO_REFERIDO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const FORMATO = new RegExp(`^[${ALFABETO_REFERIDO}]{8}$`)

/** Mayúsculas, sin espacios ni guiones (`abcd-2345` → `ABCD2345`). */
export function normalizarCodigoReferido(codigo: string): string {
    return codigo.replace(/[\s-]/g, '').toUpperCase()
}

export interface ReferidoResuelto {
    referido_por_id: number
    referido_empresa_id: number
    codigo: string
}

/** Documento fiscal que identifica a una persona (NIT, CUI o pasaporte); CF o vacío no cuenta. */
function documento(tipo: string | null | undefined, nitCui: string | null | undefined): string | null {
    if (!nitCui || tipo === 'cf') return null
    const limpio = nitCui.replace(/[\s-]/g, '').toUpperCase()
    return limpio === '' || limpio === 'CF' ? null : limpio
}

/**
 * Resuelve el `codigo_referido` del alta de un cliente: el cliente referidor y la empresa en la que
 * cuenta el referido (la del código). 422 `referido_invalido` si el formato no es válido, el código
 * no existe (o es de una empresa fuera del alcance del actor) o el referidor tiene el mismo NIT, CUI
 * o pasaporte que el cliente nuevo (`contratos/lealtad.md` §4: nadie se refiere a sí mismo).
 */
export async function resolverCodigoReferido(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    codigoEntrada: string,
    nuevo: { tipo_documento_fiscal?: unknown; nit_cui?: unknown },
): Promise<ReferidoResuelto> {
    const codigo = normalizarCodigoReferido(codigoEntrada)
    const invalido = (detalle: string) => new ReglaNegocio(detalle, 'referido_invalido')
    if (!FORMATO.test(codigo)) {
        throw invalido('El código de referido tiene 8 letras o números (sin 0, O, 1, I ni L)')
    }
    const fila = (await cliente
        .from('core.codigos_referido as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .where('k.codigo', codigo)
        .select('k.cliente_id', 'k.empresa_id', 'c.tipo_documento_fiscal', 'c.nit_cui')
        .first()) as {
        cliente_id: number
        empresa_id: number
        tipo_documento_fiscal: string
        nit_cui: string | null
    } | null
    const permitidas = ctx.empresasPermitidas
    if (!fila || (permitidas && !permitidas.includes(Number(fila.empresa_id)))) {
        throw invalido(`El código de referido ${codigo} no existe`)
    }
    const delReferidor = documento(fila.tipo_documento_fiscal, fila.nit_cui)
    const delNuevo = documento(
        nuevo.tipo_documento_fiscal as string | undefined,
        nuevo.nit_cui as string | null,
    )
    if (delReferidor && delNuevo && delReferidor === delNuevo) {
        throw invalido('El cliente referidor tiene el mismo NIT o CUI: un cliente no se refiere a sí mismo')
    }
    return { referido_por_id: Number(fila.cliente_id), referido_empresa_id: Number(fila.empresa_id), codigo }
}

/**
 * Interfaz pública (A3 `lealtad`, A5 portal): el código de referido del cliente en una empresa, o
 * null si todavía no tiene servicio en ella.
 */
export async function codigoReferidoDe(
    clienteId: number,
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    const fila = (await cliente
        .from('core.codigos_referido')
        .where({ cliente_id: clienteId, empresa_id: empresaId })
        .select('codigo')
        .first()) as { codigo: string } | null
    return fila?.codigo ?? null
}

/**
 * Interfaz pública (A3): quién refirió al cliente y en qué empresa cuenta, o null. El consumidor
 * `lealtad` lo lee al recibir `servicio.creado` del referido (contrato §9: el referido cuenta en la
 * empresa del servicio nuevo, que debe ser `referido_empresa_id`).
 */
export async function referidoDeCliente(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<{ referido_por_id: number; referido_empresa_id: number } | null> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .whereNotNull('referido_por_id')
        .select('referido_por_id', 'referido_empresa_id')
        .first()) as { referido_por_id: number; referido_empresa_id: number } | null
    return fila
        ? {
              referido_por_id: Number(fila.referido_por_id),
              referido_empresa_id: Number(fila.referido_empresa_id),
          }
        : null
}
