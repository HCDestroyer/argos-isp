import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { D, aTexto, dec } from '#ledger/dinero'
import { saldoDelServicio, type EstadoServicio } from '#portal/consultas'
import type { MetodoPago } from '#shared/eventos'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import { estadoCuenta } from '#billing/estado_cuenta'
import { DateTime } from 'luxon'
import {
    SQL_EMPRESA_FACTURA,
    empresaPrincipalDelCliente,
    marcaDeEmpresa,
    marcasDeEmpresas,
    type MarcaEmpresa,
} from '#portal/marca'
import {
    COLUMNAS_DTE,
    dteDeFila,
    joinDteFactura,
    numeroDocumento,
    sinColumnasDte,
    type ColumnasDte,
    type DtePortal,
} from '#portal/fel'

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

/** Espejo del schema `PortalFacturaPendiente`. */
export interface FacturaPendientePortal {
    id: number
    numero: string
    servicio_id: number | null
    vence_en: string
    estado: 'emitida' | 'parcial' | 'vencida'
    vencida: boolean
    total: string
    saldo: string
}

/** Espejo del schema `PortalCuentaEmpresa`: lo del cliente con UNA empresa (su NIT cobra lo suyo). */
export interface CuentaEmpresaPortal {
    empresa: MarcaEmpresa
    saldo: string
    saldo_a_favor: string
    facturas_pendientes: FacturaPendientePortal[]
}

export interface CuentaPortal {
    cliente: ContactoPortal
    servicios: ServicioPortal[]
    monto_adeudado: string
    empresa_principal: MarcaEmpresa
    empresas: CuentaEmpresaPortal[]
}

/** «Factura» (o «Nota de débito» para una mora) solo con su DTE certificado; si no, aviso de cobro. */
export type DocumentoFactura = 'aviso_cobro' | 'factura' | 'nota_debito'

/** Otra factura de una sustitución (`billing.sustituciones`), si el cliente la puede ver. */
export interface ReferenciaFactura {
    id: number
    numero: string
}

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
    /** parte de `pagado` que viene de notas de crédito vigentes */
    acreditado: string
    saldo: string
    fel_uuid: string | null
    fel_serie: string | null
    fel_numero: string | null
    dte: DtePortal | null
    sustituida: boolean
    sustituida_por: ReferenciaFactura | null
    sustituye_a: ReferenciaFactura | null
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
        empresas: await cuentaPorEmpresa(clienteId, principal),
    }
}

/**
 * Saldo y facturas del cliente por empresa (multiempresa): las secciones de `estadoCuenta` de A3
 * (solo lectura: el auxiliar CxC de cada libro, sus anticipos y sus facturas pendientes) con la
 * marca del portal. La principal del cliente primero; las demás, por id.
 */
export async function cuentaPorEmpresa(clienteId: number, principal: number): Promise<CuentaEmpresaPortal[]> {
    const estado = await estadoCuenta(clienteId)
    const marcas = await marcasDeEmpresas(estado.empresas.map((e) => e.empresa_id))
    const hoy = DateTime.now().setZone('America/Guatemala').toISODate()!
    const secciones: CuentaEmpresaPortal[] = []
    for (const seccion of estado.empresas) {
        secciones.push({
            empresa: marcas.get(seccion.empresa_id) ?? (await marcaDeEmpresa(seccion.empresa_id)),
            saldo: aTexto(seccion.saldo),
            saldo_a_favor: aTexto(seccion.saldo_a_favor),
            facturas_pendientes: seccion.facturas_pendientes.map((f) => {
                const id = Number(f.id)
                return {
                    id,
                    numero: numeroFactura({ ...f, id }),
                    servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
                    vence_en: f.vence_en,
                    estado: f.estado as FacturaPendientePortal['estado'],
                    vencida: f.estado === 'vencida' || f.vence_en < hoy,
                    total: aTexto(f.total),
                    saldo: aTexto(D.max(dec(f.total).minus(dec(f.pagado)), 0)),
                }
            }),
        })
    }
    return secciones.sort(
        (a, b) =>
            Number(b.empresa.id === principal) - Number(a.empresa.id === principal) ||
            a.empresa.id - b.empresa.id,
    )
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
        cliente.raw(
            `(SELECT coalesce(sum(n.monto), 0) FROM billing.notas_credito n WHERE n.factura_id = f.id
               AND NOT EXISTS (SELECT 1 FROM billing.notas_credito_anulaciones x WHERE x.nota_id = n.id)) as acreditado`,
        ),
        cliente.raw(
            '(SELECT x.nueva_id FROM billing.sustituciones x WHERE x.original_id = f.id) as sustituida_por_id',
        ),
        cliente.raw(
            '(SELECT x.original_id FROM billing.sustituciones x WHERE x.nueva_id = f.id) as sustituye_a_id',
        ),
        ...COLUMNAS_DTE,
        cliente.raw(`${SQL_EMPRESA_FACTURA} as empresa_id`),
    ]
}

