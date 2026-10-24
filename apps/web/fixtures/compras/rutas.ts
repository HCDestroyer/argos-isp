import Decimal from 'decimal.js'
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { fechaGuatemala } from '~/utils/libro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { inventarioDeCompra } from '../inventario/rutas'
import { resolverValor } from '../fiscal/rutas'
import { bancosLibro } from '../libro/datos'
import { CUENTAS_CLASE } from './fase5'

/**
 * Fase 5 (A3, contrato fiscal §19): proveedores (`proveedores.*`), compras (`compras.registrar`, desde un
 * egreso, anular y constancias emitidas), pagos a proveedores (`compras.pagar`), constancias, activos
 * fijos (`activos.*`), diferimientos (`libro.registrar_asiento`) y el reporte de cuentas por pagar. Como
 * la API: solo inserción con estados (anulada, anulado, dado de baja, cancelado), 409 y 422 con su código
 * y el saldo del proveedor = lo pendiente de sus compras al crédito vigentes.
 */

type Compra = Schema<'Compra'>
type Linea = Schema<'LineaCompra'>
type Proveedor = Schema<'Proveedor'>
type Activo = Schema<'ActivoFijo'>
type Diferimiento = Schema<'Diferimiento'>
type Pago = Schema<'PagoProveedor'>
type Errores = NonNullable<Problem['errors']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TASA = /^\d{1,3}(\.\d{1,2})?$/
const TIPOS_DOCUMENTO: readonly Compra['tipo_documento'][] = ['FACT', 'FCAM', 'FPEQ', 'FCAP', 'NCRE', 'NDEB', 'FESP', 'DUA', 'RECIBO']
const SIN_CREDITO: readonly Compra['tipo_documento'][] = ['FPEQ', 'FCAP', 'RECIBO']
const TIPOS_LINEA: readonly Linea['tipo'][] = ['bien', 'servicio', 'activo_fijo', 'combustible', 'importacion']
const CLASES = Object.keys(CUENTAS_CLASE)
const TIPOS_PROVEEDOR: readonly Proveedor['tipo'][] = ['general', 'pequeno_contribuyente', 'no_residente', 'sin_documento']
const DOCUMENTOS: readonly Proveedor['tipo_documento'][] = ['nit', 'cui', 'id_extranjero']
const REGIMENES = ['utilidades', 'opcional_simplificado', 'pequeno_contribuyente'] as const
/** Tope legal por clase (`depreciacion` del paquete gt-2026.1). */
const TOPES_PAQUETE: Record<string, string> = { otros: '10.00', edificios: '5.00', vehiculos: '20.00', equipo_red: '10.00', mobiliario: '20.00', computacion: '33.33', herramientas: '25.00' }
/** Retenciones emitidas que el fixture conoce: impuesto, tasa y sobre qué se calcula. */
const RETENCIONES: Record<string, { impuesto: 'iva' | 'isr', tasa: string, sobre: 'base' | 'iva' | 'total' }> = {
    RET_ISR_OPC_C: { impuesto: 'isr', tasa: '5.00', sobre: 'base' },
    RET_IVA_ESP_C: { impuesto: 'iva', tasa: '100.00', sobre: 'iva' },
    RET_IVA_PEQ_C: { impuesto: 'iva', tasa: '5.00', sobre: 'total' },
}
/** Cuenta de cada categoría de egreso (para las líneas que la eligen así). */
const CATEGORIAS: Record<string, { id: number, codigo: string }> = {
    energia: { id: 26, codigo: '5.2.01' },
    transito: { id: 27, codigo: '5.2.02' },
    nomina: { id: 28, codigo: '5.2.03' },
    vehiculos: { id: 29, codigo: '5.2.04' },
    alquileres: { id: 30, codigo: '5.2.05' },
    otros: { id: 31, codigo: '5.2.99' },
}
const CUENTA_POR_TIPO: Record<Linea['tipo'], { id: number, codigo: string }> = {
    bien: { id: 22, codigo: '1.1.14' },
    servicio: { id: 15, codigo: '5.1.02' },
    activo_fijo: { id: 40, codigo: '1.2.01' },
    combustible: { id: 29, codigo: '5.2.04' },
    importacion: { id: 22, codigo: '1.1.14' },
}

const cero = () => new Decimal(0)
const texto = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2)
const hoy = () => hoyGuatemala()

function codigo(status: number, clave: string, titulo: string, detalle: string, errors?: Errores): RespuestaFixture {
    return problemaTipado(status, clave, titulo, detalle, errors)
}

function usuarioId(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
}

function cadena(valor: unknown, max: number): string | null {
    if (typeof valor !== 'string') {
        return null
    }
    const limpio = valor.trim()
    return limpio ? limpio.slice(0, max) : null
}

function fechaDe(valor: unknown): string | null {
    return typeof valor === 'string' && FECHA.test(valor) ? valor : null
}

function sumarDias(fecha: string, dias: number): string {
    return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
    return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

function mesDe(fecha: string): string {
    return `${fecha.slice(0, 7)}-01`
}

function mesSiguiente(mes: string, n = 1): string {
    const [anio = 0, numero = 1] = mes.split('-').map(Number)
    return new Date(Date.UTC(anio, numero - 1 + n, 1)).toISOString().slice(0, 10)
}

function documentoDe(c: Pick<Compra, 'tipo_documento' | 'serie' | 'numero'>): string {
    return `${c.tipo_documento} ${c.serie ? `${c.serie}-` : ''}${c.numero}`
}

function empresaDe(solicitud: SolicitudFixture, cuerpo: Record<string, unknown>): number {
    return typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
}

/* ---------- Proveedores ---------- */

/** Saldo del auxiliar en 2.1.03: lo pendiente de sus compras al crédito vigentes. */
function saldoProveedor(id: number): Decimal {
    return bd.compras
        .filter(c => c.proveedor_id === id && c.estado === 'vigente' && c.condicion === 'credito' && c.tipo_documento !== 'NCRE')
        .reduce((s, c) => s.plus(c.saldo), cero())
}

function vistaProveedor(p: Proveedor): Proveedor {
    return { ...p, saldo: texto(saldoProveedor(p.id)) }
}

function nitValido(nit: string): boolean {
    // Dígito verificador del NIT de Guatemala (módulo 11; «K» = 10).
    const limpio = nit.replace(/[^0-9K]/gi, '').toUpperCase()
    if (limpio.length < 2) {
        return false
    }
    const cuerpo = limpio.slice(0, -1)
    const verificador = limpio.slice(-1)
    if (!/^\d+$/.test(cuerpo)) {
        return false
    }
    const suma = [...cuerpo].reverse().reduce((s, d, i) => s + Number(d) * (i + 2), 0)
    const esperado = (11 - (suma % 11)) % 11
    return verificador === (esperado === 10 ? 'K' : String(esperado))
}

function validarProveedor(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    if (!parcial || cuerpo.nombre !== undefined) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 2 || nombre.length > 150) {
            errores.push({ field: 'nombre', message: 'Nombre de 2 a 150 caracteres', rule: 'minLength' })
        }
    }
    if (cuerpo.tipo !== undefined && !TIPOS_PROVEEDOR.includes(cuerpo.tipo as Proveedor['tipo'])) {
        errores.push({ field: 'tipo', message: 'Tipo no válido', rule: 'enum' })
    }
    if (cuerpo.regimen_isr !== undefined && cuerpo.regimen_isr !== null && !(REGIMENES as readonly unknown[]).includes(cuerpo.regimen_isr)) {
        errores.push({ field: 'regimen_isr', message: 'Régimen no válido', rule: 'enum' })
    }
    if (cuerpo.dias_credito !== undefined && cuerpo.dias_credito !== null && (typeof cuerpo.dias_credito !== 'number' || !Number.isInteger(cuerpo.dias_credito) || cuerpo.dias_credito < 0 || cuerpo.dias_credito > 365)) {
        errores.push({ field: 'dias_credito', message: 'De 0 a 365 días', rule: 'range' })
    }
    if (typeof cuerpo.correo === 'string' && cuerpo.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.correo.trim())) {
        errores.push({ field: 'correo', message: 'Correo no válido', rule: 'email' })
    }
    return errores
}

/* ---------- Compras ---------- */

interface LineaCalculada {
    linea: Linea
    clase: string | null
    tasa: string | null
    residual: string | null
    activoDescripcion: string | null
    serie: string | null
    ubicacion: string | null
    diferirDesde: string | null
}

