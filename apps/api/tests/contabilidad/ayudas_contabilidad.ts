import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { crearPlantillaFila, cuentaBancariaPrueba, generar } from '#tests/billing/ayudas_billing'
import { Problema } from '#shared/errores'
import { saldoCliente } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import type { ContextoAccion } from '#shared/contexto'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'

/**
 * Ayudas del auditor contable. Cada prueba crea sus **propias empresas** (NIT nuevos): así los
 * invariantes que comparan el libro con los documentos se revisan solo sobre lo que armó la prueba
 * con las acciones, sin los fixtures que otras suites insertan directo. Al terminar, el grupo
 * llama `soloEmpresaPrincipal()` (el resto de la suite sigue con una sola empresa activa).
 */

export interface Empresas {
    /** dos empresas (NIT) nuevas */
    B: number
    C: number
    usuarioId: number
    token: string
    /** contexto de un usuario admin (actor de las acciones; abre las cajas) */
    ctx: ContextoAccion
    cajas: Map<number, number>
    cuentas: Map<number, number>
}

/** Dos empresas nuevas, cada una con su caja abierta por el usuario y su cuenta bancaria. */
export async function prepararEmpresas(): Promise<Empresas> {
    const B = await crearEmpresaFila()
    const C = await crearEmpresaFila()
    const { usuario, token } = await usuarioConRoles(['admin'])
    const ctx = contextoPrueba(usuario.id)
    const cajas = new Map<number, number>()
    const cuentas = new Map<number, number>()
    for (const empresaId of [B, C]) {
        const caja = await new CrearCaja().execute(
            { nombre: unico('Caja'), cajero_id: usuario.id, empresa_id: empresaId },
            ctx,
        )
        await new AbrirCaja().execute({ caja_id: caja.id, fondo_inicial: '100.00' }, ctx)
        cajas.set(empresaId, caja.id)
        const cuenta = await cuentaBancariaPrueba('Banrural', empresaId)
        cuentas.set(empresaId, cuenta.id)
    }
    return { B, C, usuarioId: usuario.id, token, ctx, cajas, cuentas }
}

export interface OpcionesServicio {
    precio?: string
    instalacion?: string
    plantilla?: Record<string, unknown>
    clienteId?: number
}

/** Cliente (o el dado) con un servicio en la empresa, plan al precio y plantilla dados. */
export async function servicioEn(empresaId: number, opciones: OpcionesServicio = {}) {
    const plantillaId = await crearPlantillaFila(opciones.plantilla)
    const planId = await crearPlanFila({
        precio: opciones.precio ?? '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const clienteId = opciones.clienteId ?? (await crearClienteFila())
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        fecha_instalacion: opciones.instalacion ?? '2026-09-01',
        empresa_id: empresaId,
    })
    return { clienteId, servicioId, planId, plantillaId }
}

/** Servicio en la empresa con sus facturas generadas hasta `hasta`. */
export async function servicioFacturado(
    empresaId: number,
    hasta = '2026-10-01',
    opciones: OpcionesServicio = {},
) {
    const datos = await servicioEn(empresaId, opciones)
    await generar(datos.servicioId, hasta)
    return { ...datos, facturas: await facturasDelServicio(datos.servicioId) }
}

export interface FacturaResumen {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    tipo: string
    estado: string
    total: string
    pagado: string
    iva: string
}

export async function facturasDelServicio(servicioId: number): Promise<FacturaResumen[]> {
    return normalizar(
        await db
            .from('billing.facturas')
            .where('servicio_id', servicioId)
            .orderBy('id', 'asc')
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                'iva',
            ),
    )
}

/** Facturas pendientes (con saldo) de las empresas dadas, opcionalmente de un cliente. */
export async function pendientes(empresas: number[], clienteId?: number): Promise<FacturaResumen[]> {
    return normalizar(
        await db
            .from('billing.facturas')
            .whereIn('empresa_id', empresas)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .whereRaw('total > pagado')
            .if(clienteId !== undefined, (q) => q.where('cliente_id', clienteId!))
            .orderBy('id', 'asc')
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                'iva',
            ),
    )
}

function normalizar(lista: Array<Record<string, unknown>>): FacturaResumen[] {
    return lista.map((f) => ({
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cliente_id: Number(f.cliente_id),
        servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
        tipo: String(f.tipo),
        estado: String(f.estado),
        total: String(f.total),
        pagado: String(f.pagado),
        iva: String(f.iva),
    }))
}

export interface ErrorDeDominio {
    status: number
    /** código final del `type` (`periodo_cerrado`, `validacion`…) */
    codigo: string
    detalle: string
    /** `rule` de cada error por campo */
    reglas: string[]
}

/** Espera que la promesa falle con un Problema (RFC 9457) y devuelve status y código. */
export async function errorDe(promesa: Promise<unknown>): Promise<ErrorDeDominio> {
    try {
        await promesa
    } catch (error) {
        if (error instanceof Problema) {
            return {
                status: error.status,
                codigo: error.tipo.split(':').at(-1) ?? error.tipo,
                detalle: error.detalle ?? error.message,
                reglas: (error.errores ?? []).map((e) => String(e.rule)),
            }
        }
        throw error
    }
    throw new Error('Se esperaba un error de dominio y la acción terminó bien')
}

/** Saldo de una cuenta (debe − haber) en el libro de una empresa, opcionalmente de un cliente. */
export async function saldoCuenta(empresaId: number, codigo: string, clienteId?: number): Promise<string> {
    const fila = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.empresa_id', empresaId)
        .where('c.codigo', codigo)
        .if(clienteId !== undefined, (q) => q.where('m.cliente_id', clienteId!))
        .select(db.raw('coalesce(sum(m.debe - m.haber), 0)::text as saldo'))
        .firstOrFail()
    return fila.saldo as string
}

/** Saldo CxC del cliente en la empresa (función del producto) como texto. */
export async function saldoClienteTexto(clienteId: number, empresaId: number): Promise<string> {
    const saldo = await saldoCliente(clienteId, undefined, empresaId)
    return saldo.toFixed(2)
}

/** Saldo de anticipos del cliente en la empresa (función del producto) como texto. */
export async function anticiposTexto(clienteId: number, empresaId: number): Promise<string> {
    const saldo = await saldoAnticipos(db.connection(), clienteId, empresaId)
    return saldo.toFixed(2)
}

/** Código de la subcuenta de una caja. */
export async function codigoCaja(cajaId: number): Promise<string> {
    const fila = await db
        .from('ledger.cajas as c')
        .join('ledger.cuentas as cu', 'cu.id', 'c.cuenta_id')
        .where('c.id', cajaId)
        .select('cu.codigo')
        .firstOrFail()
    return fila.codigo as string
}

/** Movimientos de los asientos de un origen: [codigo, debe, haber]. */
export async function lineas(origenTipo: string, origenId: number, soloOriginal = true) {
    const filas = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', origenTipo)
        .where('a.origen_id', origenId)
        .if(soloOriginal, (q) => q.whereNull('a.reversa_de'))
        .orderBy('m.id', 'asc')
        .select('c.codigo', 'm.debe', 'm.haber')
    return filas.map((f) => [f.codigo as string, f.debe as string, f.haber as string] as const)
}
