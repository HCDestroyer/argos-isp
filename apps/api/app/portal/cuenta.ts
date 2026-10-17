import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { D, aTexto, dec } from '#ledger/dinero'
import { saldoDelServicio, type EstadoServicio } from '#portal/consultas'
import type { MetodoPago } from '#shared/eventos'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import {
    SQL_EMPRESA_FACTURA,
    empresaPrincipalDelCliente,
    marcaDeEmpresa,
    marcasDeEmpresas,
    type MarcaEmpresa,
} from '#portal/marca'

/**
 * Lecturas del portal autenticado (sesión por código). TODAS reciben el `clienteId` de la sesión
 * y filtran por él: un cliente nunca ve datos de otro (una factura ajena responde 404, igual
 * que una inexistente).
 *
 * Son de solo lectura y no se auditan (como las lecturas del panel); sí se auditan la entrada
 * con código (`portal.verificar_codigo`) y las ediciones.
 *
 * Multiempresa: cada servicio y cada factura llevan la marca de su empresa (`#portal/marca`), y la
 * cuenta, la empresa principal del cliente.
 */

/** Espejo del schema `PortalContacto`. */
export interface ContactoPortal {
    nombre: string
    nit_cui: string | null
    email: string | null
    telefono: string | null
    movil: string | null
    canal_preferido: 'correo' | 'telegram' | 'whatsapp'
    telegram_vinculado: boolean
    version: number
}

export interface ServicioPortal {
    id: number
    estado: EstadoServicio
    plan: string | null
    direccion: string | null
    promesa_activa: boolean
    monto_adeudado: string
    empresa: MarcaEmpresa
}

export interface CuentaPortal {
    cliente: ContactoPortal
    servicios: ServicioPortal[]
    monto_adeudado: string
    empresa_principal: MarcaEmpresa
}

export type DocumentoFactura = 'aviso_cobro' | 'factura'

export interface FacturaPortal {
    id: number
    numero: string
    documento: DocumentoFactura
    tipo: 'servicio' | 'mora'
    servicio_id: number | null
    periodo: string
    emitida_en: Date
    vence_en: string
    estado: 'emitida' | 'parcial' | 'pagada' | 'vencida' | 'anulada'
    subtotal: string
    iva: string
    total: string
    pagado: string
    saldo: string
    fel_uuid: string | null
    fel_serie: string | null
    fel_numero: string | null
    empresa: MarcaEmpresa
}

export interface LineaFacturaPortal {
    concepto: string
    cantidad: string
    precio_unitario: string
    iva: string
    total: string
}

export interface FacturaPortalDetalle extends FacturaPortal {
    lineas: LineaFacturaPortal[]
}

export interface PagoPortal {
    id: number
    metodo: MetodoPago
    monto: string
    referencia: string | null
    estado: 'registrado' | 'pendiente_verificacion' | 'anulado'
    created_at: Date
    aplicaciones: { factura_id: number; monto: string }[]
}

export interface PromesaPortal {
    id: number
    servicio_id: number
    vence_en: Date
    monto: string
    estado: string
    canal: string
    created_at: Date
}

export async function contactoDelCliente(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ContactoPortal> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select(
            'nombre',
            'nit_cui',
            'email',
            'telefono',
            'movil',
            'canal_preferido',
            'telegram_chat_id',
            'version',
        )
        .first()) as (Omit<ContactoPortal, 'telegram_vinculado'> & { telegram_chat_id: string | null }) | null
    if (!fila) throw new NoEncontrado('El cliente no existe')
    const { telegram_chat_id: chat, ...resto } = fila
    return { ...resto, version: Number(resto.version), telegram_vinculado: Boolean(chat) }
}

export async function cuentaPortal(clienteId: number): Promise<CuentaPortal> {
    const cliente = await contactoDelCliente(clienteId)
    const filas = (await db
        .from('core.servicios as s')
        .leftJoin('network.planes as p', 'p.id', 's.plan_id')
        .where('s.cliente_id', clienteId)
        .orderBy('s.id', 'asc')
        .select('s.id', 's.estado', 's.direccion', 's.empresa_id', 'p.nombre as plan')
        .select(
            db.raw(
                `EXISTS (SELECT 1 FROM billing.promesas pr WHERE pr.servicio_id = s.id AND pr.estado = 'activa') AS promesa_activa`,
            ),
        )) as Array<Omit<ServicioPortal, 'monto_adeudado' | 'empresa'> & { empresa_id: number }>

    const principal = await empresaPrincipalDelCliente(clienteId)
    const marcas = await marcasDeEmpresas([principal, ...filas.map((f) => Number(f.empresa_id))])
    let total = new D(0)
    const servicios: ServicioPortal[] = []
    for (const { empresa_id: empresaId, ...fila } of filas) {
        const { adeudado } = await saldoDelServicio(db.connection(), Number(fila.id))
        total = total.plus(adeudado.toString())
        servicios.push({
            ...fila,
            id: Number(fila.id),
            monto_adeudado: adeudado.toFixed(2),
            empresa: marcas.get(Number(empresaId)) ?? (await marcaDeEmpresa(Number(empresaId))),
        })
    }
    return {
        cliente,
        servicios,
        monto_adeudado: aTexto(total),
        empresa_principal: marcas.get(principal) ?? (await marcaDeEmpresa(principal)),
    }
}

