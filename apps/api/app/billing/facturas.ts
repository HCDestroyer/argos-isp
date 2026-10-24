import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { NoEncontrado, Problema } from '#shared/errores'
import { valorParametro } from '#fiscal/parametros'
import { hoyGuatemala } from '#ledger/fechas'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, D, aTexto, dec, redondear, type Dec, type Monto } from '#ledger/dinero'
import { notasDeFactura } from '#billing/notas_credito'
import { emisorDeFactura } from '#billing/empresa'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Facturas: montos (IVA incluido), estado según lo pagado y consultas de lectura.
 */

export const TASA_IVA = new D('0.12')
const DIVISOR_IVA = new D('1.12')

export type EstadoFactura =
    | 'por_certificar'
    | 'emitida'
    | 'parcial'
    | 'pagada'
    | 'vencida'
    | 'anulada'
    /** fase 4 (decisión g): castigo de cartera; `pagado` + castigado = total */
    | 'castigada'
    /** H16: aviso de cobro cubierto entero por notas internas, sin cobro: no es venta, no se certifica */
    | 'acreditada'
export type TipoFactura = 'servicio' | 'mora'

export interface LineaCalculada {
    concepto: string
    tipo: 'servicio' | 'producto' | 'mora' | 'otro' | 'descuento'
    cantidad: string
    precio_unitario: string
    gravable: boolean
    iva: string
    total: string
    /**
     * Solo en `descuento`: índice (en la misma lista) de la línea que descuenta. Al insertar se
     * guarda como `linea_id` (contrato de localización fiscal §3.5).
     */
    linea_indice?: number
    /**
     * Cuenta de ingreso de la línea (código de `ledger.cuentas`) cuando viene de un concepto de cargo
     * (`billing.conceptos_cargo`); null o ausente = la de su tipo (`cuentaIngresoDeLinea`).
     */
    cuenta_codigo?: string | null
    /** línea mensual de un adicional `cobrado` (`core.servicios_adicionales.id`) */
    servicio_adicional_id?: number | null
    /** periodo que cobra la línea del adicional (el de la factura o su primer periodo prorrateado) */
    adicional_periodo?: string | null
    /** inventario (fase C): la línea de un cargo único que vende del inventario */
    producto_id?: number | null
    bodega_id?: number | null
    unidad_id?: number | null
}

/**
 * Cuenta de ingreso de una línea: la de su concepto de cargo si la tiene; si no, la de su tipo
 * (`servicio` → 4.1.01, `mora` → 4.1.02, el resto → 4.1.03). Las líneas `descuento` usan la de la
 * línea que descuentan (su contrapartida es 5.1.01).
 */
export function cuentaIngresoDeLinea(linea: { tipo: string; cuenta_codigo?: string | null }): string {
    if (linea.cuenta_codigo) return linea.cuenta_codigo
    if (linea.tipo === 'servicio') return CUENTAS.INGRESOS_INTERNET
    if (linea.tipo === 'mora') return CUENTAS.RECARGOS_MORA
    return CUENTAS.OTROS_INGRESOS
}

export interface DescuentoPedido {
    /** índice de la línea a descontar (la del plan es la 0) */
    indice: number
    concepto: string
    /** Q con IVA incluido; si pasa lo que le queda a la línea, se recorta (nunca la deja bajo cero) */
    monto: Monto
}

/**
 * Agrega las líneas `descuento` (negativas) a las de la factura. El IVA de la factura queda el del
 * **neto** (lealtad §5, inv. F.1): el IVA de cada descuento es el IVA del neto de su línea menos el IVA
 * que ya tenía (la línea y sus descuentos anteriores), así `Σ iva` = IVA de `línea − descuentos`
 * redondeado una sola vez. Un descuento recortado a 0 no se agrega.
 */
