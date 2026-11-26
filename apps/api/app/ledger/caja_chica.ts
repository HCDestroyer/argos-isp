import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, Problema, ReglaNegocio } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { ajustesCajas } from '#ledger/custodia'

/**
 * Caja chica (B9 del plan de contabilidad, §5.7; decisiones del PM del 26 nov 2026).
 *
 * Una caja de `tipo = gastos` con **fondo fijo** (Q2,000 de fábrica, `cajas_ajustes.fondo_caja_chica`,
 * o el suyo en `cajas.fondo_fijo`). No tiene turnos ni recibe cobros. El efectivo solo se mueve así:
 *
 * - **Reposición** (`ledger.reposiciones`): desde la custodia de quien repone o desde un banco del
 *   libro, nunca desde una caja de cobros. Repone exactamente lo que falta para el fondo
 *   (fondo − efectivo en el libro) y sella los gastos y las diferencias de conteo pendientes.
 * - **Gasto** (`ledger.egresos` con `caja_id` de la caja chica): con comprobante obligatorio
 *   (`ledger.egresos_comprobantes`); sin tope por gasto (el PM: «el tope de gastos no se puede
 *   definir»): el único límite es el efectivo de la caja.
 * - **Conteo** (`ledger.conteos_caja`): sorpresa; la diferencia queda a cargo del encargado.
 *
 * Siempre se cumple: efectivo en el libro + gastos sin reponer − diferencias de conteo sin reponer =
 * fondo de la última reposición (0 antes de la primera).
 *
 * N2 (el gasto en efectivo sale solo de la caja chica): una vez que la empresa tiene una caja chica
 * activa, ningún egreso, compra al contado, pago a proveedor ni pago de impuesto sale de una caja de
 * cobros (422 `gasto_desde_caja_chica`). Mientras no la tenga, la vía de siempre sigue abierta (las
 * empresas que aún no la configuran no se quedan sin poder pagar un gasto en efectivo).
 */

/** El panel avisa para reponer cuando el efectivo baja de este % del fondo fijo (tablero `PlanCajas`). */
export const AVISO_REPONER_PCT = 30

export interface CajaChicaFila {
    id: number
    empresa_id: number
    nombre: string
    tipo: 'cobros' | 'gastos'
    cuenta_id: number
    cajero_id: number | null
    fondo_fijo: string | null
    activa: boolean
}

/** Fondo fijo configurado de una caja chica: el suyo o el de la empresa. */
export async function fondoFijoCajaChica(
    cliente: QueryClientContract,
    caja: { empresa_id: number; fondo_fijo: string | null },
): Promise<Dec> {
    if (caja.fondo_fijo !== null && caja.fondo_fijo !== undefined) return dec(caja.fondo_fijo)
    const ajustes = await ajustesCajas(Number(caja.empresa_id), cliente)
    return dec(ajustes.fondo_caja_chica)
}

/** La caja (404) con su tipo. */
export async function leerCaja(
    cliente: QueryClientContract,
    cajaId: number,
    bloquear = false,
): Promise<CajaChicaFila> {
    const consulta = cliente
        .from('ledger.cajas')
        .where('id', cajaId)
        .select('id', 'empresa_id', 'nombre', 'tipo', 'cuenta_id', 'cajero_id', 'fondo_fijo', 'activa')
    if (bloquear) consulta.forUpdate()
    const fila = (await consulta.first()) as CajaChicaFila | null
    if (!fila) throw new NoEncontrado(`La caja ${cajaId} no existe`)
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cuenta_id: Number(fila.cuenta_id),
        cajero_id: fila.cajero_id === null ? null : Number(fila.cajero_id),
    }
}

/** La caja chica (422 `no_es_caja_chica` si es de cobros; 422 `caja_inactiva`). */
export async function leerCajaChica(
    cliente: QueryClientContract,
    cajaId: number,
    bloquear = false,
): Promise<CajaChicaFila> {
    const caja = await leerCaja(cliente, cajaId, bloquear)
    if (caja.tipo !== 'gastos') {
        throw new ReglaNegocio(
            `La caja ${caja.nombre} es una caja de cobros, no una caja chica`,
            'no_es_caja_chica',
            [{ field: 'caja_id', message: 'Elige una caja chica', rule: 'tipo' }],
        )
    }
    if (!caja.activa) throw new ReglaNegocio(`La caja ${caja.nombre} está inactiva`, 'caja_inactiva')
    return caja
}