function columnasFacturaPortal(cliente: QueryClientContract) {
    return [
        'f.id',
        'f.tipo',
        'f.servicio_id',
        cliente.raw(`to_char(f.periodo, 'YYYY-MM-DD') as periodo`),
        'f.emitida_en',
        cliente.raw(`to_char(f.vence_en, 'YYYY-MM-DD') as vence_en`),
        'f.estado',
        'f.subtotal',
        'f.iva',
        'f.total',
        'f.pagado',
        'f.fel_uuid',
        'f.fel_serie',
        'f.fel_numero',
        cliente.raw(`${SQL_EMPRESA_FACTURA} as empresa_id`),
    ]
}

type FilaFactura = Omit<FacturaPortal, 'numero' | 'documento' | 'saldo' | 'empresa'> & { empresa_id: number }

/** Serie-número FEL cuando la factura está certificada; si no, el número interno del aviso. */
export function numeroFactura(f: {
    id: number
    fel_serie: string | null
    fel_numero: string | null
}): string {
    return f.fel_serie && f.fel_numero ? `${f.fel_serie}-${f.fel_numero}` : String(f.id)
}

function aFacturaPortal(
    { empresa_id: empresaId, ...fila }: FilaFactura,
    marcas: Map<number, MarcaEmpresa>,
): FacturaPortal {
    const id = Number(fila.id)
    const saldo = fila.estado === 'anulada' ? new D(0) : dec(fila.total).minus(dec(fila.pagado))
    return {
        ...fila,
        empresa: marcas.get(Number(empresaId))!,
        id,
        servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
        numero: numeroFactura({ ...fila, id }),
        documento: fila.fel_uuid ? 'factura' : 'aviso_cobro',
        saldo: aTexto(saldo.isNegative() ? new D(0) : saldo),
    }
}

export async function facturasPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<FacturaPortal>> {
    // con su servicio: la empresa de la factura sale de ahí (`SQL_EMPRESA_FACTURA`)
    const consulta = db
        .from('billing.facturas as f')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .where('f.cliente_id', clienteId)
        .select(...columnasFacturaPortal(db.connection()))
    const pagina = await paginar<FilaFactura>(consulta, opciones, { columna: 'f.id' })
    const marcas = await marcasConPrincipal(pagina.data.map((f) => Number(f.empresa_id)))
    return { data: pagina.data.map((f) => aFacturaPortal(f, marcas)), nextCursor: pagina.nextCursor }
}

export async function facturaPortal(
    clienteId: number,
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FacturaPortalDetalle> {
    const fila = (await cliente
        .from('billing.facturas as f')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .where('f.id', facturaId)
        .where('f.cliente_id', clienteId)
        .select(...columnasFacturaPortal(cliente))
        .first()) as FilaFactura | null
    if (!fila) throw new NoEncontrado(`La factura ${facturaId} no existe`)
    const lineas = (await cliente
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id', 'asc')
        .select(
            'concepto',
            cliente.raw('cantidad::text as cantidad'),
            'precio_unitario',
            'iva',
            'total',
        )) as LineaFacturaPortal[]
    const marcas = await marcasConPrincipal([Number(fila.empresa_id)], cliente)
    return { ...aFacturaPortal(fila, marcas), lineas }
}

/** Marcas de las empresas pedidas; una que ya no existe cae en la principal (nunca sin marca). */
async function marcasConPrincipal(
    ids: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, MarcaEmpresa>> {
    const marcas = await marcasDeEmpresas([EMPRESA_PRINCIPAL, ...ids], cliente)
    for (const id of ids) if (!marcas.has(id)) marcas.set(id, marcas.get(EMPRESA_PRINCIPAL)!)
    return marcas
}

export async function pagosPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<PagoPortal>> {
    const consulta = db
        .from('billing.pagos as p')
        .where('p.cliente_id', clienteId)
        .select('p.id', 'p.metodo', 'p.monto', 'p.referencia', 'p.estado', 'p.created_at')
    const pagina = await paginar<Omit<PagoPortal, 'aplicaciones'>>(consulta, opciones, { columna: 'p.id' })
    const ids = pagina.data.map((p) => p.id)
    const aplicaciones = ids.length
        ? ((await db
              .from('billing.pagos_aplicaciones')
              .whereIn('pago_id', ids)
              .orderBy('id', 'asc')
              .select('pago_id', 'factura_id', 'monto')) as {
              pago_id: number
              factura_id: number
              monto: string
          }[])
        : []
    return {
        data: pagina.data.map((pago) => ({
            ...pago,
            id: Number(pago.id),
            aplicaciones: aplicaciones
                .filter((a) => Number(a.pago_id) === Number(pago.id))
                .map((a) => ({ factura_id: Number(a.factura_id), monto: a.monto })),
        })),
        nextCursor: pagina.nextCursor,
    }
}

export async function promesasPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<PromesaPortal>> {
    const consulta = db
        .from('billing.promesas as pr')
        .where('pr.cliente_id', clienteId)
        .select(
            'pr.id',
            'pr.servicio_id',
            'pr.vence_en',
            'pr.monto',
            'pr.estado',
            'pr.canal',
            'pr.created_at',
        )
    const pagina = await paginar<PromesaPortal>(consulta, opciones, { columna: 'pr.id' })
    return {
        data: pagina.data.map((p) => ({ ...p, id: Number(p.id), servicio_id: Number(p.servicio_id) })),
        nextCursor: pagina.nextCursor,
    }
}
