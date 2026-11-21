/**
 * Facturas de periodo a mano (A3, 19 nov; pedido del PM: pago por adelantado y periodos que el cron
 * no emitió). Como `periodos_facturables.ts` y `EmitirFacturasPeriodo` de la API:
 *
 * - `GET /servicios/:id/periodos-facturables?hasta=` (`facturas.ver`): los 24 periodos anteriores al
 *   inicio del servicio (`antes_del_inicio`) y los del servicio hasta el 12.º futuro con su estado,
 *   vencimiento (lo pasado a mano vence desde hoy), monto y lo que cubriría el saldo a favor.
 * - `POST /servicios/:id/facturas-periodo` (`facturas.emitir_periodos`, `Idempotency-Key`):
 *   `{ periodos }` o `{ hasta }`, `motivo` y `montos` (total editado, con
 *   `facturas.editar_monto_periodo` y motivo). Lo ocupado va en `omitidas`, nunca se duplica.
 *
 * Simplificación de los fixtures: periodos mensuales que empiezan el 1.º (como las facturas de la
 * semilla), sin prorrateo, por el precio mensual del servicio.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { dinero, estadoFactura, sumarDias } from '../facturacion/datos'
import { asientoFactura, fechaGuatemala } from '../libro/datos'

type Servicio = Schema<'Servicio'>
type Factura = Schema<'Factura'>
type PeriodoFacturable = Schema<'PeriodoFacturable'>
type PeriodosFacturables = Schema<'PeriodosFacturables'>
type MotivoNoEmitible = NonNullable<PeriodosFacturables['motivo']>
type Errores = NonNullable<Problem['errors']>

/** `MAXIMO_PERIODOS_FUTUROS` de la API. */
export const MAXIMO_PERIODOS_FUTUROS = 12
/** `MAXIMO_PERIODOS_ANTERIORES` de la API. */
export const MAXIMO_PERIODOS_ANTERIORES = 24
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

const DETALLE_NO_EMITIBLE: Record<MotivoNoEmitible, string> = {
    servicio_retirado: 'El servicio está retirado: no se le emiten facturas de periodo',
    servicio_pendiente_instalacion: 'El servicio está pendiente de instalación: sus periodos se facturan desde que se activa',
    sin_plantilla: 'El servicio no tiene plantilla de facturación',
}

interface Ocupacion {
    factura: Factura | null
    bonificacionId: number | null
}

interface PeriodoInterno {
    periodo: string
    hasta: string
    estado: PeriodoFacturable['estado']
    vence_en: string
    ocupacion: Ocupacion | null
}

function hoy(): string {
    return fechaGuatemala(ahora())
}

function mesSiguiente(periodo: string, meses = 1): string {
    const fecha = new Date(`${periodo.slice(0, 7)}-01T00:00:00Z`)
    fecha.setUTCMonth(fecha.getUTCMonth() + meses)
    return fecha.toISOString().slice(0, 10)
}

/** Como `vencimientoDe`: lo pasado a mano nunca vence antes de hoy + gracia. */
function vencimientoDe(periodo: string, estado: PeriodoFacturable['estado'], dia: string, gracia: number): string {
    const normal = sumarDias(periodo, gracia)
    if (estado !== 'antes_del_inicio' && estado !== 'antes_de_facturar_desde') {
        return normal
    }
    const desdeHoy = sumarDias(dia, gracia)
    return desdeHoy > normal ? desdeHoy : normal
}

function regla(codigo: string, detalle: string, campo = 'servicio_id'): RespuestaFixture {
    return problemaTipado(422, codigo, 'Regla de negocio', detalle, [{ field: campo, message: detalle, rule: codigo }])
}

function motivoNoEmitible(servicio: Servicio): MotivoNoEmitible | null {
    if (servicio.estado === 'retirado') {
        return 'servicio_retirado'
    }
    if (servicio.estado === 'pendiente_instalacion') {
        return 'servicio_pendiente_instalacion'
    }
    return servicio.plantilla_facturacion_id === null ? 'sin_plantilla' : null
}

function diasGracia(servicio: Servicio): number {
    const plantilla = bd.plantillas.find(p => p.id === servicio.plantilla_facturacion_id)
    return servicio.excepciones.dias_gracia ?? plantilla?.dias_gracia ?? 5
}

