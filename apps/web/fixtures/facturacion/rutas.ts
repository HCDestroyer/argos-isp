import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    deLaEmpresa,
    empresaDeAccion,
    empresaActivaDe,
    idDe,
    noEncontrado,
    numeroQuery,
    paginar,
    registrarAccion,
    usuariosPorToken,
} from '../comun'
import { nombreCuentaDestino } from '../bancos/datos'
import { asientoPago, asientoReverso } from '../libro/datos'
import { nuevaSesion } from '../sesiones/datos'
import { dinero, estadoFactura } from './datos'
import { notasDeFactura, rutasNotasCredito } from './notasCredito'

type Factura = Schema<'Factura'>
type FacturaDetalle = Schema<'FacturaDetalle'>
type Pago = Schema<'Pago'>
type ServicioEvaluado = Schema<'ServicioEvaluado'>
type Errores = NonNullable<Problem['errors']>

const METODOS: readonly Pago['metodo'][] = ['caja', 'pasarela', 'deposito', 'transferencia', 'ach', 'remesa', 'agente', 'debito']

/** Como `DATOS_POR_METODO` de `registrarPago` (A3). */
const DATOS_POR_METODO: Partial<Record<Pago['metodo'], readonly ('referencia' | 'cuenta_bancaria_id' | 'banco_origen_id')[]>> = {
    deposito: ['cuenta_bancaria_id', 'referencia'],
    transferencia: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    ach: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    remesa: ['cuenta_bancaria_id', 'referencia'],
}
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const ESTADOS_FACTURA: readonly Factura['estado'][] = ['emitida', 'parcial', 'pagada', 'vencida', 'anulada']
const ESTADOS_PAGO: readonly Pago['estado'][] = ['registrado', 'pendiente_verificacion', 'anulado']

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
}

/** Como `ReglaNegocio` de la API: 422 con `type` `urn:argosisp:problema:<codigo>`. */
/** Como `Conflicto` de la API (`anularFactura`): 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

function reglaNegocio(codigo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: 'Regla de negocio', status: 422, detail: detalle }
    return { status: 422, cuerpo }
}

/** Motivo de anulación: 3 a 500 caracteres, como los validadores de anular de la API. */
function validarMotivo(solicitud: SolicitudFixture): string | Errores {
    const { motivo } = cuerpoObjeto(solicitud)
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    if (texto.length < 3 || texto.length > 500) {
        return [{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }]
    }
    return texto
}

/** Detalle de un aviso: una línea por el servicio del periodo (o la mora), como `facturas_lineas`. */
function detalle(factura: Factura): FacturaDetalle {
    const servicio = bd.servicios.find(s => s.id === factura.servicio_id)
    const plan = bd.planes.find(p => p.id === servicio?.plan_id)
    const mora = factura.tipo === 'mora'
    return {
        ...factura,
        acreditado: factura.acreditado ?? '0.00',
        notas_credito: notasDeFactura(factura.id),
        lineas: [{
            id: factura.id * 10 + 1,
            concepto: mora
                ? `Recargo por mora de la factura ${factura.factura_origen_id ?? ''}`.trim()
                : `Internet ${plan?.nombre ?? 'residencial'} · periodo ${factura.periodo.slice(0, 7)}`,
            tipo: mora ? 'mora' : 'servicio',
            cantidad: '1.000',
            precio_unitario: factura.subtotal,
            gravable: true,
            iva: factura.iva,
            total: factura.total,
        }],
        reglas_snapshot: {
            plantilla_facturacion_id: servicio?.plantilla_facturacion_id ?? null,
            dias_gracia: 0,
        },
    }
}

/** Revierte lo que el pago aplicó a cada factura (el pago anulado deja de contar). */
function desaplicar(pago: Pago): void {
    for (const aplicacion of pago.aplicaciones) {
        const factura = bd.facturas.find(f => f.id === aplicacion.factura_id)
        if (!factura) {
            continue
        }
        const pagado = Decimal.max(new Decimal(factura.pagado).minus(aplicacion.monto), 0)
        Object.assign(factura, {
            pagado: dinero(pagado),
            estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en),
            version: factura.version + 1,
            updated_at: ahora(),
        })
    }
}

/** Caja principal (cuenta "Caja principal"): la que usa `POST /pagos` con `caja` sin `caja_id`. */
export const CAJA_PRINCIPAL_ID = 1