export function aplicarDescuentos(lineas: LineaCalculada[], descuentos: DescuentoPedido[]): LineaCalculada[] {
    const salida = [...lineas]
    const usado = new Map<number, { total: Dec; iva: Dec }>()
    for (const d of descuentos) {
        const objetivo = lineas[d.indice]
        if (!objetivo || objetivo.tipo === 'descuento') {
            throw new Error(`Descuento sobre una línea inexistente o que ya es descuento (${d.indice})`)
        }
        const previo = usado.get(d.indice) ?? { total: CERO, iva: CERO }
        const restante = dec(objetivo.total).minus(previo.total)
        const pedido = redondear(d.monto)
        const monto = pedido.gt(restante) ? restante : pedido
        if (monto.lte(0)) continue
        const neto = restante.minus(monto)
        const ivaNeto = objetivo.gravable ? redondear(neto.minus(neto.div(DIVISOR_IVA))) : CERO
        const ivaAntes = dec(objetivo.iva).minus(previo.iva)
        const iva = ivaNeto.minus(ivaAntes)
        usado.set(d.indice, { total: previo.total.plus(monto), iva: previo.iva.minus(iva) })
        salida.push({
            concepto: d.concepto,
            tipo: 'descuento',
            cantidad: '1',
            precio_unitario: aTexto(monto.negated()),
            gravable: objetivo.gravable,
            iva: aTexto(iva),
            total: aTexto(monto.negated()),
            linea_indice: d.indice,
        })
    }
    return salida
}

/**
 * Desglosa el IVA incluido en el total de una línea: `subtotal = total / 1.12`, `iva = total −
 * subtotal`, redondeado a centavos al final del cálculo. El subtotal de la factura es
 * `total − Σ iva` para que siempre cuadre al centavo.
 */
export function lineaConIva(
    datos: Omit<LineaCalculada, 'iva' | 'total' | 'precio_unitario'> & { total: Monto },
): LineaCalculada {
    const total = redondear(datos.total)
    const iva = datos.gravable ? redondear(total.minus(total.div(DIVISOR_IVA))) : CERO
    const cantidad = dec(datos.cantidad)
    return {
        ...datos,
        cantidad: cantidad.toString(),
        precio_unitario: aTexto(cantidad.isZero() ? total : total.div(cantidad)),
        iva: aTexto(iva),
        total: aTexto(total),
    }
}

export interface Totales {
    subtotal: Dec
    iva: Dec
    total: Dec
}

export function totalesDe(lineas: LineaCalculada[]): Totales {
    let total = CERO
    let iva = CERO
    for (const linea of lineas) {
        total = total.plus(linea.total)
        iva = iva.plus(linea.iva)
    }
    return { subtotal: total.minus(iva), iva, total }
}

/** Estado de una factura viva según lo pagado y si ya pasó por el vencimiento. */
export function estadoSegunPago(f: { total: Monto; pagado: Monto; vencida_en: unknown }): EstadoFactura {
    if (dec(f.pagado).gte(dec(f.total))) return 'pagada'
    if (f.vencida_en) return 'vencida'
    return dec(f.pagado).gt(0) ? 'parcial' : 'emitida'
}

export const ESTADOS_PENDIENTES: readonly EstadoFactura[] = ['emitida', 'parcial', 'vencida']

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface FacturaFila {
    id: number
    /** empresa (NIT) que emite la factura: la del servicio al emitirse */
    empresa_id: number
    /** nombre comercial de la empresa (para la pantalla y el recibo) */
    empresa_nombre: string
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    tipo: TipoFactura
    factura_origen_id: number | null
    periodo: string
    clave_unica: string
    emitida_en: Date
    vence_en: string
    vencida_en: Date | null
    estado: EstadoFactura
    subtotal: string
    iva: string
    total: string
    /** cubierto: pagos, saldos a favor aplicados y notas de crédito */
    pagado: string
    /** parte de `pagado` que viene de notas de crédito */
    acreditado: string
    /** autorización, serie, número y estado del DTE (de `fiscal.dte`, contrato §12.4) */
    fel_uuid: string | null
    fel_serie: string | null
    fel_numero: string | null
    fel_estado: string | null
    /** DTE vigente (o el último rechazado) y su error visible */
    dte_id?: number | null
    fel_error?: string | null
    /** aviso de cobro: su IVA está en 2.1.11 hasta certificarse (§10.1) */
    aviso_cobro?: boolean
    certificar_al?: 'emitir' | 'pagar' | 'nunca' | null
    tipo_dte?: string | null
    anulada_en?: Date | null
    motivo_anulacion?: string | null
    /** factura importada: sistema de origen e id allí */
    origen?: string | null
    id_externo?: string | null
    /** sustitución (`billing.sustituciones`): la factura nueva que reemplazó a esta, y la original que esta reemplaza */
    sustituida_por?: number | null
    sustituye_a?: number | null
    version: number
    created_at: Date
    updated_at: Date
}