/** Factura vigente (o bonificación) en la clave `servicio_id-periodo`: la última no anulada. */
function ocupacionDe(servicio: Servicio, periodo: string): Ocupacion | null {
    const clave = `${servicio.id}-${periodo}`
    const facturas = bd.facturas.filter(f => f.servicio_id === servicio.id && (f.tipo ?? 'servicio') === 'servicio' && f.clave_unica?.split('#')[0] === clave)
    const vigente = [...facturas].reverse().find(f => f.estado !== 'anulada') ?? facturas.at(-1)
    if (vigente) {
        return { factura: vigente, bonificacionId: null }
    }
    const bonificacion = bd.bonificaciones.find(b => b.clave_unica === clave)
    return bonificacion ? { factura: null, bonificacionId: bonificacion.id } : null
}

/** Primer periodo del servicio: el de `facturacionServicios`, el mes de instalación o el más viejo ocupado. */
function inicioDe(servicio: Servicio): string {
    const fijado = bd.facturacionServicios[servicio.id]?.inicio
    if (fijado) {
        return fijado
    }
    const instalacion = `${(servicio.fecha_instalacion ?? hoy()).slice(0, 7)}-01`
    const ocupados = [
        ...bd.facturas.filter(f => f.servicio_id === servicio.id && f.clave_unica?.startsWith(`${servicio.id}-`)).map(f => f.periodo),
        ...bd.bonificaciones.filter(b => b.servicio_id === servicio.id && b.clave_unica.startsWith(`${servicio.id}-`)).map(b => b.periodo),
    ]
    return [instalacion, ...ocupados].sort()[0] ?? instalacion
}

/** Como `periodosDelServicio`: los 24 anteriores al inicio y hasta el 12.º futuro, con su estado. */
function periodosDe(servicio: Servicio, dia: string): PeriodoInterno[] {
    const facturarDesde = bd.facturacionServicios[servicio.id]?.facturar_desde ?? null
    const gracia = diasGracia(servicio)
    const inicio = inicioDe(servicio)
    const salida: PeriodoInterno[] = []
    let futuros = 0
    for (let periodo = mesSiguiente(inicio, -MAXIMO_PERIODOS_ANTERIORES); futuros < MAXIMO_PERIODOS_FUTUROS; periodo = mesSiguiente(periodo)) {
        if (periodo > dia) {
            futuros += 1
        }
        const ocupacion = ocupacionDe(servicio, periodo)
        let estado: PeriodoFacturable['estado']
        if (ocupacion) {
            estado = ocupacion.factura ? 'emitida' : 'bonificada'
        }
        else if (periodo < inicio) {
            estado = 'antes_del_inicio'
        }
        else if (periodo > dia) {
            estado = 'futuro'
        }
        else if (facturarDesde && periodo < facturarDesde) {
            estado = 'antes_de_facturar_desde'
        }
        else {
            estado = 'pendiente'
        }
        salida.push({ periodo, hasta: sumarDias(mesSiguiente(periodo), -1), estado, vence_en: ocupacion?.factura?.vence_en ?? vencimientoDe(periodo, estado, dia, gracia), ocupacion })
    }
    return salida
}

/** Como `saldoAnticipos`: lo que sobró de los pagos del cliente en la empresa del servicio. */
function saldoAFavor(servicio: Servicio): Decimal {
    const saldo = bd.pagos
        .filter(p => p.cliente_id === servicio.cliente_id && p.estado === 'registrado' && (p.empresa_id ?? 1) === (servicio.empresa_id ?? 1))
        .reduce((total, p) => total.plus(p.monto).minus(p.aplicaciones.reduce((suma, a) => suma.plus(a.monto), new Decimal(0))), new Decimal(0))
    return Decimal.max(saldo, 0)
}

function servicioDe(solicitud: SolicitudFixture): Servicio | RespuestaFixture {
    const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
    return servicio ?? noEncontrado('el servicio')
}

function esServicio(valor: Servicio | RespuestaFixture): valor is Servicio {
    return 'cliente_id' in valor
}

/** 422 `maximo_periodos_futuros` si `fecha` va más allá del último futuro permitido. */
function fueraDelMaximo(periodos: PeriodoInterno[], fecha: string, campo: string): RespuestaFixture | null {
    const ultimo = periodos.at(-1)
    if (!ultimo || fecha <= ultimo.hasta) {
        return null
    }
    return regla('maximo_periodos_futuros', `Se pueden emitir hasta ${MAXIMO_PERIODOS_FUTUROS} periodos futuros: el último empieza el ${ultimo.periodo}`, campo)
}