function esMetodo(valor: unknown): valor is Pago['metodo'] {
    return typeof valor === 'string' && (METODOS as readonly string[]).includes(valor)
}

function textoOpcional(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/** Espejo del validador de `POST /pagos` (A3) más las reglas que la acción revisa en la base. */
function validar(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    const { cliente_id: clienteId, metodo, monto, caja_id: cajaId, referencia, nota } = cuerpo
    if (!bd.clientes.some(c => c.id === clienteId)) {
        errores.push({ field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' })
    }
    if (!esMetodo(metodo)) {
        errores.push({ field: 'metodo', message: 'Método de pago inválido', rule: 'enum' })
    }
    if (typeof monto !== 'string' || !MONTO.test(monto) || new Decimal(monto).lte(0)) {
        errores.push({ field: 'monto', message: 'El monto debe ser mayor que cero, con hasta 2 decimales', rule: 'regex' })
    }
    // Como la API: `caja` sin `caja_id` va a la caja principal; una caja elegida debe estar activa.
    if (metodo === 'caja' && cajaId !== undefined && cajaId !== null) {
        const caja = bd.cajas.find(c => c.id === cajaId)
        if (!caja?.activa) {
            errores.push({ field: 'caja_id', message: `La caja ${String(cajaId)} no existe o está inactiva`, rule: 'caja' })
        }
    }
    if (typeof referencia === 'string' && referencia.length > 100) {
        errores.push({ field: 'referencia', message: 'Máximo 100 caracteres', rule: 'maxLength' })
    }
    if (typeof nota === 'string' && nota.length > 500) {
        errores.push({ field: 'nota', message: 'Máximo 500 caracteres', rule: 'maxLength' })
    }
    errores.push(...validarBancarios(cuerpo))
    // Pago de terceros (A3): cada factura pedida puede ser de cualquier cliente, pero debe existir
    // y tener saldo; el error va en `facturas.<índice>`.
    if (Array.isArray(cuerpo.facturas)) {
        cuerpo.facturas.forEach((id: unknown, indice: number) => {
            const factura = bd.facturas.find(f => f.id === Number(id))
            if (!factura || factura.estado === 'pagada' || factura.estado === 'anulada') {
                errores.push({ field: `facturas.${indice}`, message: `La factura ${String(id)} no existe o no tiene saldo pendiente`, rule: 'factura_pendiente' })
            }
        })
    }
    return errores
}

/** Datos bancarios por método, como `datosBancarios` de `registrarPago`: un error por campo. */
function validarBancarios(cuerpo: Record<string, unknown>): Errores {
    if (!esMetodo(cuerpo.metodo)) {
        return []
    }
    const metodo = cuerpo.metodo
    const requeridos = DATOS_POR_METODO[metodo] ?? []
    const valores = {
        referencia: textoOpcional(cuerpo.referencia),
        cuenta_bancaria_id: typeof cuerpo.cuenta_bancaria_id === 'number' ? cuerpo.cuenta_bancaria_id : null,
        banco_origen_id: typeof cuerpo.banco_origen_id === 'number' ? cuerpo.banco_origen_id : null,
    }
    const errores: Errores = []
    for (const campo of requeridos) {
        if (valores[campo] === null) {
            errores.push({ field: campo, message: `Obligatorio con método ${metodo}`, rule: 'required' })
        }
    }
    for (const campo of ['cuenta_bancaria_id', 'banco_origen_id'] as const) {
        if (valores[campo] !== null && !requeridos.includes(campo)) {
            errores.push({ field: campo, message: `No aplica con método ${metodo}`, rule: 'no_aplica' })
        }
    }
    if (valores.cuenta_bancaria_id !== null && requeridos.includes('cuenta_bancaria_id')) {
        const cuenta = bd.cuentasBancarias.find(c => c.id === valores.cuenta_bancaria_id && c.activa)
        if (!cuenta) {
            errores.push({ field: 'cuenta_bancaria_id', message: `La cuenta bancaria ${valores.cuenta_bancaria_id} no existe o está inactiva`, rule: 'exists' })
        }
        else if (cuenta.moneda !== 'GTQ') {
            errores.push({ field: 'cuenta_bancaria_id', message: `La cuenta bancaria ${cuenta.id} es en ${cuenta.moneda}; los pagos se registran en quetzales`, rule: 'moneda' })
        }
    }
    if (valores.banco_origen_id !== null && requeridos.includes('banco_origen_id') && !bd.bancos.some(b => b.id === valores.banco_origen_id)) {
        errores.push({ field: 'banco_origen_id', message: `El banco ${valores.banco_origen_id} no existe`, rule: 'exists' })
    }
    return errores
}

/** 409 `referencia_duplicada`: la referencia es única por (método, cuenta bancaria, referencia). */
function referenciaRepetida(cuerpo: Record<string, unknown>): RespuestaFixture | null {
    const referencia = textoOpcional(cuerpo.referencia)
    if (!referencia) {
        return null
    }
    const cuenta = typeof cuerpo.cuenta_bancaria_id === 'number' ? cuerpo.cuenta_bancaria_id : null
    const repetido = bd.pagos.find(p => p.metodo === cuerpo.metodo && p.referencia === referencia && (p.cuenta_bancaria_id ?? null) === cuenta)
    if (!repetido) {
        return null
    }
    const cuerpoProblema: Problem = {
        type: 'urn:argosisp:problema:referencia_duplicada',
        title: 'Referencia duplicada',
        status: 409,
        detail: `La referencia ${referencia} ya está registrada en el pago ${repetido.id} (${String(cuerpo.metodo)}${cuenta ? `, cuenta bancaria ${cuenta})` : ')'}`,
    }
    return { status: 409, cuerpo: cuerpoProblema }
}

/** Facturas con saldo del cliente en el orden de `facturasPendientes` (vencimiento, periodo, id). */
function pendientesDe(clienteId: number) {
    return bd.facturas
        .filter(f => f.cliente_id === clienteId && f.estado !== 'pagada' && f.estado !== 'anulada')
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id)
}

/**
 * Lo que hace `evaluarEstadoServicio` dentro de `registrarPago` (misma transacción): cada
 * servicio cuyas facturas tocó el pago y que ya no debe facturas vencidas vuelve a `activo`, y el
 * Disconnect hace que el equipo vuelva a conectarse. Un servicio suspendido a mano no se toca.
 * Devuelve `Pago.servicios[]`.
 */
function evaluarServicios(servicioIds: number[]): ServicioEvaluado[] {
    const evaluados: ServicioEvaluado[] = []
    for (const servicioId of servicioIds) {
        const indice = bd.servicios.findIndex(s => s.id === servicioId)
        const servicio = bd.servicios[indice]
        if (!servicio) {
            continue
        }
        const base = { servicio_id: servicio.id, de: servicio.estado, estado: servicio.estado, cambiado: false }
        if (servicio.estado === 'retirado') {
            evaluados.push({ ...base, motivo: 'servicio retirado' })
            continue
        }
        if (servicio.suspension_manual) {
            evaluados.push({ ...base, motivo: 'suspensión manual' })
            continue
        }
        const vencidas = bd.facturas.filter(f => f.servicio_id === servicio.id && f.estado === 'vencida').length
        if (vencidas > 0 || servicio.estado === 'activo') {
            evaluados.push({ ...base, motivo: vencidas ? `${vencidas} ${vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}` : 'sin facturas vencidas' })
            continue
        }
        const momento = ahora()
        const activo = { ...servicio, estado: 'activo' as const, version: servicio.version + 1, updated_at: momento }
        bd.servicios[indice] = activo
        for (const sesion of bd.sesiones) {
            if (sesion.servicio_id === servicio.id && sesion.fin === null) {
                sesion.fin = momento
                sesion.causa_fin = 'Admin-Reset'
            }
        }
        bd.sesiones.push(nuevaSesion(siguienteId(bd.sesiones), activo, momento))
        const id = siguienteId(bd.acciones)
        bd.acciones.push({
            id,
            actor_tipo: 'sistema',
            actor_id: null,
            actor_nombre: null,
            canal: 'panel',
            accion: 'servicios.cambiar_estado',
            entidad_tipo: 'servicio',
            entidad_id: servicio.id,
            entrada: { servicioId: servicio.id, nuevo: 'activo', motivo: 'sin facturas vencidas' },
            resultado: 'ok',
            error: null,
            request_id: `req-fixture-${id}`,
            ...empresaDeAccion({ tipo: 'servicio', id: servicio.id }, null),
            created_at: momento,
        })
        evaluados.push({ ...base, estado: 'activo', cambiado: true, motivo: 'sin facturas vencidas' })
    }
    return evaluados
}

/** Facturas que tocaría el pago, en el orden de `registrarPago`: las pedidas y luego las más antiguas. */
function facturasEnOrden(clienteId: number, indicadas: number[] | null): Factura[] {
    const primero = (indicadas ?? []).map(id => bd.facturas.find(f => f.id === id)).filter((f): f is Factura => f !== undefined)
    return [...primero, ...pendientesDe(clienteId).filter(f => !primero.includes(f))]
}

/** Aplica `monto` a `facturas` en ese orden (sin pasar a otras); lo que sobra queda de anticipo. */
function aplicarEn(facturas: Factura[], monto: Decimal): Pago['aplicaciones'] {
    const aplicaciones: Pago['aplicaciones'] = []
    let resto = monto
    for (const factura of facturas) {
        if (resto.lte(0)) {
            break
        }
        const saldo = new Decimal(factura.total).minus(factura.pagado)
        const parte = Decimal.min(resto, saldo)
        if (parte.lte(0)) {
            continue
        }
        const pagado = new Decimal(factura.pagado).plus(parte)
        Object.assign(factura, {
            pagado: dinero(pagado),
            estado: estadoFactura(pagado, new Decimal(factura.total), factura.vence_en),
            version: factura.version + 1,
            updated_at: ahora(),
        })
        aplicaciones.push({
            factura_id: factura.id,
            monto: dinero(parte),
            cliente_id: factura.cliente_id,
            cliente_nombre: bd.clientes.find(c => c.id === factura.cliente_id)?.nombre ?? '',
        })
        resto = resto.minus(parte)
    }
    return aplicaciones
}

/** Lo que va a cada empresa: sus facturas (en orden) y el monto; el excedente, a la última. */
interface ParteEmpresa {
    empresaId: number
    facturas: Factura[]
    monto: Decimal
}

/**
 * Como el cobro repartido de `registrarPago` (A3): recorre las facturas en orden repartiendo el
 * monto y agrupa por la empresa de cada factura. Sin facturas que cubrir, todo a `porDefecto`.
 */
function repartir(facturas: Factura[], monto: Decimal, porDefecto: number): ParteEmpresa[] {
    const partes: ParteEmpresa[] = []
    let resto = monto
    for (const factura of facturas) {
        if (resto.lte(0)) {
            break
        }
        const parte = Decimal.min(resto, new Decimal(factura.total).minus(factura.pagado))
        if (parte.lte(0)) {
            continue
        }
        let grupo = partes.find(p => p.empresaId === (factura.empresa_id ?? 1))
        if (!grupo) {
            grupo = { empresaId: factura.empresa_id ?? 1, facturas: [], monto: new Decimal(0) }
            partes.push(grupo)
        }
        grupo.facturas.push(factura)
        grupo.monto = grupo.monto.plus(parte)
        resto = resto.minus(parte)
    }
    const ultima = partes.at(-1)
    if (!ultima) {
        return [{ empresaId: porDefecto, facturas: [], monto }]
    }
    ultima.monto = ultima.monto.plus(resto)
    return partes
}

/** Caja de una empresa para un cobro en efectivo: la pedida si es de esa empresa, si no una con turno abierto. */
function cajaDeEmpresa(empresaId: number, pedida: unknown, unaSola: boolean): number | null {
    const explicita = bd.cajas.find(c => c.id === pedida && c.empresa_id === empresaId)
    if (explicita) {
        return explicita.id
    }
    const abierta = bd.cajas.find(c => c.empresa_id === empresaId && c.activa && c.turno_abierto_id !== null)
    if (abierta) {
        return abierta.id
    }
    // Con una sola empresa en el cobro se conserva la caja principal como respaldo (empresa 1).
    return unaSola && empresaId === 1 ? CAJA_PRINCIPAL_ID : null
}

function problemaEmpresa(codigo: string, titulo: string, detalle: string, errores?: Errores): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 422, detail: detalle, ...(errores ? { errors: errores } : {}) }
    return { status: 422, cuerpo }
}