export function columnasFactura(cliente: QueryClientContract, alias = 'f') {
    const c = (columna: string) => `${alias}.${columna}`
    return [
        c('id'),
        c('empresa_id'),
        cliente.raw(
            `(select e.nombre_comercial from core.empresas e where e.id = ${alias}.empresa_id) as empresa_nombre`,
        ),
        c('cliente_id'),
        cliente.raw(
            `(select cl.nombre from core.clientes cl where cl.id = ${alias}.cliente_id) as cliente_nombre`,
        ),
        c('servicio_id'),
        c('tipo'),
        c('factura_origen_id'),
        cliente.raw(`to_char(${alias}.periodo, 'YYYY-MM-DD') as periodo`),
        c('clave_unica'),
        c('emitida_en'),
        cliente.raw(`to_char(${alias}.vence_en, 'YYYY-MM-DD') as vence_en`),
        c('vencida_en'),
        c('estado'),
        c('subtotal'),
        c('iva'),
        c('total'),
        c('pagado'),
        cliente.raw(
            `(select coalesce(sum(n.monto), 0) from billing.notas_credito n where n.factura_id = ${alias}.id
               and not exists (select 1 from billing.notas_credito_anulaciones x where x.nota_id = n.id)) as acreditado`,
        ),
        ...columnasDte(cliente, alias),
        c('aviso_cobro'),
        c('certificar_al'),
        c('tipo_dte'),
        c('anulada_en'),
        c('motivo_anulacion'),
        // cargo único manual: `cargo-<uuid>` de tipo servicio (el cargo interno H18 de main usa
        // `cargo-diferencia-<id>` con tipo `cargo` y no lo es)
        cliente.raw(
            `(${alias}.tipo = 'servicio' AND starts_with(${alias}.clave_unica, 'cargo-')) as cargo_unico`,
        ),
        c('motivo_sin_costo_id'),
        cliente.raw(
            `(select ms.nombre from billing.motivos_sin_costo ms where ms.id = ${alias}.motivo_sin_costo_id) as motivo_sin_costo_nombre`,
        ),
        c('motivo_sin_costo_texto'),
        c('origen'),
        cliente.raw(`${alias}.clave_externa as id_externo`),
        cliente.raw(
            `(select su.nueva_id from billing.sustituciones su where su.original_id = ${alias}.id) as sustituida_por`,
        ),
        cliente.raw(
            `(select su.original_id from billing.sustituciones su where su.nueva_id = ${alias}.id) as sustituye_a`,
        ),
        c('version'),
        c('created_at'),
        c('updated_at'),
    ]
}

/**
 * Datos FEL de la factura desde `fiscal.dte`: el DTE vigente (no rechazado) o, si no hay, el último
 * rechazado (con su error). Para una mora, su NDEB. Las columnas `billing.facturas.fel_*` son del
 * sistema anterior y ya no se escriben.
 */