/** Valida y calcula las líneas: base e IVA (12 %) del total, salvo exentas o documentos sin crédito. */
function calcularLineas(entrada: unknown, tipoDocumento: Compra['tipo_documento'], errores: Errores): LineaCalculada[] {
    if (!Array.isArray(entrada) || !entrada.length) {
        errores.push({ field: 'lineas', message: 'Al menos una línea', rule: 'minLength' })
        return []
    }
    const siguiente = Math.max(0, ...bd.compras.flatMap(c => c.lineas.map(l => l.id))) + 1
    return entrada.map((bruta: unknown, i): LineaCalculada => {
        const l = (typeof bruta === 'object' && bruta !== null ? bruta : {}) as Record<string, unknown>
        const campo = (nombre: string) => `lineas.${i}.${nombre}`
        const descripcion = cadena(l.descripcion, 300)
        if (!descripcion) {
            errores.push({ field: campo('descripcion'), message: 'La descripción es obligatoria', rule: 'required' })
        }
        const tipo = (l.tipo ?? 'servicio') as Linea['tipo']
        if (!TIPOS_LINEA.includes(tipo)) {
            errores.push({ field: campo('tipo'), message: 'Tipo no válido', rule: 'enum' })
        }
        const total = typeof l.total === 'string' && MONTO.test(l.total) && new Decimal(l.total).gt(0) ? new Decimal(l.total) : null
        if (!total) {
            errores.push({ field: campo('total'), message: 'Total mayor que 0 con hasta 2 decimales', rule: 'monto' })
        }
        let cuenta = CUENTA_POR_TIPO[tipo] ?? CUENTA_POR_TIPO.servicio
        if (typeof l.categoria === 'string') {
            const categoria = CATEGORIAS[l.categoria]
            if (!categoria) {
                errores.push({ field: campo('categoria'), message: 'Categoría no válida', rule: 'enum' })
            }
            else {
                cuenta = categoria
            }
        }
        else if (typeof l.cuenta === 'string' && l.cuenta.trim()) {
            const encontrada = bd.cuentas.find(c => c.codigo === l.cuenta)
            if (!encontrada) {
                errores.push({ field: campo('cuenta'), message: `La cuenta ${l.cuenta} no existe`, rule: 'exists' })
            }
            else {
                cuenta = { id: encontrada.id, codigo: encontrada.codigo }
            }
        }
        const clase = typeof l.clase_activo === 'string' ? l.clase_activo : null
        if (tipo === 'activo_fijo' && (!clase || !CLASES.includes(clase))) {
            errores.push({ field: campo('clase_activo'), message: 'Elige la clase del activo', rule: 'required' })
        }
        if (tipo === 'activo_fijo' && clase) {
            cuenta = { id: 40, codigo: CUENTAS_CLASE[clase]?.activo ?? '1.2.01' }
        }
        const meses = l.diferir_meses
        if (meses !== undefined && meses !== null && (typeof meses !== 'number' || !Number.isInteger(meses) || meses < 2 || meses > 120)) {
            errores.push({ field: campo('diferir_meses'), message: 'De 2 a 120 meses', rule: 'range' })
        }
        if (typeof meses === 'number' && tipo === 'activo_fijo') {
            errores.push({ field: campo('diferir_meses'), message: 'Un activo fijo se deprecia, no se difiere', rule: 'no_aplica' })
        }
        const tasa = typeof l.activo_tasa_anual === 'string' && l.activo_tasa_anual ? l.activo_tasa_anual : null
        if (tasa !== null && !TASA.test(tasa)) {
            errores.push({ field: campo('activo_tasa_anual'), message: 'Por ciento con hasta 2 decimales', rule: 'regex' })
        }
        const exento = l.exento === true || SIN_CREDITO.includes(tipoDocumento)
        const totalLinea = total ?? cero()
        const ivaPedido = typeof l.iva === 'string' && MONTO.test(l.iva) ? new Decimal(l.iva) : null
        const iva = exento ? cero() : (ivaPedido ?? totalLinea.times(12).dividedBy(112).toDecimalPlaces(2))
        const cantidad = typeof l.cantidad === 'number' && Number.isInteger(l.cantidad) && l.cantidad >= 1 ? l.cantidad : 1
        return {
            linea: {
                id: siguiente + i,
                descripcion: descripcion ?? '',
                tipo,
                cuenta_id: cuenta.id,
                cuenta_codigo: cuenta.codigo,
                exento,
                base: texto(totalLinea.minus(iva)),
                iva: texto(iva),
                clase_activo: tipo === 'activo_fijo' ? clase : null,
                diferir_meses: typeof meses === 'number' ? meses : null,
                cantidad,
            },
            clase,
            tasa,
            residual: typeof l.activo_valor_residual === 'string' && MONTO.test(l.activo_valor_residual) ? l.activo_valor_residual : null,
            activoDescripcion: cadena(l.activo_descripcion, 300),
            serie: cadena(l.activo_serie, 100),
            ubicacion: cadena(l.activo_ubicacion, 200),
            diferirDesde: fechaDe(l.diferir_desde),
        }
    })
}

/** Retenciones pedidas o, sin el campo, las sugeridas (al régimen opcional se le retiene ISR). */
function calcularRetenciones(entrada: unknown, proveedor: Proveedor, base: Decimal, iva: Decimal, total: Decimal, errores: Errores): Schema<'RetencionCompra'>[] {
    const pedidas: { codigo: string, monto: string | null }[] = Array.isArray(entrada)
        ? entrada.map((r: unknown) => {
                const fila = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
                return { codigo: typeof fila.codigo === 'string' ? fila.codigo : '', monto: typeof fila.monto === 'string' && fila.monto ? fila.monto : null }
            })
        : proveedor.regimen_isr === 'opcional_simplificado' ? [{ codigo: 'RET_ISR_OPC_C', monto: null }] : []
    return pedidas.flatMap((r, i) => {
        const definicion = RETENCIONES[r.codigo]
        if (!definicion) {
            errores.push({ field: `retenciones.${i}.codigo`, message: `Impuesto de retención desconocido: ${r.codigo}`, rule: 'impuesto_inexistente' })
            return []
        }
        if (r.monto !== null && !MONTO.test(r.monto)) {
            errores.push({ field: `retenciones.${i}.monto`, message: 'Monto con hasta 2 decimales', rule: 'monto' })
            return []
        }
        const sobre = definicion.sobre === 'base' ? base : definicion.sobre === 'iva' ? iva : total
        const monto = r.monto !== null ? new Decimal(r.monto) : sobre.times(definicion.tasa).dividedBy(100).toDecimalPlaces(2)
        return [{ impuesto_codigo: r.codigo, impuesto: definicion.impuesto, base: texto(sobre), tasa: definicion.tasa, monto: texto(monto) }]
    })
}

function topeClase(empresaId: number, clase: string): string {
    const valor = resolverValor(empresaId, 'depreciacion', hoy())?.valor
    const topes = typeof valor === 'object' && valor !== null ? valor as Record<string, string> : TOPES_PAQUETE
    return topes[clase] ?? TOPES_PAQUETE[clase] ?? '10.00'
}

function cuotaMensual(costo: Decimal, residual: Decimal, tasa: string): Decimal {
    return costo.minus(residual).times(tasa).dividedBy(1200).toDecimalPlaces(2)
}

/** Alta de un activo (por la compra o directa). */
function nuevoActivo(datos: { empresaId: number, clase: string, descripcion: string, serie: string | null, ubicacion: string | null, fechaAlta: string, costo: Decimal, residual: Decimal, inicial: Decimal, tasa: string, compraId: number | null, lineaId: number | null, usuario: number | null }): Activo {
    const cuentas = CUENTAS_CLASE[datos.clase] ?? CUENTAS_CLASE.otros!
    const activo: Activo = {
        id: siguienteId(bd.activos),
        empresa_id: datos.empresaId,
        clase: datos.clase,
        descripcion: datos.descripcion,
        serie: datos.serie,
        ubicacion: datos.ubicacion,
        compra_id: datos.compraId,
        compra_linea_id: datos.lineaId,
        fecha_alta: datos.fechaAlta,
        inicio_depreciacion: mesSiguiente(mesDe(datos.fechaAlta)),
        costo: texto(datos.costo),
        valor_residual: texto(datos.residual),
        depreciacion_inicial: texto(datos.inicial),
        tasa_anual: new Decimal(datos.tasa).toFixed(2),
        cuota_mensual: texto(cuotaMensual(datos.costo, datos.residual, datos.tasa)),
        cuenta_activo_codigo: cuentas.activo,
        cuenta_depreciacion_codigo: cuentas.depreciacion,
        depreciacion_acumulada: texto(datos.inicial),
        valor_libros: texto(datos.costo.minus(datos.inicial)),
        cuotas: 0,
        ultima_cuota: null,
        estado: 'vigente',
        baja: null,
        registrado_por: datos.usuario,
        created_at: ahora(),
    }
    bd.activos.push(activo)
    return activo
}

function nuevoDiferimiento(datos: { empresaId: number, origen: Diferimiento['origen'], compraId: number | null, lineaId: number | null, facturaId: number | null, facturaLineaId: number | null, descripcion: string, destino: string, total: Decimal, inicio: string, meses: number, usuario: number | null }): Diferimiento {
    const diferimiento: Diferimiento = {
        id: siguienteId(bd.diferimientos),
        empresa_id: datos.empresaId,
        origen: datos.origen,
        factura_id: datos.facturaId,
        factura_linea_id: datos.facturaLineaId,
        compra_id: datos.compraId,
        compra_linea_id: datos.lineaId,
        descripcion: datos.descripcion,
        cuenta_diferida_codigo: datos.origen === 'compra' ? '1.1.13' : '2.1.12',
        cuenta_destino_codigo: datos.destino,
        total: texto(datos.total),
        inicio: mesDe(datos.inicio),
        meses: datos.meses,
        amortizado: '0.00',
        pendiente: texto(datos.total),
        cuotas: [],
        estado: 'vigente',
        registrado_por: datos.usuario,
        created_at: ahora(),
    }
    bd.diferimientos.push(diferimiento)
    return diferimiento
}

interface Medio {
    metodo: Pago['metodo']
    caja: Schema<'Caja'> | null
    banco: Schema<'BancoLibro'> | null
    cuenta: Schema<'CuentaBancaria'> | null
}

