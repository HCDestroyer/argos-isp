/**
 * Rutas de la fase 4 · cobros (A3, §10.3 y §10.9): proveedores de cobro, cobros por liquidar,
 * liquidaciones y cierre de diferencias de un pago. Mismas validaciones y errores que la API
 * (capturados contra el backend real); el libro se simula con los movimientos bancarios.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { HOY_FIXTURES } from '../facturacion/datos'
import { bancosLibro, fechaGuatemala } from '../libro/datos'

type Errores = NonNullable<Problem['errors']>
type Proveedor = Schema<'ProveedorCobro'>
type Pago = Schema<'Pago'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function conflicto(codigo: string, titulo: string, detalle: string, errores?: Errores): RespuestaFixture {
    return problemaTipado(409, codigo, titulo, detalle, errores)
}

/** 422 con `type` propio (como `Problema(422, codigo…)` de la API). */
export function regla422(codigo: string, titulo: string, detalle: string, errores?: Errores): RespuestaFixture {
    return problemaTipado(422, codigo, titulo, detalle, errores)
}

/** 422 de validación con el `type` de VineJS de la API. */
export function invalido(errores: Errores): RespuestaFixture {
    return problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', errores)
}

/** Hoy en Guatemala (las fechas de corte y de documentos se validan contra el día real, como la API). */
export function hoy(): string {
    return fechaGuatemala(ahora())
}

export interface CuentaResuelta {
    cuenta_id: number
    codigo: string
    nombre: string
    cuenta_bancaria_id: number | null
    banco_id: number | null
    empresa_id: number
}

/** `Banco Industrial · Monetaria (****3456)`, como el nombre de la subcuenta que crea A3. */
function nombreCuentaPropia(cuenta: Schema<'CuentaBancaria'>): string {
    return `${cuenta.banco_nombre} · ${cuenta.alias} (****${cuenta.numero.replace(/\D/g, '').slice(-4)})`
}

/** Todas las subcuentas bancarias conocidas (cuentas propias y bancos del libro). */
export function cuentasBancoFixture(): CuentaResuelta[] {
    const lista: CuentaResuelta[] = bd.cuentasBancarias.map(c => ({ cuenta_id: c.cuenta_id, codigo: c.cuenta_codigo, nombre: nombreCuentaPropia(c), cuenta_bancaria_id: c.id, banco_id: null, empresa_id: c.empresa_id ?? 1 }))
    for (const banco of bancosLibro) {
        if (!lista.some(c => c.cuenta_id === banco.cuenta_id)) {
            lista.push({ cuenta_id: banco.cuenta_id, codigo: banco.cuenta_codigo, nombre: banco.cuenta_nombre, cuenta_bancaria_id: null, banco_id: banco.id, empresa_id: banco.empresa_id ?? 1 })
        }
    }
    return lista
}

/**
 * Como `resolverCuentaBanco` (A3): una de `cuenta_bancaria_id`, `banco_id` o `cuenta_id`. Sin
 * ninguna, `requerida` decide si es un 422 o `null`.
 */
export function resolverCuenta(cuerpo: Record<string, unknown>, campo: string, requerida: boolean): { ok: true, cuenta: CuentaResuelta | null } | { ok: false, respuesta: RespuestaFixture } {
    const cuentas = cuentasBancoFixture()
    let cuenta: CuentaResuelta | undefined
    if (typeof cuerpo.cuenta_bancaria_id === 'number') {
        cuenta = cuentas.find(c => c.cuenta_bancaria_id === cuerpo.cuenta_bancaria_id)
    }
    else if (typeof cuerpo.banco_id === 'number') {
        const banco = bancosLibro.find(b => b.id === cuerpo.banco_id)
        cuenta = banco ? cuentas.find(c => c.cuenta_id === banco.cuenta_id) : undefined
    }
    else if (typeof cuerpo.cuenta_id === 'number') {
        cuenta = cuentas.find(c => c.cuenta_id === cuerpo.cuenta_id)
    }
    else {
        if (!requerida) {
            return { ok: true, cuenta: null }
        }
        return { ok: false, respuesta: invalido([{ field: campo, message: 'Indica la cuenta bancaria (cuenta_bancaria_id, banco_id o cuenta_id)', rule: 'required' }]) }
    }
    if (!cuenta) {
        return { ok: false, respuesta: invalido([{ field: campo, message: 'La cuenta bancaria no existe', rule: 'exists' }]) }
    }
    return { ok: true, cuenta }
}