/** Saldo en el libro de la cuenta de una caja (su efectivo). */
export async function efectivoEnLibro(cliente: QueryClientContract, cuentaId: number): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.movimientos')
        .where('cuenta_id', cuentaId)
        .select(cliente.raw('coalesce(sum(debe - haber), 0)::text as saldo'))
        .first()) as { saldo: string }
    return dec(fila.saldo)
}

/** Gastos vigentes (no anulados) de la caja chica que aún no se reponen. */
export async function gastosSinReponer(cliente: QueryClientContract, cajaId: number) {
    return (await cliente
        .from('ledger.egresos as e')
        .leftJoin('ledger.egresos_comprobantes as ec', 'ec.egreso_id', 'e.id')
        .where('e.caja_id', cajaId)
        .whereNotExists((q) => q.from('ledger.egresos_anulaciones as an').whereRaw('an.egreso_id = e.id'))
        .whereNotExists((q) =>
            q
                .from('ledger.reposiciones_documentos as rd')
                .whereRaw(`rd.documento_tipo = 'egreso' AND rd.documento_id = e.id`),
        )
        .orderBy('e.id')
        .select('e.id', 'e.monto', 'ec.id as comprobante_id')) as Array<{
        id: number
        monto: string
        comprobante_id: number | null
    }>
}

/** Conteos con diferencia de la caja chica que aún no se reponen. */
export async function diferenciasSinReponer(cliente: QueryClientContract, cajaId: number) {
    return (await cliente
        .from('ledger.conteos_caja as k')
        .where('k.caja_id', cajaId)
        .whereNot('k.diferencia', 0)
        .whereNotExists((q) =>
            q
                .from('ledger.reposiciones_documentos as rd')
                .whereRaw(`rd.documento_tipo = 'conteo' AND rd.documento_id = k.id`),
        )
        .orderBy('k.id')
        .select('k.id', 'k.diferencia')) as Array<{ id: number; diferencia: string }>
}

/** Fondo vigente: el de la última reposición (0 si nunca se repuso). */
export async function fondoVigente(cliente: QueryClientContract, cajaId: number): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.reposiciones')
        .where('caja_id', cajaId)
        .orderBy('id', 'desc')
        .select('fondo')
        .first()) as { fondo: string } | null
    return dec(fila?.fondo ?? '0')
}

export interface EstadoCajaChica {
    caja_id: number
    empresa_id: number
    nombre: string
    encargado_id: number | null
    encargado_nombre: string | null
    /** fondo fijo configurado (el que dejará la próxima reposición) */
    fondo_fijo: string
    /** fondo de la última reposición (0 antes de la primera) */
    fondo_vigente: string
    /** efectivo que debe haber (saldo de su cuenta en el libro) */
    efectivo: string
    /** gastos vigentes sin reponer */
    comprobantes: { cantidad: number; monto: string; sin_archivo: number }
    /** diferencias de conteo sin reponer (contado − esperado) */
    diferencias: { cantidad: number; monto: string }
    /** efectivo + comprobantes − diferencias = fondo vigente */
    cuadra: boolean
    /** lo que repone la siguiente reposición (fondo fijo − efectivo) */
    por_reponer: string
    /** efectivo / fondo fijo, en % entero (0 si el fondo es 0) */
    porcentaje: number
    ultima_reposicion: { id: number; fecha: string; monto: string } | null
    ultimo_conteo: { id: number; fecha: string; diferencia: string } | null
}