/** Caja, banco del libro o cuenta bancaria propia (los campos de los otros métodos no aplican). */
function medioDe(cuerpo: Record<string, unknown>, errores: Errores): Medio | null {
    const metodo = cuerpo.metodo
    if (metodo !== 'caja' && metodo !== 'banco' && metodo !== 'cuenta_bancaria') {
        errores.push({ field: 'metodo', message: 'Elige caja, banco o cuenta bancaria', rule: 'enum' })
        return null
    }
    const caja = metodo === 'caja' ? bd.cajas.find(c => c.id === cuerpo.caja_id) ?? null : null
    if (metodo === 'caja' && !caja) {
        errores.push({ field: 'caja_id', message: 'La caja es obligatoria', rule: 'required' })
    }
    if (caja && !caja.turno_abierto_id) {
        errores.push({ field: 'caja_id', message: 'La caja no tiene un turno abierto', rule: 'turno_cerrado' })
    }
    const banco = metodo === 'banco' ? bancosLibro.find(b => b.id === (cuerpo.banco_id ?? 1)) ?? null : null
    if (metodo === 'banco' && !banco) {
        errores.push({ field: 'banco_id', message: 'El banco no existe en el libro', rule: 'exists' })
    }
    const cuenta = metodo === 'cuenta_bancaria' ? bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id) ?? null : null
    if (metodo === 'cuenta_bancaria' && !cuenta) {
        errores.push({ field: 'cuenta_bancaria_id', message: 'La cuenta bancaria es obligatoria', rule: 'required' })
    }
    return { metodo, caja, banco, cuenta }
}

/** Egreso que paga una compra al contado (`compra_id`): su asiento es el de la compra. */
function egresoDeCompra(compra: Compra, medio: Medio, solicitud: SolicitudFixture): Schema<'Egreso'> {
    const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const momento = ahora()
    const egreso: Schema<'Egreso'> = {
        id: siguienteId(bd.egresos),
        empresa_id: compra.empresa_id,
        fecha: compra.fecha,
        categoria: 'otros',
        categoria_nombre: 'Otros',
        cuenta_codigo: compra.lineas[0]?.cuenta_codigo ?? '5.2.99',
        proveedor: compra.proveedor_nombre,
        descripcion: `Compra ${documentoDe(compra)}`,
        comprobante: documentoDe(compra),
        monto: compra.neto,
        metodo: medio.metodo,
        caja_id: medio.caja?.id ?? null,
        caja_nombre: medio.caja?.nombre ?? null,
        turno_id: medio.caja?.turno_abierto_id ?? null,
        banco_id: medio.banco?.id ?? null,
        banco_nombre: medio.banco?.nombre ?? null,
        cuenta_bancaria_id: medio.cuenta?.id ?? null,
        cuenta_bancaria_nombre: medio.cuenta ? `${medio.cuenta.banco_nombre} · ${medio.cuenta.alias}` : null,
        asiento_id: compra.asiento_id,
        compra_id: compra.id,
        estado: 'registrado',
        registrado_por: quien?.id ?? null,
        registrado_por_nombre: quien?.nombre ?? null,
        anulado_en: null,
        anulado_por: null,
        motivo_anulacion: null,
        asiento_reverso_id: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.egresos.push(egreso)
    return egreso
}

/** `RegistrarCompra` y `RegistrarCompraDesdeEgreso`: valida, calcula y guarda con sus activos y diferidos. */
function registrarCompra(solicitud: SolicitudFixture, egresoOrigen: Schema<'Egreso'> | null): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const proveedor = bd.proveedores.find(p => p.id === cuerpo.proveedor_id)
    if (!proveedor) {
        errores.push({ field: 'proveedor_id', message: 'Elige el proveedor', rule: 'exists' })
    }
    const tipoDocumento = cuerpo.tipo_documento as Compra['tipo_documento']
    if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) {
        errores.push({ field: 'tipo_documento', message: 'Tipo de documento no válido', rule: 'enum' })
    }
    const numero = cadena(cuerpo.numero, 40)
    if (!numero) {
        errores.push({ field: 'numero', message: 'El número es obligatorio', rule: 'required' })
    }
    const fechaDocumento = fechaDe(cuerpo.fecha_documento)
    if (!fechaDocumento) {
        errores.push({ field: 'fecha_documento', message: 'Fecha del documento (AAAA-MM-DD)', rule: 'date' })
    }
    else if (fechaDocumento > hoy()) {
        errores.push({ field: 'fecha_documento', message: 'La fecha del documento no puede ser futura', rule: 'futuro' })
    }
    if (typeof cuerpo.autorizacion === 'string' && cuerpo.autorizacion && !/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(cuerpo.autorizacion)) {
        errores.push({ field: 'autorizacion', message: 'UUID de autorización del DTE', rule: 'regex' })
    }
    const condicion: Compra['condicion'] = egresoOrigen ? 'contado' : (cuerpo.condicion === 'credito' ? 'credito' : 'contado')
    if (!egresoOrigen && cuerpo.condicion !== 'contado' && cuerpo.condicion !== 'credito') {
        errores.push({ field: 'condicion', message: 'Contado o crédito', rule: 'enum' })
    }
    const lineas = calcularLineas(cuerpo.lineas, TIPOS_DOCUMENTO.includes(tipoDocumento) ? tipoDocumento : 'FACT', errores)
    const medio = !egresoOrigen && condicion === 'contado' ? medioDe(cuerpo, errores) : null
    let referencia: Compra | undefined
    if (tipoDocumento === 'NCRE' || tipoDocumento === 'NDEB') {
        referencia = bd.compras.find(c => c.id === cuerpo.compra_referencia_id)
        if (tipoDocumento === 'NCRE' && !referencia) {
            errores.push({ field: 'compra_referencia_id', message: 'Una NCRE corrige una compra: elígela', rule: 'required' })
        }
    }
    if (tipoDocumento === 'NCRE' && condicion !== 'credito' && !egresoOrigen) {
        errores.push({ field: 'condicion', message: 'Una NCRE del proveedor va solo al crédito', rule: 'ncre_al_credito' })
    }
    const base = lineas.reduce((s, l) => s.plus(l.linea.base), cero())
    const iva = lineas.reduce((s, l) => s.plus(l.linea.iva), cero())
    const total = base.plus(iva)
    const retenciones = proveedor && tipoDocumento !== 'NCRE' ? calcularRetenciones(cuerpo.retenciones, proveedor, base, iva, total, errores) : []
    if (errores.length || !proveedor || !numero || !fechaDocumento) {
        return datosInvalidos(errores)
    }
    const empresaId = proveedor.empresa_id
    const serie = cadena(cuerpo.serie, 30) ?? ''
    if (bd.compras.some(c => c.estado === 'vigente' && c.proveedor_id === proveedor.id && c.tipo_documento === tipoDocumento && c.serie === serie && c.numero === numero)) {
        return codigo(409, 'compra_duplicada', 'Compra duplicada', `${tipoDocumento} ${serie ? `${serie}-` : ''}${numero} de ${proveedor.nombre} ya está registrada`)
    }
    if (referencia && (referencia.proveedor_id !== proveedor.id || referencia.estado !== 'vigente')) {
        return codigo(422, 'referencia_invalida', 'Regla de negocio', 'La compra que se corrige debe ser vigente y del mismo proveedor', [{ field: 'compra_referencia_id', message: 'Compra vigente del mismo proveedor', rule: 'referencia_invalida' }])
    }
    if (tipoDocumento === 'NCRE' && referencia && total.gt(referencia.saldo)) {
        return codigo(422, 'ncre_excede_saldo', 'Regla de negocio', `La NCRE (${texto(total)}) pasa del saldo de la compra (${referencia.saldo})`, [{ field: 'lineas', message: `Hasta ${referencia.saldo}`, rule: 'ncre_excede_saldo' }])
    }
    const retenido = retenciones.reduce((s, r) => s.plus(r.monto), cero())
    const neto = total.minus(retenido)
    if (egresoOrigen && !neto.equals(egresoOrigen.monto)) {
        return codigo(422, 'compra_distinta_del_egreso', 'Regla de negocio', `El neto de la compra (${texto(neto)}) debe ser el monto del egreso (${egresoOrigen.monto})`, [{ field: 'lineas', message: `Neto ${egresoOrigen.monto}`, rule: 'compra_distinta_del_egreso' }])
    }
    const periodoPedido = fechaDe(cuerpo.periodo_iva)
    const periodo = mesDe(periodoPedido ?? fechaDocumento)
    if (periodo < mesDe(fechaDocumento)) {
        return datosInvalidos([{ field: 'periodo_iva', message: 'El periodo del IVA no puede ser anterior al del documento', rule: 'periodo' }])
    }
    const creditoFiscal = !SIN_CREDITO.includes(tipoDocumento) && cuerpo.credito_fiscal !== false && iva.gt(0)
    const venceEn = condicion === 'credito' ? (fechaDe(cuerpo.vence_en) ?? sumarDias(fechaDocumento, proveedor.dias_credito)) : null
    const bases = (tipos: readonly Linea['tipo'][]) => texto(lineas.filter(l => !l.linea.exento && tipos.includes(l.linea.tipo)).reduce((s, l) => s.plus(l.linea.base), cero()))
    const fecha = fechaDocumento > periodo ? fechaDocumento : periodo
    const id = siguienteId(bd.compras)
    const usuario = usuarioId(solicitud)
    const compra: Compra = {
        id,
        empresa_id: empresaId,
        proveedor_id: proveedor.id,
        proveedor_nombre: proveedor.nombre,
        proveedor_nit: proveedor.nit,
        tipo_documento: tipoDocumento,
        serie,
        numero,
        autorizacion: cadena(cuerpo.autorizacion, 36),
        fecha_documento: fechaDocumento,
        periodo_iva: periodo,
        fecha,
        condicion,
        vence_en: venceEn,
        base_bienes: bases(['bien', 'activo_fijo', 'combustible']),
        base_servicios: bases(['servicio']),
        base_importaciones: bases(['importacion']),
        exento: texto(lineas.filter(l => l.linea.exento).reduce((s, l) => s.plus(l.linea.base), cero())),
        iva: texto(iva),
        total: texto(total),
        credito_fiscal: creditoFiscal,
        retencion_iva: texto(retenciones.filter(r => r.impuesto === 'iva').reduce((s, r) => s.plus(r.monto), cero())),
        retencion_isr: texto(retenciones.filter(r => r.impuesto === 'isr').reduce((s, r) => s.plus(r.monto), cero())),
        neto: texto(neto),
        saldo: condicion === 'credito' && tipoDocumento !== 'NCRE' ? texto(neto) : '0.00',
        compra_referencia_id: referencia?.id ?? null,
        egreso_id: egresoOrigen?.id ?? null,
        egreso_pago_id: null,
        descripcion: cadena(cuerpo.descripcion, 500),
        asiento_id: siguienteId(bd.asientos) + 9000,
        estado: 'vigente',
        anulado_en: null,
        anulado_por: null,
        motivo_anulacion: null,
        asiento_reverso_id: null,
        registrado_por: usuario,
        created_at: ahora(),
        lineas: lineas.map(l => l.linea),
        retenciones,
    }
    // Inventario (A3): las líneas `bien` con `producto_id` entran (o salen, en una NCRE) del kardex
    const inventario = inventarioDeCompra(compra, cuerpo.lineas, creditoFiscal)
    if (inventario) {
        return inventario
    }
    if (tipoDocumento === 'NCRE' && referencia) {
        referencia.saldo = texto(new Decimal(referencia.saldo).minus(total))
    }
    bd.compras.push(compra)
    if (medio) {
        compra.egreso_pago_id = egresoDeCompra(compra, medio, solicitud).id
    }
    for (const l of lineas) {
        const costo = creditoFiscal ? new Decimal(l.linea.base) : new Decimal(l.linea.base).plus(l.linea.iva)
        if (l.linea.tipo === 'activo_fijo' && l.clase) {
            nuevoActivo({ empresaId, clase: l.clase, descripcion: l.activoDescripcion ?? l.linea.descripcion, serie: l.serie, ubicacion: l.ubicacion, fechaAlta: fecha, costo, residual: new Decimal(l.residual ?? '0'), inicial: cero(), tasa: l.tasa ?? topeClase(empresaId, l.clase), compraId: id, lineaId: l.linea.id, usuario })
        }
        if (l.linea.diferir_meses) {
            nuevoDiferimiento({ empresaId, origen: 'compra', compraId: id, lineaId: l.linea.id, facturaId: null, facturaLineaId: null, descripcion: l.linea.descripcion, destino: l.linea.cuenta_codigo, total: costo, inicio: l.diferirDesde ?? fecha, meses: l.linea.diferir_meses, usuario })
        }
    }
    registrarAccion(solicitud, egresoOrigen ? 'compras.registrar_desde_egreso' : 'compras.registrar', { tipo: 'compra', id }, cuerpo)
    return { status: 201, cuerpo: compra }
}