/** Días entre dos fechas `AAAA-MM-DD`. */
function diasEntre(desde: string, hasta: string): number {
    return Math.round((new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86_400_000)
}

/** `cobros_liquidar_dias` (parámetro de diseño de la empresa; 7 por defecto). */
const DIAS_LIMITE = 7

/** Contracargos pendientes de un proveedor: pagos liquidados y luego anulados que no se descontaron. */
function contracargosPendientes(proveedorId: number): Pago[] {
    return bd.pagos.filter(p => p.proveedor_cobro_id === proveedorId && p.estado === 'anulado' && p.liquidacion_id && !bd.contracargosLiquidados.includes(p.id))
}

/** Pagos vigentes del proveedor sin liquidar. */
function cobrosPendientes(proveedorId: number): Pago[] {
    return bd.pagos.filter(p => p.proveedor_cobro_id === proveedorId && p.estado === 'registrado' && !p.liquidacion_id)
}

/** Como `resumenCobrosPorLiquidar` (A3); la antigüedad se cuenta desde el "hoy" de los fixtures. */
function resumenProveedor(proveedor: Proveedor): Schema<'ResumenCobrosPorLiquidar'> {
    const aPorLiquidar = (pago: Pago, tipo: 'cobro' | 'contracargo'): Schema<'PagoPorLiquidar'> => {
        const fecha = fechaGuatemala(pago.created_at)
        return { pago_id: pago.id, tipo, cliente_id: pago.cliente_id, monto: pago.monto, referencia: pago.referencia, fecha, dias: Math.max(diasEntre(fecha, HOY_FIXTURES), 0) }
    }
    const pagos = [
        ...cobrosPendientes(proveedor.id).map(p => aPorLiquidar(p, 'cobro')),
        ...contracargosPendientes(proveedor.id).map(p => aPorLiquidar(p, 'contracargo')),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.pago_id - b.pago_id)
    const pendiente = pagos.reduce((suma, p) => (p.tipo === 'cobro' ? suma.plus(p.monto) : suma.minus(p.monto)), new Decimal(0))
    return {
        proveedor_cobro_id: proveedor.id,
        empresa_id: proveedor.empresa_id,
        metodo: proveedor.metodo,
        codigo: proveedor.codigo,
        nombre: proveedor.nombre,
        cuenta_codigo: proveedor.cuenta_codigo,
        saldo_libro: pendiente.toFixed(2),
        pendiente: pendiente.toFixed(2),
        diferencia: '0.00',
        cuadra: true,
        dias_limite: DIAS_LIMITE,
        pagos,
        anomalias: pagos.filter(p => p.tipo === 'cobro' && p.dias > DIAS_LIMITE),
    }
}

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
}

