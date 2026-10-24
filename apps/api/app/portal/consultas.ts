import { Decimal } from 'decimal.js'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { resolverIp } from '#network/consultas/ip'
import { marcaDeEmpresa, type MarcaEmpresa } from '#portal/marca'
import { ESTADOS_PENDIENTES, type EstadoFactura } from '#billing/facturas'

/**
 * Lecturas públicas del portal por IP de origen (`quien-soy` y `estado`). Son de solo lectura;
 * la auditoría la pone `ConsultaPortalAuditada` (`actions/consulta_auditada.ts`).
 *
 * Desde la IP solo sale información mínima: nombre recortado, estado y montos. Nunca nombre
 * completo, contacto, NIT, dirección ni usuario PPPoE.
 */

export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'

/** Espejo del schema `QuienSoy` (`app/portal/esquemas.ts`). */
export interface QuienSoy {
    identificado: boolean
    ip: string
    nombre_parcial: string | null
    estado: EstadoServicio | null
    promesa_activa: boolean | null
    monto_adeudado: string | null
    facturas_vencidas: { cantidad: number; total: string } | null
    /** Empresa del servicio de esa IP (marca y soporte de `/corte`) */
    empresa: MarcaEmpresa | null
}

/** Espejo del schema `EstadoPortal` (`app/portal/esquemas.ts`). */
export interface EstadoPortal {
    identificado: boolean
    estado: EstadoServicio | null
    monto_adeudado: string | null
}

/** Resultado de una lectura: la respuesta pública y el servicio que se identificó (para auditar). */
export interface Lectura<T> {
    servicioId: number | null
    respuesta: T
}

/**
 * Lo que el cliente todavía debe de UNA factura, con la regla de A3 (`ESTADOS_PENDIENTES` de
 * `#billing/facturas`, la misma de `estadoCuenta` y del corte): `total − pagado` solo si está
 * `emitida`, `parcial` o `vencida`, y nunca negativo. Todo lo demás es 0.00:
 *
 * - `pagada`, `anulada` (también la original de una sustitución) y `acreditada` (H16: cubierta
 *   entera por notas internas);
 * - `castigada` (decisión g, contrato §18): lo que falta está en `ledger.castigos_facturas`, no se
 *   le cobra a la factura. Si el cliente paga después, A3 lo lleva a recuperación (`4.2.03`), nunca
 *   a la factura castigada: el portal no lo muestra como deuda;
 * - `por_certificar` (no sale en el portal; contrato §8.3).
 */
export function saldoCobrable(factura: { estado: string; total: string; pagado: string }): Decimal {
    if (!ESTADOS_PENDIENTES.includes(factura.estado as EstadoFactura)) return new Decimal(0)
    return Decimal.max(new Decimal(factura.total).minus(factura.pagado), 0)
}

/** Zona en la que vence una factura (`vence_en` es fecha local de Guatemala). */
const ZONA = 'America/Guatemala'

/**
 * `GET /portal/quien-soy`: nombre parcial, estado, promesa activa, monto adeudado y vencidas.
 * `monto_adeudado` = saldo (`total - pagado`) de las facturas en `emitida`, `parcial` o `vencida`.
 */
export async function leerQuienSoy(
    ip: string,
    cliente: QueryClientContract = db.connection(),
): Promise<Lectura<QuienSoy>> {
    const servicioId = await resolverServicio(cliente, ip)
    const servicio = servicioId
        ? ((await cliente
              .from('core.servicios as s')
              .join('core.clientes as c', 'c.id', 's.cliente_id')
              .where('s.id', servicioId)
              .select('s.id', 's.estado', 's.empresa_id', 'c.nombre')
              .select(
                  cliente.raw(
                      `EXISTS (SELECT 1 FROM billing.promesas p WHERE p.servicio_id = s.id AND p.estado = 'activa') AS promesa_activa`,
                  ),
              )
              .first()) as {
              id: number
              estado: EstadoServicio
              empresa_id: number
              nombre: string
              promesa_activa: boolean
          } | null)
        : null
    if (!servicio) {
        return {
            servicioId: null,
            respuesta: {
                identificado: false,
                ip,
                nombre_parcial: null,
                estado: null,
                promesa_activa: null,
                monto_adeudado: null,
                facturas_vencidas: null,
                empresa: null,
            },
        }
    }

    const { adeudado, vencidas, vencidoTotal } = await saldoDelServicio(cliente, Number(servicio.id))
    return {
        servicioId: Number(servicio.id),
        respuesta: {
            identificado: true,
            ip,
            nombre_parcial: nombreParcial(servicio.nombre),
            estado: servicio.estado,
            promesa_activa: Boolean(servicio.promesa_activa),
            monto_adeudado: adeudado.toFixed(2),
            facturas_vencidas: { cantidad: vencidas, total: vencidoTotal.toFixed(2) },
            empresa: await marcaDeEmpresa(Number(servicio.empresa_id), cliente),
        },
    }
}