function vistaPrevia(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    if (!esServicio(servicio)) {
        return servicio
    }
    const hasta = solicitud.query.get('hasta')
    if (hasta !== null && hasta !== '' && !FECHA.test(hasta)) {
        return datosInvalidos([{ field: 'hasta', message: 'Fecha AAAA-MM-DD', rule: 'date' }])
    }
    const dia = hoy()
    const motivo = motivoNoEmitible(servicio)
    const todos = motivo ? [] : periodosDe(servicio, dia)
    if (hasta) {
        const fuera = fueraDelMaximo(todos, hasta, 'hasta')
        if (fuera) {
            return fuera
        }
    }
    const elegidos = hasta ? todos.filter(p => p.periodo <= hasta) : todos
    const saldo = saldoAFavor(servicio)
    const precio = new Decimal(servicio.precio_mensual ?? '0')
    // Como la simulación de la API: los libres se emiten en orden (los anteriores al inicio al final)
    // y el saldo a favor se aplica de la más antigua a la más nueva.
    let resto = saldo
    const cubiertos = new Map<string, Decimal>()
    for (const p of [...elegidos.filter(e => e.estado !== 'antes_del_inicio'), ...elegidos.filter(e => e.estado === 'antes_del_inicio')]) {
        if (!p.ocupacion) {
            const cubre = Decimal.min(resto, precio)
            resto = resto.minus(cubre)
            cubiertos.set(p.periodo, cubre)
        }
    }
    const periodos: PeriodoFacturable[] = elegidos.map((p) => {
        const factura = p.ocupacion?.factura ?? null
        let monto: string | null
        let pagado: string | null
        if (p.ocupacion) {
            monto = factura ? factura.total : '0.00'
            pagado = factura ? factura.pagado : '0.00'
        }
        else {
            monto = dinero(precio)
            pagado = dinero(cubiertos.get(p.periodo) ?? new Decimal(0))
        }
        return {
            periodo: p.periodo,
            hasta: p.hasta,
            dias: Number(p.hasta.slice(8, 10)),
            dias_ciclo: Number(p.hasta.slice(8, 10)),
            factor: '1',
            prorrateado: false,
            estado: p.estado,
            vence_en: p.vence_en,
            monto,
            pagado,
            factura_id: factura?.id ?? null,
            factura_estado: factura?.estado ?? null,
            bonificacion_id: p.ocupacion?.bonificacionId ?? null,
            sera_bonificacion: false,
            error: null,
        }
    })
    const cuerpo: PeriodosFacturables = {
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        empresa_id: servicio.empresa_id ?? 1,
        estado_servicio: servicio.estado,
        emitible: motivo === null,
        motivo,
        hoy: dia,
        facturar_desde: bd.facturacionServicios[servicio.id]?.facturar_desde ?? null,
        maximo_futuros: MAXIMO_PERIODOS_FUTUROS,
        maximo_anteriores: MAXIMO_PERIODOS_ANTERIORES,
        saldo_a_favor: dinero(saldo),
        periodos,
    }
    return { status: 200, cuerpo }
}

/** Aplica el saldo a favor del cliente a la factura nueva, con los pagos más viejos primero. */
function aplicarSaldo(servicio: Servicio, factura: Factura): Decimal {
    let aplicado = new Decimal(0)
    const pagos = bd.pagos
        .filter(p => p.cliente_id === servicio.cliente_id && p.estado === 'registrado' && (p.empresa_id ?? 1) === (servicio.empresa_id ?? 1))
        .sort((a, b) => a.id - b.id)
    for (const pago of pagos) {
        const libre = new Decimal(pago.monto).minus(pago.aplicaciones.reduce((s, a) => s.plus(a.monto), new Decimal(0)))
        const falta = new Decimal(factura.total).minus(aplicado)
        const parte = Decimal.min(libre, falta)
        if (parte.lte(0)) {
            continue
        }
        pago.aplicaciones.push({ factura_id: factura.id, monto: dinero(parte), cliente_id: factura.cliente_id, cliente_nombre: factura.cliente_nombre ?? '' })
        aplicado = aplicado.plus(parte)
    }
    return aplicado
}