function crearProveedor(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const metodo = cuerpo.metodo
    if (metodo !== 'pasarela' && metodo !== 'agente' && metodo !== 'debito') {
        errores.push({ field: 'metodo', message: 'Método inválido (pasarela, agente, debito)', rule: 'enum' })
    }
    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
    if (nombre.length < 2 || nombre.length > 80) {
        errores.push({ field: 'nombre', message: 'El campo nombre debe tener al menos 2 caracteres', rule: 'minLength' })
    }
    const pasarela = typeof cuerpo.pasarela === 'string' ? cuerpo.pasarela.trim() : ''
    if (metodo !== 'pasarela' && pasarela) {
        errores.push({ field: 'pasarela', message: 'Solo aplica a pasarelas', rule: 'no_aplica' })
    }
    const desde = typeof cuerpo.desde === 'string' && cuerpo.desde ? cuerpo.desde : hoy()
    if (!FECHA.test(desde)) {
        errores.push({ field: 'desde', message: 'Fecha inválida', rule: 'date' })
    }
    else if (desde < hoy()) {
        errores.push({ field: 'desde', message: 'La fecha de corte no puede ser anterior a hoy', rule: 'fecha_pasada' })
    }
    if (errores.length) {
        return invalido(errores)
    }
    const banco = resolverCuenta(cuerpo, 'cuenta_bancaria_id', true)
    if (!banco.ok) {
        return banco.respuesta
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    const codigo = metodo === 'pasarela' ? (pasarela || 'pasarela').toLowerCase() : String(metodo)
    const repetido = bd.proveedoresCobro.find(p => p.empresa_id === empresaId && p.metodo === metodo && p.codigo === codigo)
    if (repetido) {
        return conflicto('proveedor_cobro_duplicado', 'Proveedor de cobro duplicado', `La empresa ${empresaId} ya tiene el proveedor ${String(metodo)} ${codigo} (${repetido.id})`)
    }
    const momento = ahora()
    const hijas = bd.cuentas.filter(c => c.codigo.startsWith('1.1.10.'))
    const siguiente = Math.max(0, ...hijas.map(c => Number(c.codigo.split('.').at(-1)))) + 1
    const cuentaPuente: Schema<'Cuenta'> = {
        id: siguienteId(bd.cuentas),
        codigo: `1.1.10.${String(siguiente).padStart(2, '0')}`,
        nombre: `Cobros por liquidar · ${nombre}`,
        tipo: 'activo',
        padre_id: null,
        imputable: true,
        auxiliar_cliente: false,
        empresa_id: empresaId,
        activa: true,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.cuentas.push(cuentaPuente)
    const proveedor: Proveedor = {
        id: siguienteId(bd.proveedoresCobro),
        empresa_id: empresaId,
        metodo: metodo as Proveedor['metodo'],
        codigo,
        nombre,
        cuenta_id: cuentaPuente.id,
        cuenta_codigo: cuentaPuente.codigo,
        cuenta_liquidacion_id: banco.cuenta?.cuenta_id ?? 6,
        cuenta_liquidacion_codigo: banco.cuenta?.codigo ?? '1.1.02.01',
        cuenta_liquidacion_nombre: banco.cuenta?.nombre ?? 'Banco principal',
        desde,
        activo: true,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.proveedoresCobro.push(proveedor)
    registrarAccion(solicitud, 'cobros.crear_proveedor', { tipo: 'proveedor_cobro', id: proveedor.id }, cuerpo)
    return { status: 201, cuerpo: proveedor }
}

function editarProveedor(solicitud: SolicitudFixture): RespuestaFixture {
    const proveedor = bd.proveedoresCobro.find(p => p.id === idDe(solicitud))
    if (!proveedor) {
        return noEncontrado('el proveedor de cobro')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== proveedor.version) {
        return versionCambiada()
    }
    // Como `EditarProveedorCobro` tras la revisión: sin pagos, `desde` (hoy o futura) y `activo` se
    // cambian; con pagos, mover `desde` o desactivarlo es 409 `proveedor_con_pagos`.
    const desde = typeof cuerpo.desde === 'string' && cuerpo.desde ? cuerpo.desde : proveedor.desde
    const desactiva = proveedor.activo && cuerpo.activo === false
    if (desde !== proveedor.desde || desactiva) {
        const pagos = bd.pagos.filter(p => p.proveedor_cobro_id === proveedor.id).length
        if (pagos) {
            return conflicto('proveedor_con_pagos', 'Proveedor con pagos', `El proveedor ${proveedor.nombre} ya tiene ${pagos} pago(s): no se mueve su fecha de corte ni se desactiva`)
        }
        if (desde !== proveedor.desde && (!FECHA.test(desde) || desde < hoy())) {
            return invalido([{ field: 'desde', message: 'La fecha de corte no puede ser anterior a hoy', rule: 'fecha_pasada' }])
        }
        proveedor.desde = desde
    }
    if (cuerpo.nombre !== undefined && cuerpo.nombre !== null) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 2 || nombre.length > 80) {
            return invalido([{ field: 'nombre', message: 'El campo nombre debe tener al menos 2 caracteres', rule: 'minLength' }])
        }
        proveedor.nombre = nombre
    }
    const banco = resolverCuenta(cuerpo, 'cuenta_bancaria_id', false)
    if (!banco.ok) {
        return banco.respuesta
    }
    if (banco.cuenta) {
        Object.assign(proveedor, { cuenta_liquidacion_id: banco.cuenta.cuenta_id, cuenta_liquidacion_codigo: banco.cuenta.codigo, cuenta_liquidacion_nombre: banco.cuenta.nombre })
    }
    if (typeof cuerpo.activo === 'boolean') {
        proveedor.activo = cuerpo.activo
    }
    Object.assign(proveedor, { version: proveedor.version + 1, updated_at: ahora() })
    registrarAccion(solicitud, 'cobros.editar_proveedor', { tipo: 'proveedor_cobro', id: proveedor.id }, cuerpo)
    return { status: 200, cuerpo: proveedor }
}

function idsDe(valor: unknown): number[] | null {
    if (valor === undefined || valor === null) {
        return []
    }
    return Array.isArray(valor) && valor.every(v => typeof v === 'number' && Number.isInteger(v) && v > 0) ? valor as number[] : null
}

/** Como `LiquidarCobros` (A3). */
function liquidar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const referencia = typeof cuerpo.referencia === 'string' ? cuerpo.referencia.trim() : ''
    if (!referencia) {
        errores.push({ field: 'referencia', message: 'El campo referencia es obligatorio', rule: 'required' })
    }
    if (typeof cuerpo.bruto !== 'string' || !/^-?\d{1,12}(\.\d{1,2})?$/.test(cuerpo.bruto)) {
        errores.push({ field: 'bruto', message: 'Monto con signo y hasta 2 decimales', rule: 'regex' })
    }
    if (typeof cuerpo.comision !== 'string' || !MONTO.test(cuerpo.comision)) {
        errores.push({ field: 'comision', message: 'Monto con hasta 2 decimales, como string', rule: 'regex' })
    }
    const pagos = idsDe(cuerpo.pagos)
    const contracargos = idsDe(cuerpo.contracargos)
    if (!pagos) {
        errores.push({ field: 'pagos', message: 'Lista de ids de pago', rule: 'array' })
    }
    if (!contracargos) {
        errores.push({ field: 'contracargos', message: 'Lista de ids de pago', rule: 'array' })
    }
    // H14: una liquidación puede traer solo contracargos.
    if (pagos && contracargos && !pagos.length && !contracargos.length) {
        errores.push({ field: 'pagos', message: 'La liquidación necesita pagos o contracargos', rule: 'required' })
    }
    const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : hoy()
    if (!FECHA.test(fecha) || fecha > hoy()) {
        errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
    }
    if (errores.length || !pagos || !contracargos) {
        return invalido(errores)
    }
    const proveedor = bd.proveedoresCobro.find(p => p.id === cuerpo.proveedor_cobro_id)
    if (!proveedor) {
        return invalido([{ field: 'proveedor_cobro_id', message: `El proveedor ${String(cuerpo.proveedor_cobro_id)} no existe`, rule: 'exists' }])
    }
    if (bd.liquidaciones.some(l => l.proveedor_cobro_id === proveedor.id && l.referencia === referencia)) {
        return conflicto('liquidacion_duplicada', 'Liquidación duplicada', `El proveedor ${proveedor.nombre} ya tiene la liquidación ${referencia}`)
    }
    const deEllos: Pago[] = []
    for (const [indice, id] of pagos.entries()) {
        const pago = bd.pagos.find(p => p.id === id)
        if (!pago || pago.proveedor_cobro_id !== proveedor.id) {
            return invalido([{ field: `pagos.${indice}`, message: `El pago ${id} no es de ${proveedor.nombre}`, rule: 'exists' }])
        }
        if (pago.liquidacion_id) {
            return conflicto('pago_ya_liquidado', 'Pago ya liquidado', 'Un pago se liquida una sola vez', [{ field: `pagos.${indice}`, message: `El pago ${id} ya está liquidado`, rule: 'pago_ya_liquidado' }])
        }
        if (pago.estado !== 'registrado') {
            return invalido([{ field: `pagos.${indice}`, message: `El pago ${id} está ${pago.estado}`, rule: 'pago_anulado' }])
        }
        deEllos.push(pago)
    }
    const descontados: Pago[] = []
    for (const [indice, id] of contracargos.entries()) {
        const pago = contracargosPendientes(proveedor.id).find(p => p.id === id)
        if (!pago) {
            return invalido([{ field: `contracargos.${indice}`, message: `El pago ${id} no es un contracargo pendiente de ${proveedor.nombre}`, rule: 'exists' }])
        }
        descontados.push(pago)
    }
    const esperado = deEllos.reduce((s, p) => s.plus(p.monto), new Decimal(0)).minus(descontados.reduce((s, p) => s.plus(p.monto), new Decimal(0)))
    const bruto = new Decimal(String(cuerpo.bruto))
    const comision = new Decimal(String(cuerpo.comision))
    if (!bruto.equals(esperado)) {
        return regla422('liquidacion_descuadrada', 'Liquidación descuadrada', `El bruto (Q${bruto.toFixed(2)}) no es la suma de los pagos menos los contracargos (Q${esperado.toFixed(2)})`, [{ field: 'bruto', message: `Σ pagos − contracargos = Q${esperado.toFixed(2)}`, rule: 'liquidacion_descuadrada' }])
    }
    const neto = bruto.minus(comision)
    if (neto.isNegative() && bruto.gt(0)) {
        return invalido([{ field: 'comision', message: 'La comisión no puede ser mayor que el bruto', rule: 'max' }])
    }
    if (typeof cuerpo.neto === 'string' && !new Decimal(cuerpo.neto).equals(neto)) {
        return invalido([{ field: 'neto', message: `El neto debe ser bruto − comisión (Q${neto.toFixed(2)})`, rule: 'neto' }])
    }
    const banco = resolverCuenta(cuerpo, 'cuenta_bancaria_id', false)
    if (!banco.ok) {
        return banco.respuesta
    }
    const cuentaId = banco.cuenta?.cuenta_id ?? proveedor.cuenta_liquidacion_id
    const codigo = banco.cuenta?.codigo ?? proveedor.cuenta_liquidacion_codigo
    const momento = ahora()
    const id = siguienteId(bd.liquidaciones)
    const asientoId = siguienteId(bd.asientos)
    const liquidacion: Schema<'LiquidacionCobro'> = {
        id,
        empresa_id: proveedor.empresa_id,
        proveedor_cobro_id: proveedor.id,
        proveedor_codigo: proveedor.codigo,
        proveedor_nombre: proveedor.nombre,
        fecha,
        referencia,
        bruto: bruto.toFixed(2),
        comision: comision.toFixed(2),
        neto: neto.toFixed(2),
        cuenta_id: cuentaId,
        cuenta_codigo: codigo,
        asiento_id: asientoId,
        archivo: typeof cuerpo.archivo === 'string' ? cuerpo.archivo : null,
        sha256: typeof cuerpo.sha256 === 'string' ? cuerpo.sha256 : null,
        nota: typeof cuerpo.nota === 'string' && cuerpo.nota.trim() ? cuerpo.nota.trim() : null,
        registrado_por: usuarioDe(solicitud),
        created_at: momento,
        pagos: [
            ...deEllos.map(p => ({ pago_id: p.id, tipo: 'cobro' as const, monto: p.monto })),
            ...descontados.map(p => ({ pago_id: p.id, tipo: 'contracargo' as const, monto: p.monto })),
        ],
    }
    bd.liquidaciones.push(liquidacion)
    for (const pago of deEllos) {
        pago.liquidacion_id = id
    }
    bd.contracargosLiquidados.push(...descontados.map(p => p.id))
    const descripcion = `Liquidación ${id} (${referencia}) de ${proveedor.nombre}: ${liquidacion.pagos.length} pago(s)`
    bd.asientos.push({
        id: asientoId,
        empresa_id: proveedor.empresa_id,
        fecha,
        descripcion,
        origen_tipo: 'liquidacion_cobro',
        origen_id: id,
        // el de la cuenta bancaria propia donde liquida (Banco Industrial = cuenta bancaria 2, la
        // del proveedor por defecto); una cuenta de banco sin cuenta bancaria propia cae en COB
        diario: banco.cuenta ? (banco.cuenta.cuenta_bancaria_id ? `BAN-${banco.cuenta.cuenta_bancaria_id}` : 'COB') : 'BAN-2',
        reversa_de: null,
        created_by: liquidacion.registrado_por,
        created_at: momento,
        movimientos: [
            { id: 95000 + id * 3, cuenta_id: cuentaId, cuenta_codigo: codigo, cuenta_nombre: banco.cuenta?.nombre ?? proveedor.cuenta_liquidacion_nombre, debe: neto.toFixed(2), haber: '0.00', cliente_id: null },
            { id: 95001 + id * 3, cuenta_id: 15, cuenta_codigo: '5.1.02', cuenta_nombre: 'Comisiones de pasarelas', debe: comision.toFixed(2), haber: '0.00', cliente_id: null },
            { id: 95002 + id * 3, cuenta_id: proveedor.cuenta_id, cuenta_codigo: proveedor.cuenta_codigo, cuenta_nombre: `Cobros por liquidar · ${proveedor.nombre}`, debe: '0.00', haber: bruto.toFixed(2), cliente_id: null },
        ].filter(m => !new Decimal(m.debe).plus(m.haber).isZero()),
    })
    bd.movimientosBanco.push({ movimiento_id: siguienteMovimientoBanco(), asiento_id: asientoId, origen_tipo: 'liquidacion_cobro', origen_id: id, fecha, descripcion, monto: neto.toFixed(2), cuenta_id: cuentaId, empresa_id: proveedor.empresa_id })
    registrarAccion(solicitud, 'cobros.liquidar', { tipo: 'liquidacion_cobro', id }, cuerpo)
    return { status: 201, cuerpo: liquidacion }
}