/**
 * Facturas que el portal muestra: todas las del cliente menos las `por_certificar` (FEL
 * obligatoria con `emitir`: todavía no son deuda ni documento; contrato §8.3).
 */
function facturasVisibles(cliente: QueryClientContract, clienteId: number) {
    return cliente
        .from('billing.facturas as f')
        .leftJoin('core.servicios as s', 's.id', 'f.servicio_id')
        .joinRaw(joinDteFactura('f'))
        .where('f.cliente_id', clienteId)
        .whereNot('f.estado', 'por_certificar')
}

type FilaFactura = ColumnasDte &
    Omit<
        FacturaPortal,
        | 'numero'
        | 'documento'
        | 'saldo'
        | 'empresa'
        | 'fel_uuid'
        | 'fel_serie'
        | 'fel_numero'
        | 'dte'
        | 'sustituida'
        | 'sustituida_por'
        | 'sustituye_a'
    > & {
        empresa_id: number
        sustituida_por_id: number | null
        sustituye_a_id: number | null
    }

/** Serie-número FEL cuando la factura está certificada; si no, el número interno del aviso. */
export function numeroFactura(f: {
    id: number
    fel_serie: string | null
    fel_numero: string | null
}): string {
    return numeroDocumento(f.id, { serie: f.fel_serie, numero: f.fel_numero })
}

function aFacturaPortal(
    fila: FilaFactura,
    marcas: Map<number, MarcaEmpresa>,
    referencias: Map<number, string>,
): FacturaPortal {
    const dte = dteDeFila(fila)
    const {
        empresa_id: empresaId,
        sustituida_por_id: sustituidaPor,
        sustituye_a_id: sustituyeA,
        ...resto
    } = sinColumnasDte(fila)
    const id = Number(resto.id)
    const saldo = resto.estado === 'anulada' ? new D(0) : dec(resto.total).minus(dec(resto.pagado))
    const referencia = (otra: number | null): ReferenciaFactura | null => {
        if (otra === null) return null
        const numero = referencias.get(Number(otra))
        return numero === undefined ? null : { id: Number(otra), numero }
    }
    return {
        ...resto,
        empresa: marcas.get(Number(empresaId))!,
        id,
        servicio_id: resto.servicio_id === null ? null : Number(resto.servicio_id),
        numero: numeroDocumento(id, dte),
        documento: dte ? (resto.tipo === 'mora' ? 'nota_debito' : 'factura') : 'aviso_cobro',
        acreditado: aTexto(resto.acreditado),
        saldo: aTexto(saldo.isNegative() ? new D(0) : saldo),
        fel_uuid: dte?.autorizacion ?? null,
        fel_serie: dte?.serie ?? null,
        fel_numero: dte?.numero ?? null,
        dte,
        sustituida: sustituidaPor !== null,
        sustituida_por: referencia(sustituidaPor),
        sustituye_a: referencia(sustituyeA),
    }
}

/**
 * Números de las facturas de las sustituciones (la original y la nueva) que el cliente puede ver.
 * Una sustituta aún `por_certificar` no sale: la original queda `sustituida` sin enlace.
 */
async function numerosVisibles(
    cliente: QueryClientContract,
    clienteId: number,
    filas: FilaFactura[],
): Promise<Map<number, string>> {
    const ids = filas
        .flatMap((f) => [f.sustituida_por_id, f.sustituye_a_id])
        .filter((v): v is number => v !== null)
        .map(Number)
    const numeros = new Map<number, string>()
    if (ids.length === 0) return numeros
    const otras = (await facturasVisibles(cliente, clienteId)
        .whereIn('f.id', [...new Set(ids)])
        .select('f.id', 'dte.dte_serie', 'dte.dte_numero')) as Array<{
        id: number
        dte_serie: string | null
        dte_numero: string | null
    }>
    for (const otra of otras) {
        numeros.set(
            Number(otra.id),
            numeroDocumento(Number(otra.id), { serie: otra.dte_serie, numero: otra.dte_numero }),
        )
    }
    return numeros
}

export async function facturasPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<FacturaPortal>> {
    // la empresa de cada factura es la que la emitió (`SQL_EMPRESA_FACTURA`)
    const conexion = db.connection()
    const consulta = facturasVisibles(conexion, clienteId).select(...columnasFacturaPortal(conexion))
    const pagina = await paginar<FilaFactura>(consulta, opciones, { columna: 'f.id' })
    const marcas = await marcasConPrincipal(pagina.data.map((f) => Number(f.empresa_id)))
    const referencias = await numerosVisibles(conexion, clienteId, pagina.data)
    return {
        data: pagina.data.map((f) => aFacturaPortal(f, marcas, referencias)),
        nextCursor: pagina.nextCursor,
    }
}

export async function facturaPortal(
    clienteId: number,
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FacturaPortalDetalle> {
    const fila = (await facturasVisibles(cliente, clienteId)
        .where('f.id', facturaId)
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
    const referencias = await numerosVisibles(cliente, clienteId, [fila])
    return { ...aFacturaPortal(fila, marcas, referencias), lineas }
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