/** `GET /cajas/:id/caja-chica`. */
export async function estadoCajaChica(
    cajaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoCajaChica> {
    const caja = await leerCaja(cliente, cajaId)
    if (caja.tipo !== 'gastos') {
        throw new ReglaNegocio(`La caja ${caja.nombre} no es una caja chica`, 'no_es_caja_chica')
    }
    const fondoFijo = await fondoFijoCajaChica(cliente, caja)
    const vigente = await fondoVigente(cliente, cajaId)
    const efectivo = await efectivoEnLibro(cliente, caja.cuenta_id)
    const gastos = await gastosSinReponer(cliente, cajaId)
    const diferencias = await diferenciasSinReponer(cliente, cajaId)
    const totalGastos = gastos.reduce((s, g) => s.plus(g.monto), CERO)
    const totalDiferencias = diferencias.reduce((s, d) => s.plus(d.diferencia), CERO)
    const encargado = caja.cajero_id
        ? ((await cliente.from('core.usuarios').where('id', caja.cajero_id).select('nombre').first()) as {
              nombre: string
          } | null)
        : null
    const reposicion = (await cliente
        .from('ledger.reposiciones')
        .where('caja_id', cajaId)
        .orderBy('id', 'desc')
        .select('id', 'monto', cliente.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
        .first()) as { id: number; monto: string; fecha: string } | null
    const conteo = (await cliente
        .from('ledger.conteos_caja')
        .where('caja_id', cajaId)
        .orderBy('id', 'desc')
        .select('id', 'diferencia', cliente.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
        .first()) as { id: number; diferencia: string; fecha: string } | null
    const porReponer = fondoFijo.minus(efectivo)
    return {
        caja_id: caja.id,
        empresa_id: caja.empresa_id,
        nombre: caja.nombre,
        encargado_id: caja.cajero_id,
        encargado_nombre: encargado?.nombre ?? null,
        fondo_fijo: aTexto(fondoFijo),
        fondo_vigente: aTexto(vigente),
        efectivo: aTexto(efectivo),
        comprobantes: {
            cantidad: gastos.length,
            monto: aTexto(totalGastos),
            sin_archivo: gastos.filter((g) => g.comprobante_id === null).length,
        },
        diferencias: { cantidad: diferencias.length, monto: aTexto(totalDiferencias) },
        cuadra: efectivo.plus(totalGastos).minus(totalDiferencias).eq(vigente),
        por_reponer: aTexto(porReponer.isNegative() ? CERO : porReponer),
        porcentaje: fondoFijo.gt(0) ? Math.floor(efectivo.div(fondoFijo).times(100).toNumber()) : 0,
        ultima_reposicion: reposicion
            ? { id: Number(reposicion.id), fecha: reposicion.fecha, monto: aTexto(reposicion.monto) }
            : null,
        ultimo_conteo: conteo
            ? { id: Number(conteo.id), fecha: conteo.fecha, diferencia: aTexto(conteo.diferencia) }
            : null,
    }
}

/** ¿La empresa tiene una caja chica activa? (regla N2) */
export async function empresaTieneCajaChica(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<boolean> {
    const fila = await cliente
        .from('ledger.cajas')
        .where('empresa_id', empresaId)
        .where('tipo', 'gastos')
        .where('activa', true)
        .select('id')
        .first()
    return Boolean(fila)
}

export type UsoSalidaCaja = 'egreso' | 'compra' | 'pago_proveedor' | 'pago_impuesto'

/**
 * Reglas del efectivo que sale de una caja (egreso, compra al contado, pago a proveedor o de
 * impuesto). Se llama con la caja ya resuelta y antes de insertar el documento:
 *
 * - Caja chica: solo gastos (egresos y compras al contado; 422 `caja_chica_solo_gastos` para pagos a
 *   proveedores o de impuestos) y hasta su efectivo (422 `efectivo_insuficiente`). Bloquea la caja
 *   para que dos gastos no saquen el mismo efectivo.
 * - Caja de cobros: 422 `gasto_desde_caja_chica` si la empresa ya tiene una caja chica activa (N2).
 */
export async function exigirSalidaDeCaja(
    cliente: QueryClientContract,
    cajaId: number,
    monto: Dec,
    uso: UsoSalidaCaja,
): Promise<{ caja_chica: boolean }> {
    // solo la caja chica se bloquea (una caja de cobros la ordena el lock de su turno)
    const caja = await leerCaja(cliente, cajaId)
    if (caja.tipo === 'gastos') {
        await leerCaja(cliente, cajaId, true)
        if (uso === 'pago_proveedor' || uso === 'pago_impuesto') {
            throw new Problema(
                422,
                'caja_chica_solo_gastos',
                'La caja chica solo paga gastos',
                `De la caja chica ${caja.nombre} solo salen gastos con su comprobante (egresos o compras al contado); este pago sale del banco o de la custodia`,
                [
                    {
                        field: 'caja_id',
                        message: 'La caja chica solo paga gastos',
                        rule: 'caja_chica_solo_gastos',
                    },
                ],
            )
        }
        const efectivo = await efectivoEnLibro(cliente, caja.cuenta_id)
        if (monto.gt(efectivo)) {
            throw new Problema(
                422,
                'efectivo_insuficiente',
                'Efectivo insuficiente en la caja chica',
                `La caja chica ${caja.nombre} tiene Q${aTexto(efectivo)}: no alcanza para Q${aTexto(monto)}. Repónla primero`,
                [
                    {
                        field: 'monto',
                        message: `Efectivo: Q${aTexto(efectivo)}`,
                        rule: 'efectivo_insuficiente',
                    },
                ],
            )
        }
        return { caja_chica: true }
    }
    if (await empresaTieneCajaChica(cliente, caja.empresa_id)) {
        throw new Problema(
            422,
            'gasto_desde_caja_chica',
            'Los gastos en efectivo salen de la caja chica',
            `La caja ${caja.nombre} es de cobros: solo entra dinero de clientes y solo sale por la entrega. El gasto en efectivo sale de la caja chica (decisión N2 del PM)`,
            [{ field: 'caja_id', message: 'Elige la caja chica', rule: 'gasto_desde_caja_chica' }],
        )
    }
    return { caja_chica: false }
}

/** ¿El egreso ya se repuso (sellado)? */
export async function egresoRepuesto(cliente: QueryClientContract, egresoId: number) {
    return (await cliente
        .from('ledger.reposiciones_documentos')
        .where('documento_tipo', 'egreso')
        .where('documento_id', egresoId)
        .select('reposicion_id')
        .first()) as { reposicion_id: number } | null
}

/** 409 `gasto_repuesto`: un gasto sellado por una reposición no se anula. */
export async function exigirGastoNoRepuesto(cliente: QueryClientContract, egresoId: number) {
    const sello = await egresoRepuesto(cliente, egresoId)
    if (sello) {
        throw new Problema(
            409,
            'gasto_repuesto',
            'Gasto ya repuesto',
            `El gasto ${egresoId} se repuso en la reposición ${sello.reposicion_id}: está sellado y ya no se anula. Una corrección se registra como otro movimiento`,
        )
    }
}

/*
|--------------------------------------------------------------------------
| Lecturas: reposiciones y conteos
|--------------------------------------------------------------------------
*/

export interface ReposicionVista {
    id: number
    empresa_id: number
    caja_id: number
    caja_nombre: string
    origen: 'custodia' | 'banco'
    custodio_id: number | null
    custodio_nombre: string | null
    banco_id: number | null
    cuenta_bancaria_id: number | null
    cuenta_codigo: string
    referencia: string | null
    monto: string
    fondo: string
    efectivo_antes: string
    fecha: string
    gastos: number
    conteos: number
    asiento_id: number | null
    registrado_por: number | null
    registrado_por_nombre: string | null
    created_at: Date
}

function consultaReposiciones(cliente: QueryClientContract) {
    return cliente
        .from('ledger.reposiciones as r')
        .join('ledger.cajas as c', 'c.id', 'r.caja_id')
        .join('ledger.cuentas as cu', 'cu.id', 'r.cuenta_id')
        .select(
            'r.id',
            'r.empresa_id',
            'r.caja_id',
            'c.nombre as caja_nombre',
            'r.origen',
            'r.custodio_id',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = r.custodio_id) AS custodio_nombre',
            ),
            'r.banco_id',
            'r.cuenta_bancaria_id',
            'cu.codigo as cuenta_codigo',
            'r.referencia',
            'r.monto',
            'r.fondo',
            'r.efectivo_antes',
            cliente.raw(`to_char(r.fecha, 'YYYY-MM-DD') as fecha`),
            cliente.raw(
                `(SELECT count(*)::int FROM ledger.reposiciones_documentos d WHERE d.reposicion_id = r.id AND d.documento_tipo = 'egreso') AS gastos`,
            ),
            cliente.raw(
                `(SELECT count(*)::int FROM ledger.reposiciones_documentos d WHERE d.reposicion_id = r.id AND d.documento_tipo = 'conteo') AS conteos`,
            ),
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'reposicion_caja' AND a.origen_id = r.id AND a.reversa_de IS NULL LIMIT 1) AS asiento_id`,
            ),
            'r.registrado_por',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = r.registrado_por) AS registrado_por_nombre',
            ),
            'r.created_at',
        )
}

function normalizarReposicion(f: ReposicionVista): ReposicionVista {
    const n = (v: number | null) => (v === null ? null : Number(v))
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        caja_id: Number(f.caja_id),
        custodio_id: n(f.custodio_id),
        banco_id: n(f.banco_id),
        cuenta_bancaria_id: n(f.cuenta_bancaria_id),
        asiento_id: n(f.asiento_id),
        registrado_por: n(f.registrado_por),
    }
}

export async function verReposicion(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaReposiciones(cliente).where('r.id', id).first()) as ReposicionVista | null
    if (!fila) throw new NoEncontrado(`La reposición ${id} no existe`)
    return normalizarReposicion(fila)
}

export async function listarReposiciones(cajaId: number, filtros: OpcionesPaginacion) {
    const pagina = await paginar<ReposicionVista>(
        consultaReposiciones(db.connection()).where('r.caja_id', cajaId),
        filtros,
        { columna: 'r.id' },
    )
    return { ...pagina, data: pagina.data.map(normalizarReposicion) }
}

export interface ConteoCajaVista {
    id: number
    empresa_id: number
    caja_id: number
    esperado: string
    contado: string
    diferencia: string
    comprobantes: string
    fondo: string
    motivo: string | null
    responsable_id: number | null
    responsable_nombre: string | null
    contado_por: number | null
    contado_por_nombre: string | null
    fecha: string
    asiento_id: number | null
    repuesto: boolean
    created_at: Date
}

function consultaConteos(cliente: QueryClientContract) {
    return cliente
        .from('ledger.conteos_caja as k')
        .select(
            'k.id',
            'k.empresa_id',
            'k.caja_id',
            'k.esperado',
            'k.contado',
            'k.diferencia',
            'k.comprobantes',
            'k.fondo',
            'k.motivo',
            'k.responsable_id',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = k.responsable_id) AS responsable_nombre',
            ),
            'k.contado_por',
            cliente.raw(
                '(SELECT u.nombre FROM core.usuarios u WHERE u.id = k.contado_por) AS contado_por_nombre',
            ),
            cliente.raw(`to_char(k.fecha, 'YYYY-MM-DD') as fecha`),
            cliente.raw(
                `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'conteo_caja' AND a.origen_id = k.id AND a.reversa_de IS NULL LIMIT 1) AS asiento_id`,
            ),
            cliente.raw(
                `EXISTS (SELECT 1 FROM ledger.reposiciones_documentos d WHERE d.documento_tipo = 'conteo' AND d.documento_id = k.id) AS repuesto`,
            ),
            'k.created_at',
        )
}

function normalizarConteo(f: ConteoCajaVista): ConteoCajaVista {
    const n = (v: number | null) => (v === null ? null : Number(v))
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        caja_id: Number(f.caja_id),
        responsable_id: n(f.responsable_id),
        contado_por: n(f.contado_por),
        asiento_id: n(f.asiento_id),
        repuesto: Boolean(f.repuesto),
    }
}

export async function verConteo(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaConteos(cliente).where('k.id', id).first()) as ConteoCajaVista | null
    if (!fila) throw new NoEncontrado(`El conteo ${id} no existe`)
    return normalizarConteo(fila)
}

export async function listarConteos(cajaId: number, filtros: OpcionesPaginacion) {
    const pagina = await paginar<ConteoCajaVista>(
        consultaConteos(db.connection()).where('k.caja_id', cajaId),
        filtros,
        { columna: 'k.id' },
    )
    return { ...pagina, data: pagina.data.map(normalizarConteo) }
}