export function siguienteMovimientoBanco(): number {
    return bd.movimientosBanco.reduce((maximo, m) => Math.max(maximo, m.movimiento_id), 9000) + 1
}

/** Ids de los asientos `diferencia_cobro` de las fixtures (fuera de `bd.asientos`). */
const ASIENTOS_DIFERENCIA = 990000

/** `diferencia_cobro_tope` (parámetro de diseño de la empresa; Q1.00 por defecto). */
const TOPE_DIFERENCIA = new Decimal('1.00')

/**
 * Como `CerrarDiferenciaPago` (A3, decisión B): el saldo de cada factura del pago se cierra como gasto
 * con un asiento `diferencia_cobro` (Debe 5.3.05 Diferencias de cobro, Haber CxC del dueño), sin
 * tocar IVA ni DTE. `pagado` no cambia (solo dinero cobrado) y la factura queda `pagada`.
 */
function cerrarDiferencia(solicitud: SolicitudFixture): RespuestaFixture {
    const pago = bd.pagos.find(p => p.id === idDe(solicitud))
    if (!pago) {
        return noEncontrado('el pago')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (pago.estado !== 'registrado') {
        return conflicto('pago_anulado', 'Pago no vigente', `El pago ${pago.id} está ${pago.estado}`)
    }
    const facturas = [...new Set(pago.aplicaciones.map(a => a.factura_id))]
        .map(id => bd.facturas.find(f => f.id === id))
        .filter((f): f is Schema<'Factura'> => Boolean(f) && ['emitida', 'parcial', 'vencida'].includes(f?.estado ?? '') && new Decimal(f?.total ?? 0).gt(f?.pagado ?? 0))
    if (!facturas.length) {
        return conflicto('sin_diferencia', 'Sin diferencia', `El pago ${pago.id} no dejó saldo pendiente en sus facturas`)
    }
    const total = facturas.reduce((s, f) => s.plus(new Decimal(f.total).minus(f.pagado)), new Decimal(0))
    if (total.gt(TOPE_DIFERENCIA)) {
        return regla422('diferencia_sobre_tope', 'Diferencia sobre el tope', `El pago ${pago.id} deja Q${total.toFixed(2)} pendientes y el tope de la empresa es Q${TOPE_DIFERENCIA.toFixed(2)}`, [{ field: 'pago_id', message: `Diferencia Q${total.toFixed(2)} > tope Q${TOPE_DIFERENCIA.toFixed(2)}`, rule: 'diferencia_sobre_tope' }])
    }
    const motivo = typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim() ? cuerpo.motivo.trim() : `Diferencia de cobro del pago ${pago.id}`
    const momento = ahora()
    const fecha = fechaGuatemala(momento)
    const empresaId = pago.empresa_id ?? 1
    const diferencias = facturas.map((factura) => {
        const monto = new Decimal(factura.total).minus(factura.pagado).toFixed(2)
        const id = bd.diferenciasCerradas.reduce((maximo, d) => Math.max(maximo, d.id), 0) + 1
        // El asiento `diferencia_cobro` (Debe 5.3.05, Haber CxC) no entra en `bd.asientos`: el contrato
        // aún no declara ese `origen_tipo` (pedido a A3 en `a4.md`). Su id va en un rango propio.
        const asientoId = ASIENTOS_DIFERENCIA + id
        const descripcion = `Diferencia de cobro del pago ${pago.id} en la factura ${factura.id} · ${motivo}`
        bd.diferenciasCerradas.push({ id, empresa_id: empresaId, pago_id: pago.id, factura_id: factura.id, cliente_id: factura.cliente_id, monto, asiento_id: asientoId, fecha, descripcion, revertida_en: null })
        Object.assign(factura, { estado: 'pagada', version: factura.version + 1, updated_at: momento })
        return { factura_id: factura.id, diferencia_id: id, monto, asiento_id: asientoId }
    })
    registrarAccion(solicitud, 'pagos.cerrar_diferencia', { tipo: 'pago', id: pago.id }, cuerpo)
    const resultado: Schema<'DiferenciaCerrada'> = { pago_id: pago.id, empresa_id: empresaId, monto: total.toFixed(2), tope: TOPE_DIFERENCIA.toFixed(2), diferencias }
    return { status: 201, cuerpo: resultado }
}

export const rutasCobros: RutasFixture = {
    'GET /api/v1/cobros/proveedores': conPermiso('bancos.ver', solicitud => ({ status: 200, cuerpo: deLaEmpresa(bd.proveedoresCobro, solicitud) })),
    'POST /api/v1/cobros/proveedores': conPermiso('cobros.configurar', conIdempotencia(crearProveedor)),
    'PUT /api/v1/cobros/proveedores/:id': conPermiso('cobros.configurar', conIdempotencia(editarProveedor)),

    'GET /api/v1/cobros/por-liquidar': conPermiso('bancos.ver', solicitud => ({
        status: 200,
        cuerpo: deLaEmpresa(bd.proveedoresCobro, solicitud).map(resumenProveedor),
    })),

    'GET /api/v1/cobros/liquidaciones': conPermiso('bancos.ver', (solicitud) => {
        const proveedor = numeroQuery(solicitud, 'proveedor_cobro_id')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const filas = deLaEmpresa(bd.liquidaciones, solicitud)
            .filter(l => proveedor === undefined || l.proveedor_cobro_id === proveedor)
            .filter(l => !desde || l.fecha >= desde)
            .filter(l => !hasta || l.fecha <= hasta)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'GET /api/v1/cobros/liquidaciones/:id': conPermiso('bancos.ver', (solicitud) => {
        const liquidacion = bd.liquidaciones.find(l => l.id === idDe(solicitud))
        return liquidacion ? { status: 200, cuerpo: liquidacion } : noEncontrado('la liquidación')
    }),
    'POST /api/v1/cobros/liquidaciones': conPermiso('cobros.liquidar', conIdempotencia(liquidar)),

    'POST /api/v1/pagos/:id/cerrar-diferencia': conPermiso('pagos.cerrar_diferencia', conIdempotencia(cerrarDiferencia)),
}