function crearFactura(servicio: Servicio, p: PeriodoInterno, total: Decimal): Factura | null {
    const base = bd.facturas.find(f => !f.cargo_unico) ?? bd.facturas[0]
    if (!base) {
        return null
    }
    const momento = ahora()
    const subtotal = total.div('1.12').toDecimalPlaces(2)
    const factura: Factura = {
        ...structuredClone(base),
        id: siguienteId(bd.facturas),
        empresa_id: servicio.empresa_id ?? 1,
        empresa_nombre: bd.empresas.find(e => e.id === servicio.empresa_id)?.nombre_comercial ?? base.empresa_nombre,
        cliente_id: servicio.cliente_id,
        cliente_nombre: bd.clientes.find(c => c.id === servicio.cliente_id)?.nombre ?? '',
        servicio_id: servicio.id,
        periodo: p.periodo,
        clave_unica: `${servicio.id}-${p.periodo}`,
        emitida_en: momento,
        vence_en: p.vence_en,
        estado: 'emitida',
        subtotal: dinero(subtotal),
        iva: dinero(total.minus(subtotal)),
        total: dinero(total),
        pagado: '0.00',
        acreditado: '0.00',
        fel_uuid: null,
        fel_serie: null,
        fel_numero: null,
        fel_estado: null,
        dte_id: null,
        fel_error: null,
        tipo: 'servicio',
        factura_origen_id: null,
        vencida_en: null,
        anulada_en: null,
        motivo_anulacion: null,
        sustituida_por: null,
        sustituye_a: null,
        cargo_unico: false,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.facturas.push(factura)
    const pagado = aplicarSaldo(servicio, factura)
    factura.pagado = dinero(pagado)
    factura.estado = estadoFactura(pagado, total, factura.vence_en)
    bd.asientos.push(asientoFactura(siguienteId(bd.asientos), factura))
    return factura
}

function textoOpcional(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function emitir(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    if (!esServicio(servicio)) {
        return servicio
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const lista = Array.isArray(cuerpo.periodos) ? cuerpo.periodos : null
    const hasta = textoOpcional(cuerpo.hasta)
    const motivo = textoOpcional(cuerpo.motivo)
    if ((lista === null) === (hasta === null)) {
        return regla('periodos_o_hasta', 'Indique periodos o hasta, uno de los dos', 'periodos')
    }
    if (lista && (lista.length < 1 || lista.length > 60 || lista.some(p => typeof p !== 'string' || !FECHA.test(p)))) {
        errores.push({ field: 'periodos', message: 'De 1 a 60 fechas AAAA-MM-DD', rule: 'array' })
    }
    if (hasta !== null && !FECHA.test(hasta)) {
        errores.push({ field: 'hasta', message: 'Fecha AAAA-MM-DD', rule: 'date' })
    }
    if (motivo !== null && (motivo.length < 3 || motivo.length > 500)) {
        errores.push({ field: 'motivo', message: 'El motivo va de 3 a 500 caracteres', rule: 'minLength' })
    }
    const montos = new Map<string, string>()
    const listaMontos = Array.isArray(cuerpo.montos) ? cuerpo.montos : []
    for (const [i, m] of listaMontos.entries()) {
        const fila = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
        if (typeof fila.periodo !== 'string' || !FECHA.test(fila.periodo) || typeof fila.monto !== 'string' || !MONTO.test(fila.monto)) {
            errores.push({ field: `montos.${i}`, message: 'Periodo AAAA-MM-DD y monto con hasta 2 decimales', rule: 'regex' })
            continue
        }
        if (!new Decimal(fila.monto).gt(0)) {
            errores.push({ field: `montos.${i}.monto`, message: 'El monto debe ser mayor que cero, con hasta 2 decimales', rule: 'monto_positivo' })
            continue
        }
        montos.set(fila.periodo, fila.monto)
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const noEmitible = motivoNoEmitible(servicio)
    if (noEmitible) {
        return regla(noEmitible, DETALLE_NO_EMITIBLE[noEmitible])
    }
    const todos = periodosDe(servicio, hoy())
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    let elegidos: PeriodoInterno[]
    if (lista) {
        const pedidos = [...new Set(lista.filter((p): p is string => typeof p === 'string'))].sort()
        const ultimo = pedidos.at(-1)
        const fuera = ultimo ? fueraDelMaximo(todos, ultimo, 'periodos') : null
        if (fuera) {
            return fuera
        }
        const primero = todos[0]
        if (primero && pedidos[0] && pedidos[0] < primero.periodo) {
            return regla('maximo_periodos_anteriores', `Se pueden emitir hasta ${MAXIMO_PERIODOS_ANTERIORES} periodos anteriores al inicio del servicio: el primero empieza el ${primero.periodo}`, 'periodos.0')
        }
        elegidos = []
        for (const pedido of pedidos) {
            const periodo = todos.find(p => p.periodo === pedido)
            if (!periodo) {
                return regla('periodo_invalido', `${pedido} no es el inicio de un periodo del servicio`, 'periodos')
            }
            elegidos.push(periodo)
        }
        const anteriores = elegidos.filter(p => p.estado === 'antes_de_facturar_desde' || p.estado === 'antes_del_inicio')
        if (anteriores.length) {
            if (!usuario?.permisos.includes('facturas.emitir_periodo_anterior')) {
                return anteriores.some(p => p.estado === 'antes_del_inicio')
                    ? regla('antes_del_inicio', 'Un periodo anterior al inicio del servicio necesita el permiso facturas.emitir_periodo_anterior', 'periodos')
                    : regla('antes_de_facturar_desde', 'Un periodo anterior al inicio de la facturación necesita el permiso facturas.emitir_periodo_anterior', 'periodos')
            }
            if (motivo === null) {
                return datosInvalidos([{ field: 'motivo', message: 'Explique por qué se emite un periodo anterior al inicio', rule: 'motivo_requerido' }])
            }
        }
    }
    else {
        const fuera = fueraDelMaximo(todos, hasta ?? '', 'hasta')
        if (fuera) {
            return fuera
        }
        // «Todos hasta» nunca toma los anteriores al inicio ni a facturar_desde.
        elegidos = todos.filter(p => p.periodo <= (hasta ?? '') && p.estado !== 'antes_de_facturar_desde' && p.estado !== 'antes_del_inicio')
    }
    for (const periodo of montos.keys()) {
        if (!elegidos.some(p => p.periodo === periodo)) {
            return datosInvalidos([{ field: 'montos', message: `${periodo} no es uno de los periodos elegidos`, rule: 'periodo_invalido' }])
        }
    }
    const precio = new Decimal(servicio.precio_mensual ?? '0')
    const editados = elegidos.filter(p => !p.ocupacion && montos.has(p.periodo) && !new Decimal(montos.get(p.periodo)!).equals(precio))
    if (editados.length) {
        if (!usuario?.permisos.includes('facturas.editar_monto_periodo')) {
            return regla('editar_monto_sin_permiso', 'Cambiar el monto calculado requiere el permiso facturas.editar_monto_periodo', 'montos')
        }
        if (motivo === null) {
            return datosInvalidos([{ field: 'motivo', message: 'Explique por qué cambia el monto', rule: 'motivo_requerido' }])
        }
    }

    const respuesta: Schema<'FacturasPeriodoEmitidas'> = { servicio_id: servicio.id, cliente_id: servicio.cliente_id, creadas: [], bonificadas: [], omitidas: [], saldo_a_favor: '0.00' }
    for (const p of elegidos) {
        if (p.ocupacion) {
            respuesta.omitidas.push({
                periodo: p.periodo,
                motivo: p.ocupacion.factura ? 'ya_emitida' : 'bonificada',
                factura_id: p.ocupacion.factura?.id ?? null,
                bonificacion_id: p.ocupacion.bonificacionId,
            })
            continue
        }
        const pedido = montos.get(p.periodo)
        const factura = crearFactura(servicio, p, pedido ? new Decimal(pedido) : precio)
        if (!factura) {
            return problemaTipado(500, 'error_interno', 'Sin facturas de referencia en los fixtures')
        }
        respuesta.creadas.push({
            periodo: p.periodo,
            factura_id: factura.id,
            estado: factura.estado,
            total: factura.total,
            monto_calculado: dinero(precio),
            monto_editado: !new Decimal(factura.total).equals(precio),
            pagado: factura.pagado,
            vence_en: factura.vence_en,
        })
    }
    respuesta.saldo_a_favor = dinero(saldoAFavor(servicio))
    registrarAccion(solicitud, 'facturas.emitir_periodos', { tipo: 'servicio', id: servicio.id }, cuerpo)
    return { status: 200, cuerpo: respuesta }
}

export const rutasFacturasPeriodo: RutasFixture = {
    'GET /api/v1/servicios/:id/periodos-facturables': conPermiso('facturas.ver', vistaPrevia),
    'POST /api/v1/servicios/:id/facturas-periodo': conPermiso('facturas.emitir_periodos', conIdempotencia(emitir)),
}