/**
 * Todo `POST /pagos` después del ACL: validar, 409 por referencia, repartir por empresa (un pago
 * por empresa con el mismo `cobro_id`), aplicar, asiento, bitácora y `servicios[]`. Lo reutiliza
 * `POST /comprobantes/:id/aprobar`, que registra el pago anidado.
 */
export function procesarPago(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validar(cuerpo)
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const repetida = referenciaRepetida(cuerpo)
    if (repetida) {
        return repetida
    }
    const clienteId = Number(cuerpo.cliente_id)
    const monto = new Decimal(String(cuerpo.monto))
    const indicadas = Array.isArray(cuerpo.facturas) ? cuerpo.facturas.filter((f): f is number => typeof f === 'number') : null
    const metodo = cuerpo.metodo as Pago['metodo']
    const requeridos = DATOS_POR_METODO[metodo] ?? []
    const cuenta = requeridos.includes('cuenta_bancaria_id') ? bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id) : undefined
    const banco = requeridos.includes('banco_origen_id') ? bd.bancos.find(b => b.id === cuerpo.banco_origen_id) : undefined
    const fija = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (cuenta?.empresa_id ?? null)

    let ordenadas = facturasEnOrden(clienteId, indicadas)
    if (fija !== null) {
        // Con la empresa fija (cuerpo o cuenta bancaria) no se reparte: facturas pedidas de otra son un 422.
        const ajena = (indicadas ?? []).map(id => bd.facturas.find(f => f.id === id)).find(f => f && (f.empresa_id ?? 1) !== fija)
        if (ajena && cuenta) {
            // Como la API: el error va en `facturas.<i>` de la factura ajena.
            return problemaEmpresa('cuenta_de_otra_empresa', 'Empresa distinta', `La cuenta bancaria ${cuenta.id} es de la empresa ${fija} y la factura ${ajena.id} es de la empresa ${ajena.empresa_id ?? 1}: no se cruzan dineros entre NIT`, [{ field: `facturas.${(indicadas ?? []).indexOf(ajena.id)}`, message: `La factura ${ajena.id} es de otra empresa`, rule: 'cuenta_de_otra_empresa' }])
        }
        ordenadas = ordenadas.filter(f => (f.empresa_id ?? 1) === fija)
    }
    const porDefecto = fija ?? empresaActivaDe(solicitud) ?? ordenadas[0]?.empresa_id ?? 1
    const partes = repartir(ordenadas, monto, porDefecto)
    if (partes.length > 1 && metodo !== 'caja') {
        return problemaEmpresa('pago_de_varias_empresas', 'Regla de negocio', `Las facturas pedidas son de varias empresas (${partes.map(p => p.empresaId).join(', ')}): un pago por ${metodo} es de una sola empresa`)
    }
    const cajasPorEmpresa = new Map<number, number | null>()
    if (metodo === 'caja') {
        for (const parte of partes) {
            const caja = cajaDeEmpresa(parte.empresaId, cuerpo.caja_id, partes.length === 1)
            if (caja === null) {
                const nombre = bd.empresas.find(e => e.id === parte.empresaId)?.nombre_comercial ?? `Empresa ${parte.empresaId}`
                const empresa = `${nombre} (empresa ${parte.empresaId})`
                return problemaEmpresa('caja_no_abierta', 'Caja no abierta', `No tienes una caja abierta en ${empresa}`, [{ field: 'empresa_id', message: `Abre una caja de ${empresa} para cobrar sus facturas en efectivo`, rule: String(parte.empresaId) }])
            }
            cajasPorEmpresa.set(parte.empresaId, caja)
        }
    }

    const momento = ahora()
    const usuario = usuarioDe(solicitud)
    const cobroId = siguienteId(bd.cobros)
    const pagos: Pago[] = []
    for (const parte of partes) {
        const pago: Pago = {
            id: siguienteId(bd.pagos),
            empresa_id: parte.empresaId,
            cobro_id: cobroId,
            cliente_id: clienteId,
            metodo,
            monto: dinero(parte.monto),
            comision: '0.00',
            referencia: textoOpcional(cuerpo.referencia),
            caja_id: metodo === 'caja' ? (cajasPorEmpresa.get(parte.empresaId) ?? null) : null,
            pasarela: null,
            estado: 'registrado',
            nota: textoOpcional(cuerpo.nota),
            registrado_por: usuario,
            historico: false,
            aplicaciones: aplicarEn(parte.facturas, parte.monto),
            anulado_en: null,
            motivo_anulacion: null,
            banco_origen_id: banco?.id ?? null,
            banco_origen_nombre: banco?.nombre ?? null,
            cuenta_bancaria_id: cuenta?.id ?? null,
            cuenta_bancaria_nombre: cuenta ? nombreCuentaDestino(cuenta) : null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.pagos.push(pago)
        bd.asientos.push(asientoPago(siguienteId(bd.asientos), pago))
        registrarAccion(solicitud, 'pagos.registrar', { tipo: 'pago', id: pago.id }, cuerpo)
        pagos.push(pago)
    }
    const total = pagos.reduce((suma, p) => suma.plus(p.monto), new Decimal(0))
    bd.cobros.push({ id: cobroId, cliente_id: clienteId, metodo, monto: dinero(total), registrado_por: usuario, created_at: momento, pagos: pagos.map(p => p.id) })
    const tocados = new Set(pagos.flatMap(p => p.aplicaciones)
        .map(a => bd.facturas.find(f => f.id === a.factura_id)?.servicio_id)
        .filter((id): id is number => typeof id === 'number'))
    const servicios = evaluarServicios([...tocados])
    const [primero] = pagos
    return { status: 201, cuerpo: { ...primero, pagos, servicios } }
}