function columnasDte(cliente: QueryClientContract, alias: string) {
    const dte = `(select d.%s from fiscal.dte d
        where d.documento_id = ${alias}.id
          and d.documento_tipo = case when ${alias}.tipo = 'mora' then 'nota_debito' else 'factura' end
        order by (d.estado = 'rechazado'), d.id desc limit 1)`
    const col = (campo: string, como: string) => cliente.raw(`${dte.replace('%s', campo)} as ${como}`)
    return [
        col('autorizacion', 'fel_uuid'),
        col('serie', 'fel_serie'),
        col('numero', 'fel_numero'),
        col('estado', 'fel_estado'),
        col('id', 'dte_id'),
        col('ultimo_error', 'fel_error'),
    ]
}

export interface FiltrosFacturas extends OpcionesPaginacion {
    cliente_id?: number
    servicio_id?: number
    estado?: EstadoFactura
    periodo?: string
    tipo?: TipoFactura
}

/** Filtros de alcance de una factura: zona del cliente y router del servicio. */
export const dimensionesFactura: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) => q.whereIn('s.router_id', ids),
}

export async function listarFacturas(
    filtros: FiltrosFacturas,
    alcance?: Alcance,
    empresas: number[] | null = null,
) {
    const consulta = db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .select(...columnasFactura(db.connection()))
        .if(filtros.cliente_id, (q) => q.where('f.cliente_id', filtros.cliente_id!))
        .if(filtros.servicio_id, (q) => q.where('f.servicio_id', filtros.servicio_id!))
        .if(filtros.estado, (q) => q.where('f.estado', filtros.estado!))
        .if(filtros.periodo, (q) => q.where('f.periodo', filtros.periodo!))
        .if(filtros.tipo, (q) => q.where('f.tipo', filtros.tipo!))
    filtrarPorAlcance(consulta, alcance, dimensionesFactura)
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('f.empresa_id', ids))
    return paginar<FacturaFila>(consulta, filtros, { columna: 'f.id' })
}

export async function verFactura(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('billing.facturas as f')
        .where('f.id', id)
        .select(...columnasFactura(cliente), 'f.reglas_snapshot')
        .first()) as (FacturaFila & { reglas_snapshot: unknown }) | null
    if (!fila) throw new NoEncontrado(`La factura ${id} no existe`)
    const lineas = await cliente
        .from('billing.facturas_lineas')
        .where('factura_id', id)
        .orderBy('id', 'asc')
        .select(
            'id',
            'concepto',
            'tipo',
            cliente.raw('cantidad::text as cantidad'),
            'precio_unitario',
            'gravable',
            'iva',
            'total',
            'linea_id',
            'descuento',
            'cuenta_codigo',
        )
    const notas = await notasDeFactura(id, cliente)
    // FEL (semana 5): la factura se certifica con el NIT y los datos fiscales de su empresa
    const emisor = await emisorDeFactura(id, cliente)
    const pagos = await pagosDeFactura(id, cliente)
    const asientos = await asientosDeFactura(id, cliente)
    const diferenciaCobroTope = await topeDiferenciaCobro(Number(fila.empresa_id), cliente)
    return {
        ...fila,
        lineas,
        notas_credito: notas,
        emisor,
        pagos,
        asientos,
        diferencia_cobro_tope: diferenciaCobroTope,
    }
}

/**
 * `diferencia_cobro_tope` vigente hoy de la empresa (lo que `pagos.cerrar_diferencia` admite), o
 * null si la empresa no tiene el parámetro (sin localización instalada).
 */
