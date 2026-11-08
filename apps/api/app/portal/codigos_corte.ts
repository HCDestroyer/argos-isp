import { randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'

/**
 * Códigos de corte (`contratos/corte-identificacion.md` §4, decisiones del PM P4 y P5).
 *
 * Un router con `corte_identificacion = 'codigo'` redirige el HTTP de cada suspendido a
 * `/corte?c=<código>` (`/ip proxy access`). El portal resuelve código → servicio sin depender de la IP
 * que ve el servidor (masquerade del router, NPM, Docker).
 *
 * - Uno por suspensión (`core.codigos_corte`): se crea al escribir la regla del suspendido y se cierra
 *   cuando deja de estar suspendido. Resuelve hasta `PORTAL_CODIGO_CORTE_GRACIA_MIN` (30) minutos
 *   después de cerrado, para que la página muestre «ya tienes servicio».
 * - 13 caracteres base32 (Crockford, sin I, L, O ni U): 65 bits aleatorios. Nunca el id del servicio.
 * - Da lo mismo que la identificación por IP: nombre parcial, estado, montos, pedir promesa y subir
 *   comprobante. Facturas, pagos y datos siguen detrás de la verificación por teléfono o correo.
 * - Nunca va en un evento ni en la auditoría en claro (`camposEntradaOcultos`, `limpiarCredenciales`).
 */

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const LARGO_CODIGO_CORTE = 13
const FORMATO = /^[0-9A-HJKMNP-TV-Z]{13}$/

/** Un código nuevo: 13 símbolos de 5 bits (65 bits de `randomBytes`). */
export function generarCodigoCorte(): string {
    const bytes = randomBytes(9)
    let bits = 0n
    for (const b of bytes) bits = (bits << 8n) | BigInt(b)
    let salida = ''
    for (let i = 0; i < LARGO_CODIGO_CORTE; i++) {
        salida += ALFABETO[Number(bits & 31n)]
        bits >>= 5n
    }
    return salida
}

/**
 * Código tal como lo escribió alguien (mayúsculas, `O`→`0`, `I`/`L`→`1`, sin guiones ni espacios), o
 * null si no tiene el formato. No dice si existe.
 */
export function normalizarCodigoCorte(valor: unknown): string | null {
    if (typeof valor !== 'string') return null
    const texto = valor.trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
    return FORMATO.test(texto) ? texto : null
}

/** Minutos que un código sigue resolviendo después de reactivar el servicio. */
export function graciaCodigoCorteMin(entorno: NodeJS.ProcessEnv = process.env): number {
    const valor = Number(entorno.PORTAL_CODIGO_CORTE_GRACIA_MIN ?? 30)
    return Number.isInteger(valor) && valor >= 0 ? valor : 30
}

/** Servicio del código (si está abierto o se cerró hace menos de la gracia), o null. */
export async function servicioDelCodigoCorte(
    codigo: string,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = (await cliente
        .from('core.codigos_corte')
        .where('codigo', codigo)
        .where((q) =>
            q
                .whereNull('cerrado_en')
                .orWhereRaw(`cerrado_en > now() - make_interval(mins => ?)`, [graciaCodigoCorteMin()]),
        )
        .select('servicio_id')
        .first()) as { servicio_id: number | string } | null
    return fila ? Number(fila.servicio_id) : null
}

export interface CodigoCorteServicio {
    servicio_id: number
    estado: string
    router_id: number
}

/**
 * Deja el código del servicio como pide su estado, dentro de la transacción de quien escribe sus reglas
 * en el router (`routeros.aplicar_servicio`, `routeros.reconciliar`):
 *
 * - suspendido en un router en modo `codigo`: el código abierto o uno nuevo (con
 *   `portal.codigo_corte_emitido` por outbox, sin el código);
 * - en cualquier otro estado: cierra el abierto (la gracia empieza a contar).
 *
 * Devuelve el código vigente (o null) y si se cerró uno ahora (hay reglas que borrar en el router).
 * Idempotente: un evento repetido reutiliza el código abierto.
 */
export async function sincronizarCodigoCorte(
    t: Transaccion,
    servicio: CodigoCorteServicio,
    modoCodigo: boolean,
): Promise<{ codigo: string | null; cerrado: boolean }> {
    if (servicio.estado !== 'suspendido') {
        const cerrados = await t.trx
            .from('core.codigos_corte')
            .where('servicio_id', servicio.servicio_id)
            .whereNull('cerrado_en')
            .update({ cerrado_en: t.trx.knexRawQuery('now()') })
        return { codigo: null, cerrado: Number(cerrados) > 0 }
    }
    const abierto = (await t.trx
        .from('core.codigos_corte')
        .where('servicio_id', servicio.servicio_id)
        .whereNull('cerrado_en')
        .select('codigo')
        .first()) as { codigo: string } | null
    if (abierto) return { codigo: abierto.codigo, cerrado: false }
    if (!modoCodigo) return { codigo: null, cerrado: false }
    const datos = (await t.trx
        .from('core.servicios')
        .where('id', servicio.servicio_id)
        .select('empresa_id', 'cliente_id')
        .first()) as { empresa_id: number | string; cliente_id: number | string } | null
    if (!datos) return { codigo: null, cerrado: false }
    // Choque del índice único (dos transacciones a la vez): ON CONFLICT no inserta y se relee el abierto.
    const codigo = generarCodigoCorte()
    const insertado = (await t.trx.rawQuery(
        `INSERT INTO core.codigos_corte (servicio_id, empresa_id, router_id, codigo)
         VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [servicio.servicio_id, datos.empresa_id, servicio.router_id, codigo],
    )) as { rows: Array<{ id: number | string }> }
    const fila = insertado.rows[0]
    if (!fila) {
        const otro = (await t.trx
            .from('core.codigos_corte')
            .where('servicio_id', servicio.servicio_id)
            .whereNull('cerrado_en')
            .select('codigo')
            .first()) as { codigo: string } | null
        return { codigo: otro?.codigo ?? null, cerrado: false }
    }
    await t.emit('portal.codigo_corte_emitido', {
        codigo_corte_id: Number(fila.id),
        servicio_id: servicio.servicio_id,
        empresa_id: Number(datos.empresa_id),
        cliente_id: Number(datos.cliente_id),
        router_id: servicio.router_id,
    })
    return { codigo, cerrado: false }
}

/** Código vigente (abierto) de un servicio, para la ficha del panel (sin mostrarlo). */
export async function estadoCodigoCorte(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<{ activo: boolean; creado_en: Date | null; cerrado_en: Date | null }> {
    const fila = (await cliente
        .from('core.codigos_corte')
        .where('servicio_id', servicioId)
        .orderBy('creado_en', 'desc')
        .select('creado_en', 'cerrado_en')
        .first()) as { creado_en: Date; cerrado_en: Date | null } | null
    if (!fila) return { activo: false, creado_en: null, cerrado_en: null }
    return { activo: fila.cerrado_en === null, creado_en: fila.creado_en, cerrado_en: fila.cerrado_en }
}

/** Códigos abiertos de unos servicios (solo lectura: vista previa y diagnóstico, que no crean nada). */
export async function codigosAbiertos(
    servicioIds: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, string>> {
    if (servicioIds.length === 0) return new Map()
    const filas = (await cliente
        .from('core.codigos_corte')
        .whereIn('servicio_id', servicioIds)
        .whereNull('cerrado_en')
        .select('servicio_id', 'codigo')) as Array<{ servicio_id: number | string; codigo: string }>
    return new Map(filas.map((f) => [Number(f.servicio_id), f.codigo]))
}

/**
 * Cierra en una sola consulta los códigos abiertos de servicios que ya no están suspendidos (pasada del
 * reconciliador: un router con miles de servicios no hace una consulta por servicio). Devuelve cuántos.
 */
export async function cerrarCodigosCorte(t: Transaccion, servicioIds: number[]): Promise<number> {
    if (servicioIds.length === 0) return 0
    const cerrados = await t.trx
        .from('core.codigos_corte')
        .whereIn('servicio_id', servicioIds)
        .whereNull('cerrado_en')
        .update({ cerrado_en: t.trx.knexRawQuery('now()') })
    return Number(cerrados)
}