/** Datos de marca de una empresa para el recibo (`EmpresaRecibo`). */
function empresaRecibo(id: number): Schema<'EmpresaRecibo'> {
    const empresa = bd.empresas.find(e => e.id === id)
    return {
        id,
        nombre_comercial: empresa?.nombre_comercial ?? `Empresa ${id}`,
        razon_social: empresa?.razon_social ?? null,
        nit: empresa?.nit ?? null,
        direccion_fiscal: empresa?.direccion_fiscal ?? null,
        telefono: empresa?.telefono ?? null,
        correo: empresa?.correo ?? null,
        logo_url: empresa?.logo_url ?? null,
    }
}

export const rutasFacturacion: RutasFixture = {
    ...rutasNotasCredito(evaluarServicios, detalle),

    'POST /api/v1/pagos': conPermiso('pagos.registrar', conIdempotencia(procesarPago)),

    'GET /api/v1/pagos': conPermiso('pagos.ver', (solicitud) => {
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const caja = numeroQuery(solicitud, 'caja_id')
        const metodo = solicitud.query.get('metodo')
        const estado = solicitud.query.get('estado')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        if (metodo && !esMetodo(metodo)) {
            return datosInvalidos([{ field: 'metodo', message: 'Método de pago inválido', rule: 'enum' }])
        }
        if (estado && !(ESTADOS_PAGO as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = deLaEmpresa(bd.pagos, solicitud)
            .filter(p => cliente === undefined || p.cliente_id === cliente)
            .filter(p => caja === undefined || p.caja_id === caja)
            .filter(p => !metodo || p.metodo === metodo)
            .filter(p => !estado || p.estado === estado)
            .filter(p => !desde || new Date(p.created_at) >= new Date(desde))
            .filter(p => !hasta || new Date(p.created_at) <= new Date(hasta))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/pagos/:id/anular': conPermiso('pagos.anular', conIdempotencia((solicitud) => {
        const pago = bd.pagos.find(p => p.id === idDe(solicitud))
        if (!pago) {
            return noEncontrado('el pago')
        }
        const motivo = validarMotivo(solicitud)
        if (Array.isArray(motivo)) {
            return datosInvalidos(motivo)
        }
        if (pago.estado === 'anulado') {
            return reglaNegocio('pago_anulado', `El pago ${pago.id} ya está anulado`)
        }
        const momento = ahora()
        desaplicar(pago)
        Object.assign(pago, { estado: 'anulado', anulado_en: momento, motivo_anulacion: motivo, version: pago.version + 1, updated_at: momento })
        const original = bd.asientos.find(a => a.origen_tipo === 'pago' && a.origen_id === pago.id && a.reversa_de === null)
        if (original) {
            bd.asientos.push(asientoReverso(siguienteId(bd.asientos), original, `Anulación del pago ${pago.id} · ${motivo}`, momento, usuarioDe(solicitud)))
        }
        registrarAccion(solicitud, 'pagos.anular', { tipo: 'pago', id: pago.id }, { motivo })
        return { status: 200, cuerpo: pago }
    })),

    'GET /api/v1/facturas': conPermiso('facturas.ver', (solicitud) => {
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const servicio = numeroQuery(solicitud, 'servicio_id')
        const estado = solicitud.query.get('estado')
        const periodo = solicitud.query.get('periodo')
        if (estado && !(ESTADOS_FACTURA as readonly string[]).includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        const filas = deLaEmpresa(bd.facturas, solicitud)
            .filter(f => cliente === undefined || f.cliente_id === cliente)
            .filter(f => servicio === undefined || f.servicio_id === servicio)
            .filter(f => !estado || f.estado === estado)
            .filter(f => !periodo || f.periodo === periodo)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/facturas/:id': conPermiso('facturas.ver', (solicitud) => {
        const factura = bd.facturas.find(f => f.id === idDe(solicitud))
        return factura ? { status: 200, cuerpo: detalle(factura) } : noEncontrado('la factura')
    }),

    /**
     * Como `anularFactura` (A3): una factura con pagos aplicados no se anula (409
     * `factura_con_pagos`, primero se anula el pago); al anular se revierte su asiento.
     */
    'POST /api/v1/facturas/:id/anular': conPermiso('facturas.anular', conIdempotencia((solicitud) => {
        const factura = bd.facturas.find(f => f.id === idDe(solicitud))
        if (!factura) {
            return noEncontrado('la factura')
        }
        const motivo = validarMotivo(solicitud)
        if (Array.isArray(motivo)) {
            return datosInvalidos(motivo)
        }
        if (factura.estado === 'anulada') {
            return conflicto('factura_anulada', 'Factura anulada', `La factura ${factura.id} ya está anulada`)
        }
        if (new Decimal(factura.pagado).gt(0)) {
            return conflicto('factura_con_pagos', 'Factura con pagos', `La factura ${factura.id} tiene pagos aplicados (factura ${factura.id}: Q${factura.pagado}); anula primero el pago`)
        }
        const momento = ahora()
        Object.assign(factura, { estado: 'anulada', anulada_en: momento, motivo_anulacion: motivo, version: factura.version + 1, updated_at: momento })
        const original = bd.asientos.find(a => a.origen_tipo === 'factura' && a.origen_id === factura.id && a.reversa_de === null)
        if (original) {
            bd.asientos.push(asientoReverso(siguienteId(bd.asientos), original, `Anulación de la factura ${factura.id} · ${motivo}`, momento, usuarioDe(solicitud)))
        }
        registrarAccion(solicitud, 'facturas.anular', { tipo: 'factura', id: factura.id }, { motivo })
        return { status: 200, cuerpo: factura }
    })),

    /** Recibo de un cobro (`Cobro`, A3): una sección por empresa con su marca y su pago. */
    'GET /api/v1/cobros/:id': conPermiso('pagos.ver', (solicitud) => {
        const cobro = bd.cobros.find(c => c.id === idDe(solicitud))
        if (!cobro) {
            return noEncontrado('el cobro')
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        // Solo las secciones de las empresas del alcance del usuario.
        const alcance = usuario?.alcance_global ? null : (usuario?.empresas ?? []).map(e => e.id)
        const secciones = cobro.pagos
            .map(id => bd.pagos.find(p => p.id === id))
            .filter((p): p is Pago => p !== undefined && (alcance === null || alcance.includes(p.empresa_id ?? 1)))
            .map(pago => ({ empresa: empresaRecibo(pago.empresa_id ?? 1), pago }))
        const recibo: Schema<'Cobro'> = {
            id: cobro.id,
            cliente_id: cobro.cliente_id,
            cliente_nombre: bd.clientes.find(c => c.id === cobro.cliente_id)?.nombre ?? '',
            metodo: cobro.metodo,
            monto: cobro.monto,
            registrado_por: cobro.registrado_por,
            created_at: cobro.created_at,
            secciones,
        }
        return { status: 200, cuerpo: recibo }
    }),

    'GET /api/v1/pagos/:id': conPermiso('pagos.ver', (solicitud) => {
        const pago = bd.pagos.find(p => p.id === idDe(solicitud))
        return pago ? { status: 200, cuerpo: pago } : noEncontrado('el pago')
    }),

    'GET /api/v1/cajas': conPermiso('cajas.ver', solicitud => ({ status: 200, cuerpo: deLaEmpresa(bd.cajas, solicitud) })),
}