/* ---------- Pagos a proveedores ---------- */

function pendientesDe(proveedorId: number): Compra[] {
    return bd.compras
        .filter(c => c.proveedor_id === proveedorId && c.estado === 'vigente' && c.condicion === 'credito' && c.tipo_documento !== 'NCRE' && new Decimal(c.saldo).gt(0))
        .sort((a, b) => (a.vence_en ?? '').localeCompare(b.vence_en ?? '') || a.id - b.id)
}

/* ---------- Activos y diferidos: cuotas hasta un mes ---------- */

function mesTerminadoHasta(cuerpo: Record<string, unknown>): string | RespuestaFixture {
    const anterior = mesSiguiente(mesDe(hoy()), -1)
    if (cuerpo.hasta === undefined || cuerpo.hasta === null || cuerpo.hasta === '') {
        return anterior
    }
    const pedido = fechaDe(cuerpo.hasta)
    if (!pedido) {
        return datosInvalidos([{ field: 'hasta', message: 'Fecha AAAA-MM-DD', rule: 'date' }])
    }
    if (mesDe(pedido) > anterior) {
        return codigo(422, 'mes_terminado', 'Regla de negocio', `Solo meses terminados: hasta ${anterior.slice(0, 7)}`, [{ field: 'hasta', message: `Hasta ${anterior.slice(0, 7)}`, rule: 'mes_terminado' }])
    }
    return mesDe(pedido)
}

function depreciarActivo(a: Activo, hasta: string): Decimal {
    let monto = cero()
    let mes = a.ultima_cuota ? mesSiguiente(a.ultima_cuota) : a.inicio_depreciacion
    const depreciable = new Decimal(a.costo).minus(a.valor_residual)
    while (a.estado === 'vigente' && mes <= hasta) {
        const restante = depreciable.minus(a.depreciacion_acumulada)
        if (restante.lte(0)) {
            break
        }
        const cuota = Decimal.min(new Decimal(a.cuota_mensual), restante)
        a.depreciacion_acumulada = texto(new Decimal(a.depreciacion_acumulada).plus(cuota))
        a.valor_libros = texto(new Decimal(a.costo).minus(a.depreciacion_acumulada))
        a.cuotas += 1
        a.ultima_cuota = mes
        monto = monto.plus(cuota)
        mes = mesSiguiente(mes)
    }
    return monto
}

function amortizar(d: Diferimiento, hasta: string): Decimal {
    let monto = cero()
    for (let i = d.cuotas.length; i < d.meses && d.estado === 'vigente'; i++) {
        const mes = mesSiguiente(d.inicio, i)
        if (mes > hasta) {
            break
        }
        const cuota = i === d.meses - 1 ? new Decimal(d.pendiente) : new Decimal(d.total).dividedBy(d.meses).toDecimalPlaces(2)
        d.cuotas.push({ mes, monto: texto(cuota), asiento_id: 9800 + d.id * 100 + i })
        d.amortizado = texto(new Decimal(d.amortizado).plus(cuota))
        d.pendiente = texto(new Decimal(d.total).minus(d.amortizado))
        if (new Decimal(d.pendiente).lte(0)) {
            d.estado = 'amortizado'
        }
        monto = monto.plus(cuota)
    }
    return monto
}

/* ---------- Rutas ---------- */