/** `GET /portal/estado`: solo estado y monto adeudado, sin nombre ni IP. */
export async function leerEstado(
    ip: string,
    cliente: QueryClientContract = db.connection(),
): Promise<Lectura<EstadoPortal>> {
    const servicioId = await resolverServicio(cliente, ip)
    const servicio = servicioId
        ? ((await cliente.from('core.servicios').where('id', servicioId).select('id', 'estado').first()) as {
              id: number
              estado: EstadoServicio
          } | null)
        : null
    if (!servicio) {
        return { servicioId: null, respuesta: { identificado: false, estado: null, monto_adeudado: null } }
    }
    const { adeudado } = await saldoDelServicio(cliente, Number(servicio.id))
    return {
        servicioId: Number(servicio.id),
        respuesta: { identificado: true, estado: servicio.estado, monto_adeudado: adeudado.toFixed(2) },
    }
}

/**
 * Servicio de una IP con `resolverIp` de A1 (`GET /ip/{ip}`, tarea 13), sin pasar por HTTP porque
 * este endpoint es público: sesiones activas y asignaciones vigentes, gana el prefijo más largo
 * y, a igual longitud, la sesión activa y la más reciente.
 */
export async function resolverServicio(cliente: QueryClientContract, ip: string): Promise<number | null> {
    const resolucion = await resolverIp(ip, cliente)
    return resolucion?.servicio_id ?? null
}

export interface SaldoServicio {
    /** saldo de las facturas en `emitida`, `parcial` o `vencida` */
    adeudado: Decimal
    vencidas: number
    vencidoTotal: Decimal
}

/**
 * Saldo (`total - pagado`) de las facturas pendientes del servicio, con `decimal.js`.
 * Vencidas = estado `vencida` o con `vence_en` anterior a hoy en Guatemala.
 */
export async function saldoDelServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<SaldoServicio> {
    const facturas = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', [...ESTADOS_PENDIENTES])
        .select('estado', 'total', 'pagado')
        .select(
            cliente.raw(`(estado = 'vencida' OR vence_en < (now() AT TIME ZONE ?)::date) AS vencida`, [ZONA]),
        )) as { estado: string; total: string; pagado: string; vencida: boolean }[]

    let adeudado = new Decimal(0)
    let vencidoTotal = new Decimal(0)
    let vencidas = 0
    for (const factura of facturas) {
        const saldo = saldoCobrable(factura)
        if (saldo.lessThanOrEqualTo(0)) continue
        adeudado = adeudado.plus(saldo)
        if (factura.vencida) {
            vencidas += 1
            vencidoTotal = vencidoTotal.plus(saldo)
        }
    }
    return { adeudado, vencidas, vencidoTotal }
}

/**
 * Primer nombre y la inicial de la segunda palabra: "María José García" → "María J.".
 * Nunca el nombre completo.
 */
export function nombreParcial(nombre: string): string | null {
    const palabras = nombre.trim().split(/\s+/).filter(Boolean)
    if (palabras.length === 0) return null
    const [primera, segunda] = palabras
    const inicial = segunda ? ` ${segunda.charAt(0).toLocaleUpperCase('es')}.` : ''
    return `${primera}${inicial}`
}