export async function topeDiferenciaCobro(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<string | null> {
    try {
        const valor = await valorParametro<string>(
            empresaId,
            'diferencia_cobro_tope',
            hoyGuatemala(),
            cliente,
        )
        return valor === null || valor === undefined ? null : aTexto(String(valor))
    } catch (error) {
        if (error instanceof Problema) return null
        throw error
    }
}

/** Pagos aplicados a la factura (una fila por aplicación, también los de pagos anulados). */
export async function pagosDeFactura(id: number, cliente: QueryClientContract = db.connection()) {
    const filas = (await cliente
        .from('billing.pagos_aplicaciones as pa')
        .join('billing.pagos as p', 'p.id', 'pa.pago_id')
        .where('pa.factura_id', id)
        .orderBy('pa.id', 'asc')
        .select(
            'pa.id as aplicacion_id',
            'p.id as pago_id',
            'p.cobro_id',
            'pa.monto',
            'p.monto as pago_monto',
            'p.metodo',
            'p.referencia',
            'p.estado',
            'p.historico',
            'pa.created_at as aplicado_en',
        )) as Array<{
        aplicacion_id: number
        pago_id: number
        cobro_id: number | null
        monto: string
        pago_monto: string
        metodo: string
        referencia: string | null
        estado: string
        historico: boolean
        aplicado_en: Date
    }>
    return filas.map((f) => ({
        ...f,
        aplicacion_id: Number(f.aplicacion_id),
        pago_id: Number(f.pago_id),
        cobro_id: f.cobro_id === null ? null : Number(f.cobro_id),
    }))
}

/** Asientos de la factura (origen `factura` o `mora` con su id), los reversos incluidos, en orden. */
export async function asientosDeFactura(id: number, cliente: QueryClientContract = db.connection()) {
    const filas = (await cliente
        .from('ledger.asientos as a')
        .whereIn('a.origen_tipo', ['factura', 'mora'])
        .where('a.origen_id', id)
        .orderBy('a.id', 'asc')
        .select(
            'a.id',
            cliente.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.origen_tipo',
            'a.descripcion',
            'a.reversa_de',
            cliente.raw(
                '(select d.codigo from ledger.asientos_numeros n join ledger.diarios d on d.id = n.diario_id where n.asiento_id = a.id) as diario',
            ),
            cliente.raw(
                '(select n.numero from ledger.asientos_numeros n where n.asiento_id = a.id) as numero',
            ),
            cliente.raw(
                '(select r.id from ledger.asientos r where r.reversa_de = a.id limit 1) as revertido_por',
            ),
            cliente.raw(
                '(select sum(m.debe)::text from ledger.movimientos m where m.asiento_id = a.id) as total',
            ),
        )) as Array<{
        id: number
        fecha: string
        origen_tipo: string
        descripcion: string
        reversa_de: number | null
        diario: string | null
        numero: number | null
        revertido_por: number | null
        total: string
    }>
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        reversa_de: f.reversa_de === null ? null : Number(f.reversa_de),
        revertido_por: f.revertido_por === null ? null : Number(f.revertido_por),
        numero: f.numero === null ? null : Number(f.numero),
        total: aTexto(f.total ?? '0'),
    }))
}

/** Dimensiones de alcance de una factura (para `exigirAlcance`). */
export async function dimensionesDeFactura(id: number) {
    const fila = (await db
        .from('billing.facturas as f')
        .join('core.clientes as c', 'c.id', 'f.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .where('f.id', id)
        .select('c.zona_id', 's.router_id', 'f.empresa_id')
        .first()) as { zona_id: number | null; router_id: number | null; empresa_id: number } | null
    if (!fila) throw new NoEncontrado(`La factura ${id} no existe`)
    return { zona: [fila.zona_id], router: [fila.router_id], empresa_id: Number(fila.empresa_id) }
}

/** Pendiente de cobro de una factura. */
export function pendienteDe(f: { total: Monto; pagado: Monto }): Dec {
    return dec(f.total).minus(dec(f.pagado))
}

/**
 * Saldo pendiente de un servicio: lo que falta por cobrar de sus facturas vivas (`emitida`,
 * `parcial`, `vencida`): `total − pagado` (el `pagado` incluye lo acreditado por notas de
 * crédito). Lo usa `servicios.cambiar_empresa` (A1): un servicio con saldo no cambia de empresa.
 */
export async function saldoPendienteServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Dec> {
    const fila = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .whereIn('estado', [...ESTADOS_PENDIENTES])
        .select(cliente.raw('coalesce(sum(total - pagado), 0)::text AS saldo'))
        .first()) as { saldo: string }
    return dec(fila.saldo)
}