export const rutasCompras: RutasFixture = {
    'GET /api/v1/proveedores': conPermiso('proveedores.ver', (solicitud) => {
        const buscar = (solicitud.query.get('buscar') ?? '').trim().toLowerCase()
        const tipo = solicitud.query.get('tipo')
        const activo = solicitud.query.get('activo')
        const filas = deLaEmpresa(bd.proveedores, solicitud)
            .filter(p => !buscar || p.nombre.toLowerCase().includes(buscar) || p.nit.toLowerCase().includes(buscar.replace(/[^0-9a-z]/g, '')))
            .filter(p => !tipo || p.tipo === tipo)
            .filter(p => activo === null || activo === '' || String(p.activo) === activo)
            .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.id - b.id)
            .map(vistaProveedor)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/proveedores/:id/estado-cuenta': conPermiso('proveedores.ver', (solicitud) => {
        const proveedor = bd.proveedores.find(p => p.id === idDe(solicitud))
        if (!proveedor) {
            return noEncontrado('el proveedor')
        }
        const desde = fechaDe(solicitud.query.get('desde'))
        const hasta = fechaDe(solicitud.query.get('hasta')) ?? hoy()
        type Movimiento = Schema<'EstadoCuentaProveedor'>['movimientos'][number]
        const movimientos: Movimiento[] = []
        for (const c of bd.compras.filter(x => x.proveedor_id === proveedor.id && x.condicion === 'credito')) {
            const ncre = c.tipo_documento === 'NCRE'
            movimientos.push({ asiento_id: c.asiento_id ?? 0, fecha: c.fecha, tipo: ncre ? 'nota_credito' : 'compra', documento: documentoDe(c), descripcion: c.descripcion ?? c.lineas[0]?.descripcion ?? '', debe: ncre ? c.total : '0.00', haber: ncre ? '0.00' : c.neto, saldo: '0.00' })
            if (c.estado === 'anulada' && c.anulado_en) {
                movimientos.push({ asiento_id: c.asiento_reverso_id ?? 0, fecha: fechaGuatemala(c.anulado_en), tipo: 'anulacion', documento: documentoDe(c), descripcion: `Anulación: ${c.motivo_anulacion ?? ''}`, debe: ncre ? '0.00' : c.neto, haber: ncre ? c.total : '0.00', saldo: '0.00' })
            }
        }
        for (const p of bd.pagosProveedores.filter(x => x.proveedor_id === proveedor.id)) {
            movimientos.push({ asiento_id: p.asiento_id ?? 0, fecha: p.fecha, tipo: 'pago', documento: `Pago ${p.id}`, descripcion: p.referencia ?? p.descripcion ?? '', debe: p.monto, haber: '0.00', saldo: '0.00' })
            if (p.estado === 'anulado' && p.anulado_en) {
                movimientos.push({ asiento_id: p.asiento_reverso_id ?? 0, fecha: fechaGuatemala(p.anulado_en), tipo: 'anulacion', documento: `Pago ${p.id}`, descripcion: `Anulación: ${p.motivo_anulacion ?? ''}`, debe: '0.00', haber: p.monto, saldo: '0.00' })
            }
        }
        movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.asiento_id - b.asiento_id)
        let saldo = cero()
        let inicial = cero()
        const visibles: Movimiento[] = []
        for (const m of movimientos.filter(x => x.fecha <= hasta)) {
            saldo = saldo.plus(m.haber).minus(m.debe)
            if (desde && m.fecha < desde) {
                inicial = saldo
                continue
            }
            visibles.push({ ...m, saldo: texto(saldo) })
        }
        const cuerpo: Schema<'EstadoCuentaProveedor'> = {
            proveedor: vistaProveedor(proveedor),
            desde,
            hasta,
            saldo_inicial: texto(inicial),
            movimientos: visibles,
            saldo_final: texto(saldo),
            pendientes: pendientesDe(proveedor.id).map(c => ({ compra_id: c.id, documento: documentoDe(c), vence_en: c.vence_en ?? c.fecha, saldo: c.saldo, dias_vencida: Math.max(0, diasEntre(c.vence_en ?? c.fecha, hasta)) })),
        }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/proveedores/:id': conPermiso('proveedores.ver', (solicitud) => {
        const proveedor = bd.proveedores.find(p => p.id === idDe(solicitud))
        return proveedor ? { status: 200, cuerpo: vistaProveedor(proveedor) } : noEncontrado('el proveedor')
    }),

    'POST /api/v1/proveedores': conPermiso('proveedores.editar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validarProveedor(cuerpo, false)
        const tipoDocumento = (cuerpo.tipo_documento ?? 'nit') as Proveedor['tipo_documento']
        if (!DOCUMENTOS.includes(tipoDocumento)) {
            errores.push({ field: 'tipo_documento', message: 'NIT, CUI o identificación extranjera', rule: 'enum' })
        }
        const documento = typeof cuerpo.nit === 'string' ? cuerpo.nit.replace(/[\s-]/g, '').toUpperCase() : ''
        if (!documento) {
            errores.push({ field: 'nit', message: 'El documento es obligatorio', rule: 'required' })
        }
        else if (tipoDocumento === 'nit' && !nitValido(documento)) {
            errores.push({ field: 'nit', message: 'El NIT no es válido (dígito verificador)', rule: 'nit' })
        }
        else if (tipoDocumento === 'cui' && !/^\d{13}$/.test(documento)) {
            errores.push({ field: 'nit', message: 'El CUI tiene 13 dígitos', rule: 'cui' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (bd.proveedores.some(p => p.empresa_id === empresaId && p.activo && p.nit === documento && p.tipo_documento === tipoDocumento)) {
            return codigo(409, 'proveedor_duplicado', 'Proveedor duplicado', `La empresa ya tiene un proveedor activo con el documento ${documento}`)
        }
        const momento = ahora()
        const proveedor: Proveedor = {
            id: siguienteId(bd.proveedores),
            empresa_id: empresaId,
            tipo_documento: tipoDocumento,
            nit: documento,
            nombre: String(cuerpo.nombre).trim(),
            tipo: (cuerpo.tipo ?? (tipoDocumento === 'id_extranjero' ? 'no_residente' : 'general')) as Proveedor['tipo'],
            regimen_isr: (cuerpo.regimen_isr ?? null) as Proveedor['regimen_isr'],
            agente_retencion_iva: cuerpo.agente_retencion_iva === true,
            pais: typeof cuerpo.pais === 'string' && cuerpo.pais ? cuerpo.pais.toUpperCase() : 'GT',
            direccion: cadena(cuerpo.direccion, 300),
            correo: cadena(cuerpo.correo, 150),
            telefono: cadena(cuerpo.telefono, 40),
            dias_credito: typeof cuerpo.dias_credito === 'number' ? cuerpo.dias_credito : 0,
            activo: true,
            saldo: '0.00',
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.proveedores.push(proveedor)
        registrarAccion(solicitud, 'proveedores.crear', { tipo: 'proveedor', id: proveedor.id }, cuerpo)
        return { status: 201, cuerpo: proveedor }
    })),

    'PUT /api/v1/proveedores/:id': conPermiso('proveedores.editar', conIdempotencia((solicitud) => {
        const proveedor = bd.proveedores.find(p => p.id === idDe(solicitud))
        if (!proveedor) {
            return noEncontrado('el proveedor')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validarProveedor(cuerpo, true)
        for (const campo of ['nit', 'tipo_documento', 'pais'] as const) {
            if (cuerpo[campo] !== undefined && cuerpo[campo] !== null && cuerpo[campo] !== proveedor[campo]) {
                errores.push({ field: campo, message: 'No se edita', rule: 'campo_solo_lectura' })
            }
        }
        if (typeof cuerpo.version !== 'number') {
            errores.push({ field: 'version', message: 'La versión es obligatoria', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== proveedor.version) {
            return codigo(409, 'version_conflicto', 'Conflicto de versión', `El proveedor cambió (versión ${proveedor.version}): vuelve a cargarlo`)
        }
        for (const campo of ['nombre', 'tipo', 'regimen_isr', 'agente_retencion_iva', 'direccion', 'correo', 'telefono', 'dias_credito', 'activo'] as const) {
            if (cuerpo[campo] !== undefined) {
                Object.assign(proveedor, { [campo]: typeof cuerpo[campo] === 'string' ? (cuerpo[campo] as string).trim() || null : cuerpo[campo] })
            }
        }
        proveedor.version += 1
        proveedor.updated_at = ahora()
        registrarAccion(solicitud, 'proveedores.editar', { tipo: 'proveedor', id: proveedor.id }, cuerpo)
        return { status: 200, cuerpo: vistaProveedor(proveedor) }
    })),

    'GET /api/v1/compras': conPermiso('compras.ver', (solicitud) => {
        const { query } = solicitud
        const estado = query.get('estado')
        const tipo = query.get('tipo_documento')
        const condicion = query.get('condicion')
        const desde = query.get('desde')
        const hasta = query.get('hasta')
        const periodo = query.get('periodo_iva')
        const pendientes = query.get('pendientes') === 'true'
        const proveedor = numeroQuery(solicitud, 'proveedor_id')
        const filas = deLaEmpresa(bd.compras, solicitud)
            .filter(c => !estado || c.estado === estado)
            .filter(c => !tipo || c.tipo_documento === tipo)
            .filter(c => !condicion || c.condicion === condicion)
            .filter(c => proveedor === undefined || c.proveedor_id === proveedor)
            .filter(c => !desde || c.fecha_documento >= desde)
            .filter(c => !hasta || c.fecha_documento <= hasta)
            .filter(c => !periodo || c.periodo_iva.slice(0, 7) === periodo.slice(0, 7))
            .filter(c => !pendientes || (c.estado === 'vigente' && new Decimal(c.saldo).gt(0)))
            .sort((a, b) => b.fecha_documento.localeCompare(a.fecha_documento) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/compras/desde-egreso/:egresoId': conPermiso('compras.registrar', conIdempotencia((solicitud) => {
        const egreso = bd.egresos.find(e => e.id === idDe(solicitud, 'egresoId'))
        if (!egreso) {
            return noEncontrado('el egreso')
        }
        if (egreso.estado === 'anulado') {
            return codigo(409, 'egreso_anulado', 'Egreso anulado', `El egreso ${egreso.id} está anulado`)
        }
        if (egreso.compra_id) {
            return codigo(409, 'egreso_de_compra', 'Egreso de una compra', `El egreso ${egreso.id} paga la compra ${egreso.compra_id}: ya es una compra`)
        }
        const previa = bd.compras.find(c => c.egreso_id === egreso.id && c.estado === 'vigente')
        if (previa) {
            return codigo(409, 'egreso_con_compra', 'Egreso con compra', `El egreso ${egreso.id} ya se registró como la compra ${previa.id}`)
        }
        return registrarCompra(solicitud, egreso)
    })),

    'POST /api/v1/compras/:id/anular': conPermiso('compras.anular', conIdempotencia((solicitud) => {
        const compra = bd.compras.find(c => c.id === idDe(solicitud))
        if (!compra) {
            return noEncontrado('la compra')
        }
        const motivo = typeof cuerpoObjeto(solicitud).motivo === 'string' ? String(cuerpoObjeto(solicitud).motivo).trim() : ''
        if (motivo.length < 3 || motivo.length > 500) {
            return datosInvalidos([{ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' }])
        }
        if (compra.estado === 'anulada') {
            return codigo(409, 'compra_anulada', 'Compra anulada', `La compra ${compra.id} ya está anulada`)
        }
        if (bd.compras.some(c => c.compra_referencia_id === compra.id && c.tipo_documento === 'NCRE' && c.estado === 'vigente')) {
            return codigo(409, 'compra_con_notas', 'Compra con notas de crédito', 'Anula primero las NCRE del proveedor que la corrigen')
        }
        if (bd.pagosProveedores.some(p => p.estado === 'registrado' && p.aplicaciones.some(a => a.compra_id === compra.id))) {
            return codigo(409, 'compra_con_pagos', 'Compra con pagos', 'Anula primero los pagos aplicados a esta compra')
        }
        if (bd.constancias.some(c => c.compra_id === compra.id && c.vigente)) {
            return codigo(409, 'compra_con_constancia', 'Compra con constancia', 'Ya se emitió la constancia de retención de esta compra')
        }
        if (bd.activos.some(a => a.compra_id === compra.id && a.cuotas > 0)) {
            return codigo(409, 'activo_con_cuotas', 'Activo con cuotas', 'El activo de esta compra ya tiene depreciación registrada: dalo de baja')
        }
        if (bd.diferimientos.some(d => d.compra_id === compra.id && d.cuotas.length > 0 && d.estado !== 'cancelado')) {
            return codigo(409, 'diferido_con_cuotas', 'Diferido con cuotas', 'El diferimiento de esta compra ya tiene cuotas')
        }
        const momento = ahora()
        Object.assign(compra, { estado: 'anulada', saldo: '0.00', anulado_en: momento, anulado_por: usuarioId(solicitud), motivo_anulacion: motivo, asiento_reverso_id: (compra.asiento_id ?? 0) + 1 })
        if (compra.tipo_documento === 'NCRE' && compra.compra_referencia_id) {
            const referencia = bd.compras.find(c => c.id === compra.compra_referencia_id)
            if (referencia && referencia.estado === 'vigente') {
                referencia.saldo = texto(new Decimal(referencia.saldo).plus(compra.total))
            }
        }
        const egreso = bd.egresos.find(e => e.id === compra.egreso_pago_id)
        if (egreso) {
            Object.assign(egreso, { estado: 'anulado', anulado_en: momento, motivo_anulacion: `Compra ${compra.id} anulada: ${motivo}`, updated_at: momento })
        }
        for (const a of bd.activos.filter(x => x.compra_id === compra.id && x.estado === 'vigente')) {
            Object.assign(a, { estado: 'dado_de_baja', baja: { fecha: hoy(), tipo: 'anulacion', motivo, precio_venta: '0.00', valor_libros: a.valor_libros, asiento_id: null } })
        }
        for (const d of bd.diferimientos.filter(x => x.compra_id === compra.id && x.estado === 'vigente')) {
            d.estado = 'cancelado'
        }
        registrarAccion(solicitud, 'compras.anular', { tipo: 'compra', id: compra.id }, { motivo })
        return { status: 200, cuerpo: compra }
    })),

    'POST /api/v1/compras/:id/constancias': conPermiso('compras.registrar', conIdempotencia((solicitud) => {
        const compra = bd.compras.find(c => c.id === idDe(solicitud))
        if (!compra) {
            return noEncontrado('la compra')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const numero = cadena(cuerpo.numero, 60)
        const errores: Errores = []
        const retencion = compra.retenciones.find(r => r.impuesto_codigo === cuerpo.impuesto_codigo)
        if (!retencion) {
            errores.push({ field: 'impuesto_codigo', message: 'La compra no tiene esa retención', rule: 'exists' })
        }
        if (!numero) {
            errores.push({ field: 'numero', message: 'El número de la constancia es obligatorio', rule: 'required' })
        }
        const fecha = cuerpo.fecha === undefined || cuerpo.fecha === null || cuerpo.fecha === '' ? hoy() : fechaDe(cuerpo.fecha)
        if (!fecha || fecha > hoy()) {
            errores.push({ field: 'fecha', message: 'Fecha no futura (AAAA-MM-DD)', rule: 'date' })
        }
        if (errores.length || !retencion || !numero || !fecha) {
            return datosInvalidos(errores)
        }
        if (compra.estado === 'anulada') {
            return codigo(409, 'compra_anulada', 'Compra anulada', `La compra ${compra.id} está anulada`)
        }
        if (bd.constancias.some(c => c.compra_id === compra.id && c.impuesto_codigo === retencion.impuesto_codigo && c.vigente)) {
            return codigo(409, 'constancia_registrada', 'Constancia registrada', `La retención ${retencion.impuesto_codigo} de esta compra ya tiene su constancia`)
        }
        if (bd.constancias.some(c => c.direccion === 'emitida' && c.empresa_id === compra.empresa_id && c.impuesto === retencion.impuesto && c.numero === numero)) {
            return codigo(409, 'constancia_duplicada', 'Constancia duplicada', `Ya existe la constancia ${numero} de ${retencion.impuesto.toUpperCase()}`)
        }
        const constancia: Schema<'ConstanciaRetencion'> = {
            id: siguienteId(bd.constancias),
            empresa_id: compra.empresa_id,
            direccion: 'emitida',
            impuesto: retencion.impuesto,
            impuesto_codigo: retencion.impuesto_codigo,
            numero,
            fecha,
            monto: retencion.monto,
            pago_id: null,
            cliente_id: null,
            cliente_nombre: null,
            compra_id: compra.id,
            proveedor_id: compra.proveedor_id,
            proveedor_nombre: compra.proveedor_nombre,
            vigente: true,
            registrado_por: usuarioId(solicitud),
            created_at: ahora(),
        }
        bd.constancias.push(constancia)
        registrarAccion(solicitud, 'compras.registrar_constancia', { tipo: 'compra', id: compra.id }, cuerpo)
        return { status: 201, cuerpo: constancia }
    })),

    'GET /api/v1/compras/:id': conPermiso('compras.ver', (solicitud) => {
        const compra = bd.compras.find(c => c.id === idDe(solicitud))
        if (!compra) {
            return noEncontrado('la compra')
        }
        if (!deLaEmpresa([compra], solicitud).length) {
            return codigo(403, 'empresa_no_permitida', 'Empresa no permitida', `La compra ${compra.id} es de otra empresa`)
        }
        return { status: 200, cuerpo: compra }
    }),

    'POST /api/v1/compras': conPermiso('compras.registrar', conIdempotencia(solicitud => registrarCompra(solicitud, null))),

    'GET /api/v1/constancias': conPermiso('compras.ver', (solicitud) => {
        const { query } = solicitud
        const direccion = query.get('direccion')
        const impuesto = query.get('impuesto')
        const desde = query.get('desde')
        const hasta = query.get('hasta')
        const vigente = query.get('vigente')
        const filas = deLaEmpresa(bd.constancias, solicitud)
            .filter(c => !direccion || c.direccion === direccion)
            .filter(c => !impuesto || c.impuesto === impuesto)
            .filter(c => !desde || c.fecha >= desde)
            .filter(c => !hasta || c.fecha <= hasta)
            .filter(c => vigente === null || vigente === '' || String(c.vigente) === vigente)
            .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/pagos-proveedores': conPermiso('compras.ver', (solicitud) => {
        const proveedor = numeroQuery(solicitud, 'proveedor_id')
        const estado = solicitud.query.get('estado')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const filas = deLaEmpresa(bd.pagosProveedores, solicitud)
            .filter(p => proveedor === undefined || p.proveedor_id === proveedor)
            .filter(p => !estado || p.estado === estado)
            .filter(p => !desde || p.fecha >= desde)
            .filter(p => !hasta || p.fecha <= hasta)
            .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/pagos-proveedores/:id': conPermiso('compras.ver', (solicitud) => {
        const pago = bd.pagosProveedores.find(p => p.id === idDe(solicitud))
        return pago ? { status: 200, cuerpo: pago } : noEncontrado('el pago')
    }),

    'POST /api/v1/pagos-proveedores': conPermiso('compras.pagar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const proveedor = bd.proveedores.find(p => p.id === cuerpo.proveedor_id)
        if (!proveedor) {
            errores.push({ field: 'proveedor_id', message: 'Elige el proveedor', rule: 'exists' })
        }
        const monto = typeof cuerpo.monto === 'string' && MONTO.test(cuerpo.monto) && new Decimal(cuerpo.monto).gt(0) ? new Decimal(cuerpo.monto) : null
        if (!monto) {
            errores.push({ field: 'monto', message: 'Monto mayor que 0 con hasta 2 decimales', rule: 'monto' })
        }
        const fecha = cuerpo.fecha === undefined || cuerpo.fecha === null || cuerpo.fecha === '' ? hoy() : fechaDe(cuerpo.fecha)
        if (!fecha) {
            errores.push({ field: 'fecha', message: 'Fecha AAAA-MM-DD', rule: 'date' })
        }
        else if (fecha > hoy()) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        const medio = medioDe(cuerpo, errores)
        if (errores.length || !proveedor || !monto || !fecha || !medio) {
            return datosInvalidos(errores)
        }
        const pedidas = Array.isArray(cuerpo.compras) ? cuerpo.compras.filter((x): x is number => typeof x === 'number') : []
        const pendientes = pendientesDe(proveedor.id)
        const orden = [...pedidas.map(id => pendientes.find(c => c.id === id)).filter((c): c is Compra => c !== undefined), ...pendientes.filter(c => !pedidas.includes(c.id))]
        const total = orden.reduce((s, c) => s.plus(c.saldo), cero())
        if (monto.gt(total)) {
            return codigo(422, 'pago_excede_saldo', 'Regla de negocio', `El pago (${texto(monto)}) pasa del saldo pendiente del proveedor (${texto(total)})`, [{ field: 'monto', message: `Hasta ${texto(total)}`, rule: 'pago_excede_saldo' }])
        }
        const aplicaciones: Pago['aplicaciones'] = []
        let resto = monto
        for (const c of orden) {
            if (resto.lte(0)) {
                break
            }
            const aplicado = Decimal.min(resto, c.saldo)
            if (fecha < c.fecha) {
                errores.push({ field: 'fecha', message: `La compra ${c.id} es del ${c.fecha}`, rule: 'pago_anterior_a_compra' })
            }
            aplicaciones.push({ compra_id: c.id, documento: documentoDe(c), monto: texto(aplicado) })
            resto = resto.minus(aplicado)
        }
        if (errores.length) {
            return codigo(422, 'pago_anterior_a_compra', 'Regla de negocio', 'La fecha del pago es anterior a la fecha contable de una compra a la que aplicaría', errores)
        }
        for (const a of aplicaciones) {
            const c = bd.compras.find(x => x.id === a.compra_id)!
            c.saldo = texto(new Decimal(c.saldo).minus(a.monto))
        }
        const cuenta = medio.banco ? { id: medio.banco.cuenta_id, codigo: medio.banco.cuenta_codigo } : medio.caja ? { id: medio.caja.cuenta_id, codigo: '1.1.01.01' } : { id: medio.cuenta?.cuenta_id ?? 16, codigo: '1.1.02.02' }
        const pago: Pago = {
            id: siguienteId(bd.pagosProveedores),
            empresa_id: proveedor.empresa_id,
            proveedor_id: proveedor.id,
            proveedor_nombre: proveedor.nombre,
            fecha,
            metodo: medio.metodo,
            caja_id: medio.caja?.id ?? null,
            turno_id: medio.caja?.turno_abierto_id ?? null,
            banco_id: medio.banco?.id ?? null,
            cuenta_bancaria_id: medio.cuenta?.id ?? null,
            cuenta_id: cuenta.id,
            cuenta_codigo: cuenta.codigo,
            monto: texto(monto),
            referencia: cadena(cuerpo.referencia, 100),
            descripcion: cadena(cuerpo.descripcion, 500),
            asiento_id: 9700 + siguienteId(bd.pagosProveedores),
            estado: 'registrado',
            anulado_en: null,
            motivo_anulacion: null,
            asiento_reverso_id: null,
            registrado_por: usuarioId(solicitud),
            created_at: ahora(),
            aplicaciones,
        }
        bd.pagosProveedores.push(pago)
        registrarAccion(solicitud, 'compras.pagar', { tipo: 'pago_proveedor', id: pago.id }, cuerpo)
        return { status: 201, cuerpo: pago }
    })),

    'POST /api/v1/pagos-proveedores/:id/anular': conPermiso('compras.pagar', conIdempotencia((solicitud) => {
        const pago = bd.pagosProveedores.find(p => p.id === idDe(solicitud))
        if (!pago) {
            return noEncontrado('el pago')
        }
        const motivo = typeof cuerpoObjeto(solicitud).motivo === 'string' ? String(cuerpoObjeto(solicitud).motivo).trim() : ''
        if (motivo.length < 3 || motivo.length > 500) {
            return datosInvalidos([{ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' }])
        }
        if (pago.estado === 'anulado') {
            return codigo(409, 'pago_anulado', 'Pago anulado', `El pago ${pago.id} ya está anulado`)
        }
        for (const a of pago.aplicaciones) {
            const c = bd.compras.find(x => x.id === a.compra_id)
            if (c && c.estado === 'vigente') {
                c.saldo = texto(new Decimal(c.saldo).plus(a.monto))
            }
        }
        Object.assign(pago, { estado: 'anulado', anulado_en: ahora(), motivo_anulacion: motivo, asiento_reverso_id: (pago.asiento_id ?? 0) + 1 })
        registrarAccion(solicitud, 'compras.anular_pago', { tipo: 'pago_proveedor', id: pago.id }, { motivo })
        return { status: 200, cuerpo: pago }
    })),

    'GET /api/v1/activos': conPermiso('activos.ver', (solicitud) => {
        const clase = solicitud.query.get('clase')
        const estado = solicitud.query.get('estado')
        const compra = numeroQuery(solicitud, 'compra_id')
        const filas = deLaEmpresa(bd.activos, solicitud)
            .filter(a => !clase || a.clase === clase)
            .filter(a => !estado || a.estado === estado)
            .filter(a => compra === undefined || a.compra_id === compra)
            .sort((a, b) => b.fecha_alta.localeCompare(a.fecha_alta) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/activos/depreciar': conPermiso('activos.registrar', (solicitud) => {
        const hasta = mesTerminadoHasta(cuerpoObjeto(solicitud))
        if (typeof hasta !== 'string') {
            return hasta
        }
        const ids: number[] = []
        let monto = cero()
        let cuotas = 0
        for (const a of deLaEmpresa(bd.activos, solicitud)) {
            const antes = a.cuotas
            const cuota = depreciarActivo(a, hasta)
            if (a.cuotas > antes) {
                ids.push(a.id)
                cuotas += a.cuotas - antes
                monto = monto.plus(cuota)
            }
        }
        if (cuotas) {
            registrarAccion(solicitud, 'activos.depreciar', { tipo: 'activo', id: ids[0]! }, { hasta })
        }
        const cuerpo: Schema<'ResultadoCuotasMes'> = { hasta, cuotas, monto: texto(monto), ids }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/activos/:id': conPermiso('activos.ver', (solicitud) => {
        const activo = bd.activos.find(a => a.id === idDe(solicitud))
        return activo ? { status: 200, cuerpo: activo } : noEncontrado('el activo')
    }),

    'POST /api/v1/activos': conPermiso('activos.registrar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const clase = typeof cuerpo.clase === 'string' && CLASES.includes(cuerpo.clase) ? cuerpo.clase : null
        if (!clase) {
            errores.push({ field: 'clase', message: 'Elige la clase', rule: 'enum' })
        }
        const descripcion = cadena(cuerpo.descripcion, 300)
        if (!descripcion || descripcion.length < 2) {
            errores.push({ field: 'descripcion', message: 'Descripción de 2 a 300 caracteres', rule: 'minLength' })
        }
        const monto = (campo: string, obligatorio: boolean) => {
            const valor = cuerpo[campo]
            if (valor === undefined || valor === null || valor === '') {
                if (obligatorio) {
                    errores.push({ field: campo, message: 'Obligatorio', rule: 'required' })
                }
                return cero()
            }
            if (typeof valor !== 'string' || !MONTO.test(valor)) {
                errores.push({ field: campo, message: 'Monto con hasta 2 decimales', rule: 'monto' })
                return cero()
            }
            return new Decimal(valor)
        }
        const costo = monto('costo', true)
        const residual = monto('valor_residual', false)
        const inicial = monto('depreciacion_inicial', false)
        if (costo.lte(0) && !errores.some(e => e.field === 'costo')) {
            errores.push({ field: 'costo', message: 'Mayor que 0', rule: 'positivo' })
        }
        if (residual.plus(inicial).gt(costo)) {
            errores.push({ field: 'depreciacion_inicial', message: 'Residual y depreciación inicial no pasan del costo', rule: 'excede_costo' })
        }
        const fechaAlta = cuerpo.fecha_alta ? fechaDe(cuerpo.fecha_alta) : hoy()
        if (!fechaAlta || fechaAlta > hoy()) {
            errores.push({ field: 'fecha_alta', message: 'Fecha no futura (AAAA-MM-DD)', rule: 'date' })
        }
        const tasa = typeof cuerpo.tasa_anual === 'string' && cuerpo.tasa_anual ? cuerpo.tasa_anual : null
        if (tasa !== null && !TASA.test(tasa)) {
            errores.push({ field: 'tasa_anual', message: 'Por ciento con hasta 2 decimales', rule: 'regex' })
        }
        if (cuerpo.contrapartida !== undefined && !['2.9.01', '3.1.01', '3.3.01'].includes(String(cuerpo.contrapartida))) {
            errores.push({ field: 'contrapartida', message: 'Contrapartida no válida', rule: 'enum' })
        }
        if (errores.length || !clase || !descripcion || !fechaAlta) {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        const tope = topeClase(empresaId, clase)
        if (tasa !== null && new Decimal(tasa).gt(tope)) {
            return codigo(422, 'tasa_sobre_tope', 'Regla de negocio', `La tasa ${tasa} % pasa del máximo legal de la clase (${tope} %)`, [{ field: 'tasa_anual', message: `Hasta ${tope} %`, rule: 'tasa_sobre_tope' }])
        }
        const activo = nuevoActivo({ empresaId, clase, descripcion, serie: cadena(cuerpo.serie, 100), ubicacion: cadena(cuerpo.ubicacion, 200), fechaAlta, costo, residual, inicial, tasa: tasa ?? tope, compraId: null, lineaId: null, usuario: usuarioId(solicitud) })
        registrarAccion(solicitud, 'activos.registrar', { tipo: 'activo', id: activo.id }, cuerpo)
        return { status: 201, cuerpo: activo }
    })),

    'POST /api/v1/activos/:id/dar-de-baja': conPermiso('activos.dar_de_baja', conIdempotencia((solicitud) => {
        const activo = bd.activos.find(a => a.id === idDe(solicitud))
        if (!activo) {
            return noEncontrado('el activo')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const tipo = cuerpo.tipo === 'venta' || cuerpo.tipo === 'retiro' ? cuerpo.tipo : null
        if (!tipo) {
            errores.push({ field: 'tipo', message: 'Venta o retiro', rule: 'enum' })
        }
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        if (motivo.length < 3 || motivo.length > 500) {
            errores.push({ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' })
        }
        const fecha = cuerpo.fecha ? fechaDe(cuerpo.fecha) : hoy()
        if (!fecha || fecha > hoy()) {
            errores.push({ field: 'fecha', message: 'Fecha no futura (AAAA-MM-DD)', rule: 'date' })
        }
        else if (fecha < activo.fecha_alta) {
            errores.push({ field: 'fecha', message: `No antes del alta (${activo.fecha_alta})`, rule: 'antes_del_alta' })
        }
        const precio = typeof cuerpo.precio_venta === 'string' && MONTO.test(cuerpo.precio_venta) ? new Decimal(cuerpo.precio_venta) : null
        if (tipo === 'venta' && (!precio || precio.lte(0))) {
            errores.push({ field: 'precio_venta', message: 'El precio de venta (sin IVA) es obligatorio', rule: 'required' })
        }
        if (tipo === 'venta' && !cuerpo.cuenta_bancaria_id && !cuerpo.banco_id && !cuerpo.cuenta_id) {
            errores.push({ field: 'cuenta_bancaria_id', message: 'Elige dónde se recibe el precio', rule: 'required' })
        }
        if (errores.length || !tipo || !fecha) {
            return datosInvalidos(errores)
        }
        if (activo.estado === 'dado_de_baja') {
            return codigo(409, 'activo_dado_de_baja', 'Activo dado de baja', `El activo ${activo.id} ya está dado de baja`)
        }
        depreciarActivo(activo, mesSiguiente(mesDe(fecha), -1))
        Object.assign(activo, { estado: 'dado_de_baja', baja: { fecha, tipo, motivo, precio_venta: texto(precio ?? cero()), valor_libros: activo.valor_libros, asiento_id: 9740 + activo.id } })
        registrarAccion(solicitud, 'activos.dar_de_baja', { tipo: 'activo', id: activo.id }, cuerpo)
        return { status: 200, cuerpo: activo }
    })),

    'GET /api/v1/diferimientos': conPermiso('libro.ver', (solicitud) => {
        const origen = solicitud.query.get('origen')
        const compra = numeroQuery(solicitud, 'compra_id')
        const factura = numeroQuery(solicitud, 'factura_id')
        const filas = deLaEmpresa(bd.diferimientos, solicitud)
            .filter(d => !origen || d.origen === origen)
            .filter(d => compra === undefined || d.compra_id === compra)
            .filter(d => factura === undefined || d.factura_id === factura)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/diferimientos/amortizar': conPermiso('libro.registrar_asiento', (solicitud) => {
        const hasta = mesTerminadoHasta(cuerpoObjeto(solicitud))
        if (typeof hasta !== 'string') {
            return hasta
        }
        const ids: number[] = []
        let monto = cero()
        let cuotas = 0
        for (const d of deLaEmpresa(bd.diferimientos, solicitud)) {
            const antes = d.cuotas.length
            const cuota = amortizar(d, hasta)
            if (d.cuotas.length > antes) {
                ids.push(d.id)
                cuotas += d.cuotas.length - antes
                monto = monto.plus(cuota)
            }
        }
        if (cuotas) {
            registrarAccion(solicitud, 'libro.amortizar_diferidos', { tipo: 'diferimiento', id: ids[0]! }, { hasta })
        }
        const cuerpo: Schema<'ResultadoCuotasMes'> = { hasta, cuotas, monto: texto(monto), ids }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/diferimientos/:id': conPermiso('libro.ver', (solicitud) => {
        const diferimiento = bd.diferimientos.find(d => d.id === idDe(solicitud))
        return diferimiento ? { status: 200, cuerpo: diferimiento } : noEncontrado('el diferimiento')
    }),

    'POST /api/v1/diferimientos': conPermiso('libro.registrar_asiento', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        if (cuerpo.origen !== 'compra' && cuerpo.origen !== 'factura') {
            errores.push({ field: 'origen', message: 'Factura o compra', rule: 'enum' })
        }
        const meses = cuerpo.meses
        if (typeof meses !== 'number' || !Number.isInteger(meses) || meses < 2 || meses > 120) {
            errores.push({ field: 'meses', message: 'De 2 a 120 meses', rule: 'range' })
        }
        const compra = cuerpo.origen === 'compra' ? bd.compras.find(c => c.lineas.some(l => l.id === cuerpo.compra_linea_id)) : undefined
        const linea = compra?.lineas.find(l => l.id === cuerpo.compra_linea_id)
        if (cuerpo.origen === 'compra' && !linea) {
            errores.push({ field: 'compra_linea_id', message: 'Elige la línea de la compra', rule: 'exists' })
        }
        if (cuerpo.origen === 'factura') {
            errores.push({ field: 'factura_linea_id', message: 'Los ingresos diferidos se registran desde la API (sin pantalla aún)', rule: 'no_soportado' })
        }
        const inicio = cuerpo.inicio ? fechaDe(cuerpo.inicio) : null
        if (cuerpo.inicio && !inicio) {
            errores.push({ field: 'inicio', message: 'Fecha AAAA-MM-DD', rule: 'date' })
        }
        if (errores.length || !compra || !linea || typeof meses !== 'number') {
            return datosInvalidos(errores)
        }
        if (compra.estado === 'anulada') {
            return codigo(409, 'compra_anulada', 'Compra anulada', `La compra ${compra.id} está anulada`)
        }
        if (bd.diferimientos.some(d => d.compra_linea_id === linea.id && d.estado !== 'cancelado') || linea.diferir_meses) {
            return codigo(409, 'linea_diferida', 'Línea diferida', 'Esa línea ya tiene su diferimiento')
        }
        const total = compra.credito_fiscal ? new Decimal(linea.base) : new Decimal(linea.base).plus(linea.iva)
        const diferimiento = nuevoDiferimiento({ empresaId: compra.empresa_id, origen: 'compra', compraId: compra.id, lineaId: linea.id, facturaId: null, facturaLineaId: null, descripcion: cadena(cuerpo.descripcion, 300) ?? linea.descripcion, destino: linea.cuenta_codigo, total, inicio: inicio ?? compra.fecha, meses, usuario: usuarioId(solicitud) })
        registrarAccion(solicitud, 'libro.registrar_diferimiento', { tipo: 'diferimiento', id: diferimiento.id }, cuerpo)
        return { status: 201, cuerpo: diferimiento }
    })),

    'GET /api/v1/reportes/cuentas-por-pagar': conPermiso('reportes.ver', (solicitud) => {
        const corte = fechaDe(solicitud.query.get('corte')) ?? hoy()
        const proveedorId = numeroQuery(solicitud, 'proveedor_id')
        const formato = solicitud.query.get('formato')
        type Fila = Schema<'ReporteCuentasPorPagar'>['filas'][number]
        const filas: Fila[] = []
        for (const p of deLaEmpresa(bd.proveedores, solicitud).filter(x => proveedorId === undefined || x.id === proveedorId)) {
            const pendientes = pendientesDe(p.id).filter(c => c.fecha <= corte)
            if (!pendientes.length) {
                continue
            }
            const tramo = (desde: number, hasta: number) => texto(pendientes.filter((c) => {
                const dias = diasEntre(c.vence_en ?? c.fecha, corte)
                return dias >= desde && dias <= hasta
            }).reduce((s, c) => s.plus(c.saldo), cero()))
            const total = pendientes.reduce((s, c) => s.plus(c.saldo), cero())
            const porVencer = texto(pendientes.filter(c => diasEntre(c.vence_en ?? c.fecha, corte) < 0).reduce((s, c) => s.plus(c.saldo), cero()))
            filas.push({
                proveedor_id: p.id,
                proveedor: p.nombre,
                nit: p.nit,
                compras: pendientes.length,
                por_vencer: porVencer,
                dias_0_30: tramo(0, 30),
                dias_31_60: tramo(31, 60),
                dias_61_90: tramo(61, 90),
                dias_mas_90: tramo(91, 100_000),
                vencido: texto(total.minus(porVencer)),
                total: texto(total),
            })
        }
        if (formato === 'csv') {
            return { status: 200, cuerpo: `proveedor,nit,total\n${filas.map(f => `${f.proveedor},${f.nit},${f.total}`).join('\n')}\n`, contentType: 'text/csv' }
        }
        if (formato === 'xlsx') {
            return { status: 200, cuerpo: new Uint8Array([0x50, 0x4B, 0x03, 0x04]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        }
        const suma = (clave: 'por_vencer' | 'dias_0_30' | 'dias_31_60' | 'dias_61_90' | 'dias_mas_90' | 'vencido' | 'total') => texto(filas.reduce((s, f) => s.plus(f[clave]), cero()))
        const cuerpo: Schema<'ReporteCuentasPorPagar'> = {
            reporte: 'cuentas-por-pagar',
            titulo: 'Cuentas por pagar por antigüedad',
            filtros: { corte, proveedor_id: proveedorId ?? null },
            columnas: [
                { clave: 'proveedor_id', titulo: 'Proveedor', tipo: 'id' },
                { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' },
                { clave: 'nit', titulo: 'NIT', tipo: 'texto' },
                { clave: 'compras', titulo: 'Compras', tipo: 'entero' },
                { clave: 'por_vencer', titulo: 'Por vencer', tipo: 'dinero' },
                { clave: 'dias_0_30', titulo: '0-30 días', tipo: 'dinero' },
                { clave: 'dias_31_60', titulo: '31-60 días', tipo: 'dinero' },
                { clave: 'dias_61_90', titulo: '61-90 días', tipo: 'dinero' },
                { clave: 'dias_mas_90', titulo: 'Más de 90 días', tipo: 'dinero' },
                { clave: 'vencido', titulo: 'Vencido', tipo: 'dinero' },
                { clave: 'total', titulo: 'Total', tipo: 'dinero' },
            ],
            filas,
            totales: { proveedor_id: null, proveedor: null, nit: null, compras: filas.reduce((s, f) => s + f.compras, 0), por_vencer: suma('por_vencer'), dias_0_30: suma('dias_0_30'), dias_31_60: suma('dias_31_60'), dias_61_90: suma('dias_61_90'), dias_mas_90: suma('dias_mas_90'), vencido: suma('vencido'), total: suma('total') },
            generado_en: ahora(),
        }
        return { status: 200, cuerpo }
    }),
}
