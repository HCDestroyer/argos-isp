import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { generar } from '#tests/billing/ayudas_billing'
import { Problema } from '#shared/errores'
import { ConsumidorBilling } from '#billing/consumidor'
import RegistrarPago, { type EntradaRegistrarPago } from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import VencerFacturas from '#billing/actions/vencer_facturas'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import RegistrarPagoHistorico from '#billing/actions/registrar_pago_historico'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import RevisarCheck from '#ledger/actions/revisar_check'
import ReabrirPeriodo from '#ledger/actions/reabrir_periodo'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import SustituirFactura from '#billing/actions/sustituir_factura'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import ReintentarDte from '#fiscal/actions/reintentar_dte'
import CambiarContingenciaFel from '#fiscal/actions/cambiar_contingencia_fel'
import EditarParametro from '#fiscal/actions/editar_parametro'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { controlFelFalso } from '#fiscal/fel/falso'
import { procesarColaFel } from '#fiscal/fel/cola'
import { configurarModo, datosNit, empresasFel } from '#tests/fiscal/ayudas_fel'
import { cuentaBancariaPrueba } from '#tests/billing/ayudas_billing'
import CerrarDiferenciaPago from '#billing/actions/cerrar_diferencia_pago'
import CrearProveedorCobro from '#ledger/actions/crear_proveedor_cobro'
import LiquidarCobros from '#ledger/actions/liquidar_cobros'
import DepositarCaja from '#ledger/actions/depositar_caja'
import TrasladarFondos from '#ledger/actions/trasladar_fondos'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import ConciliarLinea from '#ledger/actions/conciliar_linea'
import AnularConciliacion from '#ledger/actions/anular_conciliacion'
import RegistrarDesdeExtracto from '#ledger/actions/registrar_desde_extracto'
import ProvisionarCartera from '#ledger/actions/provisionar_cartera'
import CastigarCartera from '#ledger/actions/castigar_cartera'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarPagoProveedor from '#ledger/actions/registrar_pago_proveedor'
import AnularPagoProveedor from '#ledger/actions/anular_pago_proveedor'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import RegistrarDiferimiento from '#ledger/actions/registrar_diferimiento'
import AmortizarDiferidos from '#ledger/actions/amortizar_diferidos'
import { hacerAgenteRetencion, proveedorEn } from '#tests/ledger/ayudas_compras'
import { Azar, centavosDe, texto } from '#tests/contabilidad/semilla'
import {
    prepararEmpresas,
    sacarDeLaColaFel,
    servicioEn,
    pendientes,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'
import {
    compararFotoLibro,
    contarAsientos,
    fotoEstado,
    fotoLibro,
    marcasAuditoria,
    normalizarResumen,
    verificarLibro,
    type FotoLibro,
    type Violacion,
} from '#tests/contabilidad/verificar_libro'

/**
 * Escenario generativo del auditor: una secuencia aleatoria **con semilla** de operaciones reales
 * (las mismas acciones que usa la API) sobre dos empresas nuevas: facturar, vencer (con mora),
 * pagar parcial, pagar de más, pago de terceros, cobro repartido entre empresas, depósito,
 * pasarela, anular pagos y facturas, notas de crédito (también de centavos), promesas, egresos,
 * cierres de caja con diferencia, pagos históricos y cierre/reapertura de mes. Después de cada paso
 * corre `verificarLibro` sobre las dos empresas y compara la foto del libro: nada de lo anterior se
 * editó ni se borró.
 *
 * Un rechazo de negocio (4xx) es válido, pero no puede escribir nada en el libro.
 */

/** Fechas fijas para que la semilla reproduzca lo mismo cualquier día. */
const TOPE_FACTURACION = '2026-10-01'
const VENCER_HASTA = '2026-10-16'
/**
 * Instante fijo de las promesas: dentro del periodo de octubre (facturas hasta TOPE_FACTURACION),
 * después de VENCER_HASTA. Con `now()` la regla `no_exceder_siguiente_facturacion` las rechazaba
 * en los últimos días del mes y el escenario dependía de la fecha real.
 */
const AHORA_PROMESAS = DateTime.fromISO('2026-10-20T12:00:00', { zone: 'America/Guatemala' })
/** Meses que el escenario cierra y reabre (ya terminados). */
const MESES_CERRABLES = ['2026-08-01', '2026-09-01'] as const

interface Servicio {
    id: number
    clienteId: number
    empresaId: number
    /** último `hasta` con que se generó */
    hasta: string
}

interface EstadoCierre {
    cerrado: boolean
    /** resumen del último cierre */
    foto: ReturnType<typeof normalizarResumen> | null
    /** hubo asientos en el mes desde el último cierre */
    cambiado: boolean
}

export interface Paso {
    n: number
    accion: string
    detalle: string
    rechazo?: string
}

export interface ResultadoEscenario {
    semilla: number
    pasos: Paso[]
    /** primera aparición de cada invariante roto, con el paso en que apareció */
    hallazgos: Array<{ paso: number; violacion: Violacion; secuencia: string[] }>
}

const PESOS = {
    facturar: 14,
    vencer: 6,
    pagar_parcial: 10,
    pagar_de_mas: 6,
    pagar_terceros: 4,
    cobro_repartido: 6,
    pagar_deposito: 4,
    pagar_pasarela: 3,
    anular_pago: 5,
    pagar_y_anular: 4,
    nota_credito: 7,
    anular_factura: 3,
    promesa: 4,
    incumplir: 2,
    egreso: 3,
    anular_egreso: 2,
    cerrar_caja: 4,
    historico: 5,
    cierre_mes: 5,
} as const

/**
 * Operaciones de la fase 3 (FEL), solo con `{ fel: true }`: la empresa B con FEL `obligatoria`
 * (mora con IVA: NDEB) y la C con `opcional`; el certificador falso responde a veces con error
 * temporal, caída tras certificar o rechazo.
 */
const PESOS_FEL = {
    cola_fel: 10,
    certificar_manual: 3,
    rechazo_sat: 2,
    reintentar_dte: 3,
    contingencia: 2,
    anular_dte: 3,
    ncre_linea: 3,
    sustituir: 3,
    pagar_aviso_y_anular: 4,
} as const

/**
 * Operaciones de la fase 4 (cobros, bancos y cartera), solo con `{ fase4: true }` (que implica FEL):
 * cada empresa con su proveedor de cobro (pasarela falsa, desde hoy) y dos cuentas bancarias.
 */
const PESOS_FASE4 = {
    pagar_pasarela: 8,
    liquidar: 5,
    contracargo: 3,
    depositar: 5,
    trasladar: 3,
    extracto: 5,
    conciliar: 8,
    anular_conciliacion: 2,
    cerrar_diferencia: 3,
    provisionar: 2,
    castigar: 3,
} as const

/**
 * Operaciones de la fase 5 de A3 (compras, proveedores, retenciones, activos y diferidos), solo con
 * `{ fase5: true }` (que implica la fase 4): por empresa un proveedor general al crédito y un pequeño
 * contribuyente; la empresa B es agente de retención de IVA.
 */
const PESOS_FASE5 = {
    compra: 8,
    ncre_compra: 2,
    pagar_proveedor: 5,
    anular_pago_proveedor: 2,
    anular_compra: 2,
    compra_desde_egreso: 3,
    alta_activo: 2,
    depreciar: 3,
    baja_activo: 2,
    diferir_factura: 2,
    amortizar: 3,
    pagar_con_retencion: 4,
} as const

/** Fechas de documento de las compras (fijas: la semilla reproduce lo mismo; las viejas pueden quedar fuera de la ventana). */
const FECHAS_COMPRA = ['2026-08-10', '2026-09-15', '2026-10-05'] as const

type Accion =
    keyof typeof PESOS | keyof typeof PESOS_FEL | keyof typeof PESOS_FASE4 | keyof typeof PESOS_FASE5

interface PorExtracto {
    tipo: 'deposito' | 'traslado' | 'liquidacion'
    id: number
    empresaId: number
    cuentaId: number
    monto: string
    referencia: string
}

/** Estados desde los que un DTE ya es un hecho fiscal: solo `facturas.anular` (y su cola) lo mueve. */
const DTE_FISCAL = ['certificado', 'anulacion_pendiente', 'anulado']

class RechazoEsperadoNoOcurrio extends Error {}

export class EscenarioGenerativo {
    private readonly azar: Azar
    private e!: Empresas
    private empresas!: number[]
    private servicios: Servicio[] = []
    private clientes: Array<{ id: number; empresas: number[] }> = []
    private cierres = new Map<string, EstadoCierre>()
    private foto!: FotoLibro
    private marcas!: { acciones: number; outbox: number }
    private referencia = 0
    readonly pasos: Paso[] = []
    private extra: Violacion[] = []
    private readonly fel: boolean
    private readonly incluirHallazgosAbiertos: boolean
    private readonly pesos: Record<Accion, number>
    private dtes = new Map<number, string>()
    private readonly fase4: boolean
    private proveedores = new Map<number, number>()
    private segundas = new Map<number, number>()
    private porExtracto: PorExtracto[] = []
    private lineasDoc = new Map<number, { tipo: string; id: number }>()
    private saldosExtracto = new Map<number, bigint>()
    private readonly fase5: boolean
    private proveedoresCompra = new Map<number, { general: number; pequeno: number }>()

    constructor(
        readonly semilla: number,
        opciones: {
            fel?: boolean
            fase4?: boolean
            fase5?: boolean
            incluirHallazgosAbiertos?: boolean
        } = {},
    ) {
        this.azar = new Azar(semilla)
        this.fase5 = opciones.fase5 ?? false
        this.fase4 = (opciones.fase4 ?? false) || this.fase5
        this.fel = (opciones.fel ?? false) || this.fase4
        this.incluirHallazgosAbiertos = opciones.incluirHallazgosAbiertos ?? false
        this.pesos = (
            this.fase5
                ? { ...PESOS, ...PESOS_FEL, ...PESOS_FASE4, ...PESOS_FASE5 }
                : this.fase4
                  ? { ...PESOS, ...PESOS_FEL, ...PESOS_FASE4 }
                  : this.fel
                    ? { ...PESOS, ...PESOS_FEL }
                    : PESOS
        ) as Record<Accion, number>
    }

    async preparar() {
        this.marcas = await marcasAuditoria()
        if (this.fel) {
            this.e = await empresasFel('obligatoria')
            await configurarModo(this.e, this.e.C, 'opcional')
            await new EditarParametro().execute(
                {
                    clave: 'mora_con_iva',
                    valor: true,
                    vigente_desde: '2026-01-01',
                    motivo: 'auditoría: NDEB',
                    empresa_id: this.e.B,
                },
                { ...this.e.ctx, empresaId: this.e.B },
            )
        } else {
            this.e = await prepararEmpresas()
        }
        this.empresas = [this.e.B, this.e.C]
        const precios = ['150.00', '199.99', '275.50', '99.01', '333.33']
        const plantillas = [
            {},
            { mora_tipo: 'fija', mora_valor: '12.50' },
            { mora_tipo: 'porcentaje', mora_valor: '7.50' },
            { mora_tipo: 'porcentaje', mora_valor: '3.33', mora_recurrente: true },
        ]
        // 5 clientes; 3 con servicios en las dos empresas (cobro repartido), 2 en una sola
        for (let i = 0; i < 5; i++) {
            // con FEL: NIT válido salvo el último cliente (consumidor final; los totales no llegan al límite)
            const clienteId = await crearClienteFila(this.fel && i < 4 ? datosNit() : {})
            const enDos = i < 3
            const propias = enDos ? this.empresas : [this.azar.elegir(this.empresas)]
            for (const empresaId of propias) {
                const mes = this.azar.entero(1, 5)
                const dia = this.azar.entero(1, 28)
                const instalacion = `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
                const { servicioId } = await servicioEn(empresaId, {
                    clienteId,
                    precio: this.azar.elegir(precios),
                    instalacion,
                    plantilla: {
                        ...this.azar.elegir(plantillas),
                        ...(this.fel
                            ? {
                                  certificar_al: this.azar.elegir(
                                      empresaId === this.e.B
                                          ? ['pagar', 'emitir']
                                          : ['pagar', 'emitir', 'nunca'],
                                  ),
                              }
                            : {}),
                    },
                })
                this.servicios.push({ id: servicioId, clienteId, empresaId, hasta: instalacion })
            }
            this.clientes.push({ id: clienteId, empresas: propias })
        }
        for (const empresaId of this.empresas) {
            for (const periodo of MESES_CERRABLES) {
                this.cierres.set(`${empresaId}|${periodo}`, { cerrado: false, foto: null, cambiado: false })
            }
        }
        if (this.fase4) await this.prepararFase4()
        if (this.fase5) await this.prepararFase5()
        this.foto = await fotoLibro(this.empresas, this.marcas.acciones, this.marcas.outbox)
        if (this.fel) this.dtes = await this.estadosDte()
    }

    get empresasDelEscenario(): number[] {
        return this.empresas
    }

    async correr(cantidad: number): Promise<ResultadoEscenario> {
        const hallazgos: ResultadoEscenario['hallazgos'] = []
        const vistos = new Set<string>()
        for (let n = 1; n <= cantidad; n++) {
            const accion = this.azar.ponderado(this.pesos)
            const paso = await this.ejecutar(n, accion)
            this.pasos.push(paso)
            const violaciones = [...this.extra, ...(await this.verificar(accion))]
            this.extra = []
            for (const violacion of violaciones) {
                if (vistos.has(violacion.invariante)) continue
                vistos.add(violacion.invariante)
                hallazgos.push({
                    paso: n,
                    violacion,
                    secuencia: this.pasos.map(
                        (p) => `${p.n}. ${p.accion}: ${p.detalle}${p.rechazo ? ` → ${p.rechazo}` : ''}`,
                    ),
                })
            }
        }
        if (this.fel) await sacarDeLaColaFel()
        return { semilla: this.semilla, pasos: this.pasos, hallazgos }
    }

    private async verificar(accion: Accion): Promise<Violacion[]> {
        const violaciones = await verificarLibro(this.empresas, {
            incluirHallazgosAbiertos: this.incluirHallazgosAbiertos,
        })
        const nueva = await fotoLibro(this.empresas, this.marcas.acciones, this.marcas.outbox)
        violaciones.push(...compararFotoLibro(this.foto, nueva))
        this.foto = nueva
        if (this.fel) violaciones.push(...(await this.verificarFel(accion)))
        return violaciones
    }

    /*
    |--------------------------------------------------------------------------
    | FEL: invariantes que dependen del paso
    |--------------------------------------------------------------------------
    */

    private async estadosDte(): Promise<Map<number, string>> {
        const filas = (await db
            .from('fiscal.dte')
            .whereIn('empresa_id', this.empresas)
            .select('id', 'estado')) as Array<{ id: number; estado: string }>
        return new Map(filas.map((f) => [Number(f.id), f.estado]))
    }

    /**
     * - Un DTE que ya es un hecho fiscal (certificado, anulación pendiente o anulado) solo cambia por
     *   `facturas.anular` (certificado → anulacion_pendiente) y su cola (→ anulado, o de vuelta a
     *   certificado si el certificador rechaza la anulación). En particular, **anular un pago nunca
     *   revierte un DTE** (§10.1). Un DTE nunca desaparece.
     * - Después de correr la cola, ningún aviso cobrado queda sin su DTE (salvo un rechazo
     *   definitivo, que espera a que alguien corrija el dato y reintente).
     */
    private async verificarFel(accion: Accion): Promise<Violacion[]> {
        const violaciones: Violacion[] = []
        const antesDelPaso = this.dtes
        const ahora = await this.estadosDte()
        const indebidos: unknown[] = []
        for (const [id, antes] of this.dtes) {
            const despues = ahora.get(id)
            if (despues === undefined) {
                indebidos.push({ dte_id: id, antes, despues: null })
                continue
            }
            if (!DTE_FISCAL.includes(antes) || despues === antes) continue
            const permitido =
                (antes === 'certificado' &&
                    (despues === 'anulacion_pendiente' || despues === 'anulado') &&
                    (accion === 'anular_dte' || accion === 'anular_factura')) ||
                (antes === 'anulacion_pendiente' &&
                    (despues === 'anulado' || despues === 'certificado') &&
                    (accion === 'cola_fel' || accion === 'anular_dte' || accion === 'rechazo_sat'))
            if (!permitido) indebidos.push({ dte_id: id, antes, despues, accion })
        }
        if (indebidos.length > 0) {
            violaciones.push({
                invariante:
                    '12.dte_fiscal_cambiado_fuera_de_su_anulacion (un pago anulado nunca revierte un DTE)',
                detalle: indebidos.slice(0, 20),
            })
        }
        this.dtes = ahora
        if (accion === 'cola_fel') {
            const { rows } = (await db.rawQuery(
                `SELECT f.id, f.tipo, f.empresa_id,
                        (SELECT max(o.id) FROM fiscal.dte o WHERE o.documento_tipo = 'factura'
                            AND o.documento_id = f.factura_origen_id AND o.estado = 'certificado') AS origen_dte
                   FROM billing.facturas f JOIN fiscal.fel_configuracion c ON c.empresa_id = f.empresa_id
                  WHERE f.empresa_id = ANY(?::bigint[]) AND f.aviso_cobro AND f.estado = 'pagada'
                    AND c.modo <> 'desactivada' AND NOT c.contingencia_activa
                    -- desvío (g) de la fase 4: cubierta por un castigo, no por un cobro; no se certifica
                    AND NOT EXISTS (SELECT 1 FROM ledger.castigos_facturas cf WHERE cf.factura_id = f.id)
                    AND NOT EXISTS (
                            SELECT 1 FROM fiscal.dte d
                             WHERE d.documento_id = f.id
                               AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                               AND (d.estado IN ('certificado', 'anulacion_pendiente', 'error_temporal', 'pendiente')
                                    OR (d.estado = 'rechazado' AND d.ultimo_error <> 'aviso_sin_cubrir')))`,
                [this.empresas],
            )) as { rows: Array<{ id: number; tipo: string; origen_dte: number | null }> }
            // una mora (NDEB) se pide cuando su factura ya estaba certificada al empezar la corrida
            const sinDte = rows.filter(
                (r) =>
                    r.tipo === 'servicio' ||
                    (r.origen_dte !== null && antesDelPaso.get(Number(r.origen_dte)) === 'certificado'),
            )
            if (sinDte.length > 0) {
                violaciones.push({
                    invariante: '12.aviso_cobrado_sin_dte_tras_la_cola',
                    detalle: sinDte.slice(0, 20),
                })
            }
        }
        return violaciones
    }

    private async ejecutar(n: number, accion: Accion): Promise<Paso> {
        const antes = await contarAsientos(this.empresas)
        const paso: Paso = { n, accion, detalle: '' }
        try {
            paso.detalle = (await this[accion]()) ?? ''
        } catch (error) {
            if (error instanceof Problema && error.status >= 400 && error.status < 500) {
                const campos = (error.errores ?? []).map((x) => `${x.field}: ${x.message}`).join('; ')
                paso.rechazo = `${error.status} ${error.tipo.split(':').at(-1)}: ${error.detalle ?? error.message}${campos ? ` [${campos}]` : ''}`
                const despues = await contarAsientos(this.empresas)
                if (despues !== antes) {
                    this.extra.push({
                        invariante: '11.rechazo_escribio_en_el_libro',
                        detalle: { paso: n, accion, antes, despues, rechazo: paso.rechazo },
                    })
                }
                // el rechazo de los pasos compuestos puede llegar después de su detalle
                paso.detalle ||= (error as { contexto?: string }).contexto ?? ''
            } else if (error instanceof RechazoEsperadoNoOcurrio) {
                this.extra.push({ invariante: '7.registro_en_mes_cerrado_aceptado', detalle: error.message })
                paso.rechazo = error.message
            } else {
                const mensaje = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
                throw new Error(
                    `Semilla ${this.semilla}, paso ${n} (${accion}): error inesperado (no es un rechazo de negocio): ${mensaje}\n` +
                        `Secuencia:\n${this.pasos.map((p) => `${p.n}. ${p.accion}: ${p.detalle}`).join('\n')}`,
                )
            }
        }
        return paso
    }

    /*
    |--------------------------------------------------------------------------
    | Utilidades
    |--------------------------------------------------------------------------
    */

    private get ctx() {
        return this.e.ctx
    }

    private nuevaReferencia(prefijo: string) {
        this.referencia += 1
        return `${prefijo}-${this.semilla}-${this.referencia}-${unico('r')}`
    }

    /** Monto aleatorio en centavos entre 1 y el pendiente (parcial). */
    private parcial(pendiente: bigint): bigint {
        if (pendiente <= 1n) return 1n
        return this.azar.centavos(1, Number(pendiente - 1n))
    }

    private async pendienteDe(clienteId: number, empresas = this.empresas): Promise<bigint> {
        const lista = await pendientes(empresas, clienteId)
        return lista.reduce((s, f) => s + centavosDe(f.total) - centavosDe(f.pagado), 0n)
    }

    private async clienteConDeuda(empresas = this.empresas) {
        const conDeuda: number[] = []
        for (const c of this.clientes) {
            if ((await this.pendienteDe(c.id, empresas)) > 0n) conDeuda.push(c.id)
        }
        return conDeuda.length > 0 ? this.azar.elegir(conDeuda) : null
    }

    /** Pago con su evento `pago.registrado` procesado dos veces por el consumidor (idempotente). */
    private async pagar(entrada: EntradaRegistrarPago) {
        const resultado = await new RegistrarPago().execute(entrada, this.ctx)
        await this.procesarEventos(resultado.pagos.map((p) => p.id))
        return resultado
    }

    private async procesarEventos(pagos: number[]) {
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'pago.registrado')
            .whereIn(db.raw(`(payload->>'pago_id')::bigint`) as unknown as string, pagos)
            .select('id', 'evento', 'payload', 'request_id')
        const consumidor = new ConsumidorBilling()
        for (const evento of eventos) {
            const entrante = {
                id: evento.id,
                evento: evento.evento,
                payload: evento.payload,
                requestId: evento.request_id,
            }
            await consumidor.procesar(entrante)
            await consumidor.procesar(entrante)
        }
    }

    private async marcarMesCambiado(empresaId: number, fecha: string) {
        const periodo = `${fecha.slice(0, 7)}-01`
        const estado = this.cierres.get(`${empresaId}|${periodo}`)
        if (estado) estado.cambiado = true
    }

    /*
    |--------------------------------------------------------------------------
    | Pasos
    |--------------------------------------------------------------------------
    */

    private async facturar() {
        const servicio = this.azar.elegir(this.servicios)
        const siguiente = DateTime.fromISO(servicio.hasta)
            .plus({ months: this.azar.entero(1, 2) })
            .startOf('month')
            .toISODate()!
        const hasta = siguiente > TOPE_FACTURACION ? TOPE_FACTURACION : siguiente
        servicio.hasta = hasta
        const r = await generar(servicio.id, hasta)
        return `servicio ${servicio.id} (empresa ${servicio.empresaId}) hasta ${hasta}: ${r.generadas} facturas`
    }

    private async vencer() {
        const servicio = this.azar.elegir(this.servicios)
        const r = await new VencerFacturas().execute(
            { servicio_id: servicio.id, hasta: VENCER_HASTA },
            this.ctx,
        )
        return `servicio ${servicio.id}: ${r.vencidas} vencidas, ${r.moras} moras`
    }

    private async pagar_parcial() {
        const clienteId = await this.clienteConDeuda()
        if (clienteId === null) return 'sin deuda'
        const lista = await pendientes(this.empresas, clienteId)
        const factura = this.azar.elegir(lista)
        const monto = this.parcial(centavosDe(factura.total) - centavosDe(factura.pagado))
        await this.pagar({
            cliente_id: clienteId,
            metodo: 'caja',
            monto: texto(monto),
            facturas: [factura.id],
        })
        return `cliente ${clienteId} paga ${texto(monto)} en caja a la factura ${factura.id}`
    }

    private async pagar_de_mas() {
        const cliente = this.azar.elegir(this.clientes)
        const empresaId = this.azar.elegir(cliente.empresas)
        const deuda = await this.pendienteDe(cliente.id, [empresaId])
        const monto = deuda + this.azar.centavos(1, 15000)
        await this.pagar({
            cliente_id: cliente.id,
            metodo: 'caja',
            monto: texto(monto),
            empresa_id: empresaId,
        })
        return `cliente ${cliente.id} paga ${texto(monto)} en caja (empresa ${empresaId}, debía ${texto(deuda)})`
    }

    private async pagar_terceros() {
        const lista = await pendientes(this.empresas)
        if (lista.length === 0) return 'sin deuda'
        const factura = this.azar.elegir(lista)
        const otros = this.clientes.filter((c) => c.id !== factura.cliente_id)
        const pagador = this.azar.elegir(otros)
        const pendiente = centavosDe(factura.total) - centavosDe(factura.pagado)
        const monto = this.azar.moneda()
            ? pendiente
            : this.parcial(pendiente) + (this.azar.moneda(0.3) ? 5000n : 0n)
        await this.pagar({
            cliente_id: pagador.id,
            metodo: 'caja',
            monto: texto(monto),
            facturas: [factura.id],
            empresa_id: factura.empresa_id,
        })
        return `cliente ${pagador.id} paga ${texto(monto)} la factura ${factura.id} del cliente ${factura.cliente_id}`
    }

    private async cobro_repartido() {
        const enDos = this.clientes.filter((c) => c.empresas.length === 2)
        const cliente = this.azar.elegir(enDos)
        const deuda = await this.pendienteDe(cliente.id)
        if (deuda === 0n) return `cliente ${cliente.id} sin deuda`
        const monto = this.azar.moneda(0.6) ? this.parcial(deuda) : deuda + this.azar.centavos(0, 5000)
        const r = await this.pagar({ cliente_id: cliente.id, metodo: 'caja', monto: texto(monto) })
        return `cliente ${cliente.id} paga ${texto(monto)} en efectivo (debía ${texto(deuda)}): ${r.pagos.length} pagos [${r.pagos
            .map((p) => `${p.empresa_id}:${p.monto}`)
            .join(', ')}]`
    }

    private async pagar_deposito() {
        const cliente = this.azar.elegir(this.clientes)
        const empresaId = this.azar.elegir(cliente.empresas)
        const deuda = await this.pendienteDe(cliente.id, [empresaId])
        const monto =
            deuda > 1n && this.azar.moneda() ? this.parcial(deuda) : deuda + this.azar.centavos(1, 2000)
        await this.pagar({
            cliente_id: cliente.id,
            metodo: 'deposito',
            monto: texto(monto),
            cuenta_bancaria_id: this.e.cuentas.get(empresaId)!,
            referencia: this.nuevaReferencia('BOL'),
        })
        return `cliente ${cliente.id} deposita ${texto(monto)} en la cuenta de la empresa ${empresaId}`
    }

    private async pagar_pasarela() {
        const cliente = this.azar.elegir(this.clientes)
        const empresaId = this.azar.elegir(cliente.empresas)
        const deuda = await this.pendienteDe(cliente.id, [empresaId])
        const monto = deuda > 500n ? deuda : deuda + this.azar.centavos(500, 3000)
        // comisión de 3.5 % redondeada a centavos (enteros: nada de number con decimales)
        const comision = (monto * 35n + 500n) / 1000n
        await this.pagar({
            cliente_id: cliente.id,
            metodo: 'pasarela',
            monto: texto(monto),
            comision: texto(comision),
            pasarela: 'falsa',
            referencia: this.nuevaReferencia('PAS'),
            empresa_id: empresaId,
        })
        return `cliente ${cliente.id} paga ${texto(monto)} por pasarela (comisión ${texto(comision)}) en la empresa ${empresaId}`
    }

    private async pagosVigentes() {
        return (await db
            .from('billing.pagos')
            .whereIn('empresa_id', this.empresas)
            .where('estado', 'registrado')
            .orderBy('id', 'asc')
            .select('id', 'monto', 'historico')) as Array<{ id: number; monto: string; historico: boolean }>
    }

    private async anular_pago() {
        const pagos = await this.pagosVigentes()
        if (pagos.length === 0) return 'sin pagos'
        const pago = this.azar.elegir(pagos)
        await new AnularPago().execute(
            { pago_id: pago.id, motivo: 'auditoría: anulación aleatoria' },
            this.ctx,
        )
        return `anula el pago ${pago.id} (${pago.monto}${pago.historico ? ', histórico' : ''})`
    }

    /** Pagar y anular enseguida debe dejar saldos y facturas exactamente como estaban. */
    private async pagar_y_anular() {
        const cliente = this.azar.elegir(this.clientes)
        const deuda = await this.pendienteDe(cliente.id)
        const monto =
            deuda > 1n && this.azar.moneda() ? this.parcial(deuda) : deuda + this.azar.centavos(1, 9000)
        const antes = await fotoEstado(this.empresas)
        const metodoCaja = cliente.empresas.length === 2 || this.azar.moneda()
        const r = await this.pagar({
            cliente_id: cliente.id,
            metodo: 'caja',
            monto: texto(monto),
            ...(metodoCaja ? {} : { empresa_id: cliente.empresas[0] }),
        })
        for (const pago of r.pagos) {
            await new AnularPago().execute(
                { pago_id: pago.id, motivo: 'auditoría: pagar y anular' },
                this.ctx,
            )
        }
        const despues = await fotoEstado(this.empresas)
        if (JSON.stringify(antes) !== JSON.stringify(despues)) {
            this.extra.push({
                invariante: '5.anular_no_deja_todo_como_estaba',
                detalle: {
                    cliente: cliente.id,
                    monto: texto(monto),
                    pagos: r.pagos.map((p) => p.id),
                    antes,
                    despues,
                },
            })
        }
        return `cliente ${cliente.id} paga ${texto(monto)} y anula ${r.pagos.map((p) => p.id).join(', ')}`
    }

    private async nota_credito() {
        const lista = await pendientes(this.empresas)
        if (lista.length === 0) return 'sin facturas pendientes'
        const factura = this.azar.elegir(lista)
        const pendiente = centavosDe(factura.total) - centavosDe(factura.pagado)
        const tipo = this.azar.ponderado({ centavos: 3, parcial: 4, resto: 3 })
        const monto =
            tipo === 'resto'
                ? pendiente
                : tipo === 'centavos'
                  ? pendiente < 9n
                      ? pendiente
                      : this.azar.centavos(1, 9)
                  : this.parcial(pendiente)
        await new EmitirNotaCredito().execute(
            { factura_id: factura.id, monto: texto(monto), motivo: `auditoría: nota ${tipo}` },
            this.ctx,
        )
        return `nota de crédito ${texto(monto)} (${tipo}) a la factura ${factura.id} (${factura.tipo}, total ${factura.total}, pendiente ${texto(pendiente)})`
    }

    private async anular_factura() {
        const candidatas = (await db
            .from('billing.facturas as f')
            .whereIn('f.empresa_id', this.empresas)
            .whereIn('f.estado', ['emitida', 'vencida'])
            .where('f.pagado', 0)
            .whereNotExists((q) => q.from('billing.notas_credito as n').whereRaw('n.factura_id = f.id'))
            .whereNotExists((q) => q.from('billing.pagos_aplicaciones as a').whereRaw('a.factura_id = f.id'))
            .orderBy('f.id', 'asc')
            .select('f.id', 'f.tipo', 'f.total')) as Array<{ id: number; tipo: string; total: string }>
        if (candidatas.length === 0) return 'sin facturas anulables'
        const factura = this.azar.elegir(candidatas)
        await new AnularFactura().execute(
            { factura_id: factura.id, motivo: 'auditoría: anulación' },
            this.ctx,
        )
        return `anula la factura ${factura.id} (${factura.tipo}, ${factura.total})`
    }

    private async promesa() {
        const servicio = this.azar.elegir(this.servicios)
        const deuda = (await db
            .from('billing.facturas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .select(db.raw('coalesce(sum(total - pagado), 0)::text as deuda'))
            .firstOrFail()) as { deuda: string }
        const total = centavosDe(deuda.deuda)
        if (total === 0n) return `servicio ${servicio.id} sin deuda`
        const antes = await contarAsientos(this.empresas)
        const r = await new CrearPromesaPago().execute(
            {
                servicio_id: servicio.id,
                vence_en: AHORA_PROMESAS.plus({ days: 3 }).toJSDate(),
                monto: texto(this.parcial(total + 1n)),
                canal: 'operador',
                ahora: AHORA_PROMESAS.toJSDate(),
            },
            this.ctx,
        )
        if ((await contarAsientos(this.empresas)) !== antes) {
            this.extra.push({ invariante: '9.promesa_movio_el_libro', detalle: { promesa: r.id } })
        }
        return `promesa ${r.id} del servicio ${servicio.id}: ${r.estado}`
    }

    private async incumplir() {
        const antes = await contarAsientos(this.empresas)
        const servicio = this.azar.elegir(this.servicios)
        const r = await new IncumplirPromesas().execute(
            { servicio_id: servicio.id, ahora: AHORA_PROMESAS.plus({ days: 10 }).toJSDate() },
            this.ctx,
        )
        if ((await contarAsientos(this.empresas)) !== antes) {
            this.extra.push({ invariante: '9.promesa_movio_el_libro', detalle: { servicio: servicio.id, r } })
        }
        return `servicio ${servicio.id}: ${r.incumplidas} incumplidas, ${r.cumplidas} cumplidas`
    }

    private async egreso() {
        const empresaId = this.azar.elegir(this.empresas)
        const monto = this.azar.centavos(100, 5000)
        const r = await new RegistrarEgreso().execute(
            {
                categoria: 'otros',
                monto: texto(monto),
                metodo: 'caja',
                caja_id: this.e.cajas.get(empresaId)!,
                descripcion: 'auditoría: egreso',
            },
            this.ctx,
        )
        return `egreso ${r.id} de ${texto(monto)} de la caja de la empresa ${empresaId}`
    }

    private async anular_egreso() {
        const egresos = (await db
            .from('ledger.egresos as e')
            .whereIn('e.empresa_id', this.empresas)
            .whereNotExists((q) => q.from('ledger.egresos_anulaciones as x').whereRaw('x.egreso_id = e.id'))
            .orderBy('e.id', 'asc')
            .select('e.id')) as Array<{ id: number }>
        if (egresos.length === 0) return 'sin egresos'
        const egreso = this.azar.elegir(egresos)
        await new AnularEgreso().execute({ egreso_id: egreso.id, motivo: 'auditoría: anulación' }, this.ctx)
        return `anula el egreso ${egreso.id}`
    }

    /** Cierra el turno con lo esperado o con una diferencia (motivo) y abre otro. */
    private async cerrar_caja() {
        const empresaId = this.azar.elegir(this.empresas)
        const cajaId = this.e.cajas.get(empresaId)!
        const turno = (await db
            .from('ledger.cajas_turnos')
            .where('caja_id', cajaId)
            .whereNull('cerrado_en')
            .select('id', 'fondo_inicial')
            .firstOrFail()) as { id: number; fondo_inicial: string }
        const cobrado = await db
            .from('billing.pagos')
            .where('turno_id', turno.id)
            .where('estado', 'registrado')
            .select(db.raw('coalesce(sum(monto - retenido), 0)::text as total'))
            .firstOrFail()
        const aProveedores = (await db
            .from('ledger.pagos_proveedores as pp')
            .where('pp.turno_id', turno.id)
            .whereNotExists((q) =>
                q.from('ledger.pagos_proveedores_anulaciones as x').whereRaw('x.pago_id = pp.id'),
            )
            .select(db.raw('coalesce(sum(pp.monto), 0)::text as total'))
            .firstOrFail()) as { total: string }
        const egresado = await db
            .from('ledger.egresos as e')
            .where('e.turno_id', turno.id)
            .whereNotExists((q) => q.from('ledger.egresos_anulaciones as x').whereRaw('x.egreso_id = e.id'))
            .select(db.raw('coalesce(sum(e.monto), 0)::text as total'))
            .firstOrFail()
        const depositado = (await db
            .from('ledger.depositos')
            .where('turno_id', turno.id)
            .select(db.raw('coalesce(sum(monto), 0)::text as total'))
            .firstOrFail()) as { total: string }
        const esperado =
            centavosDe(turno.fondo_inicial) +
            centavosDe(cobrado.total) -
            centavosDe(egresado.total) -
            centavosDe(depositado.total) -
            centavosDe(aProveedores.total)
        const diferencia = this.azar.moneda(0.3) ? 0n : this.azar.centavos(-2500, 2500)
        const contado = esperado + diferencia < 0n ? 0n : esperado + diferencia
        const cerrado = await new CerrarCaja().execute(
            {
                caja_id: cajaId,
                contado: texto(contado),
                motivo: contado === esperado ? null : 'auditoría: diferencia de caja',
            },
            this.ctx,
        )
        const fondo = this.azar.centavos(0, 20000)
        await new AbrirCaja().execute({ caja_id: cajaId, fondo_inicial: texto(fondo) }, this.ctx)
        return `cierra el turno ${turno.id} de la empresa ${empresaId}: esperado ${cerrado.esperado}, contado ${cerrado.contado}, diferencia ${cerrado.diferencia} (elegida ${texto(diferencia)}); abre con ${texto(fondo)}`
    }

    /**
     * Pago histórico (y a veces su factura importada) con fecha de agosto o septiembre. Si ese mes
     * está cerrado en la empresa, la acción **debe** responder 422 `periodo_cerrado` sin escribir.
     */
    private async historico() {
        const cliente = this.azar.elegir(this.clientes)
        const empresaId = this.azar.elegir(cliente.empresas)
        const periodo = this.azar.elegir(MESES_CERRABLES)
        const fecha = `${periodo.slice(0, 8)}${String(this.azar.entero(1, 28)).padStart(2, '0')}`
        const cerrado = this.cierres.get(`${empresaId}|${periodo}`)!.cerrado
        const total = this.azar.centavos(1000, 30000)
        const idFactura = this.nuevaReferencia('hist-fact')
        const importar = () =>
            new ImportarFacturaPendiente().execute(
                {
                    origen: 'auditoria',
                    id_externo: idFactura,
                    cliente_id: cliente.id,
                    empresa_id: empresaId,
                    cargo_unico: true,
                    emitida_en: fecha,
                    total: texto(total),
                    concepto: 'Cargo histórico',
                },
                this.ctx,
            )
        const monto = this.azar.centavos(500, 30000)
        const pagar = (facturas?: number[]) =>
            new RegistrarPagoHistorico().execute(
                {
                    historico: true,
                    origen: 'auditoria',
                    id_externo: this.nuevaReferencia('hist-pago'),
                    cliente_id: cliente.id,
                    metodo: 'deposito',
                    monto: texto(monto),
                    fecha,
                    empresa_id: empresaId,
                    ...(facturas ? { facturas } : {}),
                },
                this.ctx,
            )
        if (cerrado) {
            for (const [nombre, intento] of [
                ['factura importada', importar],
                ['pago histórico', () => pagar()],
            ] as const) {
                try {
                    await intento()
                } catch (error) {
                    if (
                        error instanceof Problema &&
                        error.status === 422 &&
                        error.tipo.endsWith('periodo_cerrado')
                    ) {
                        continue
                    }
                    throw error
                }
                throw new RechazoEsperadoNoOcurrio(
                    `${nombre} con fecha ${fecha} aceptado aunque ${periodo.slice(0, 7)} está cerrado en la empresa ${empresaId}`,
                )
            }
            return `mes cerrado: factura y pago histórico del ${fecha} rechazados (422 periodo_cerrado)`
        }
        const factura = this.azar.moneda(0.6) ? await importar() : null
        // la factura importada pudo quedar saldada al aplicarle un anticipo del cliente: el pago va sin ella
        const viva = factura?.factura_id
            ? await db
                  .from('billing.facturas')
                  .where('id', factura.factura_id)
                  .whereIn('estado', ['emitida', 'parcial', 'vencida'])
                  .first()
            : null
        const pago = await pagar(viva ? [factura!.factura_id!] : undefined)
        await this.marcarMesCambiado(empresaId, fecha)
        return `histórico del ${fecha} en la empresa ${empresaId}: ${factura ? `factura ${factura.factura_id} de ${texto(total)} y ` : ''}pago ${pago.id} de ${texto(monto)}`
    }

    /**
     * Cierra o reabre agosto/septiembre de una empresa. Volver a cerrar sin asientos nuevos en el
     * mes debe dejar la misma foto.
     */
    private async cierre_mes() {
        const empresaId = this.azar.elegir(this.empresas)
        const periodo = this.azar.elegir(MESES_CERRABLES)
        const estado = this.cierres.get(`${empresaId}|${periodo}`)!
        const [anio, mes] = periodo.split('-').map((x) => Number.parseInt(x, 10)) as [number, number]
        if (estado.cerrado) {
            await new ReabrirPeriodo().execute(
                { empresa_id: empresaId, anio, mes, motivo: 'auditoría: reapertura' },
                this.ctx,
            )
            estado.cerrado = false
            return `reabre ${periodo.slice(0, 7)} en la empresa ${empresaId}`
        }
        // lista de verificación (§10.5, fase 6 PR B): el escenario deja anomalías legítimas (2.9.01 de las
        // importadas, cuotas aún sin correr…); el contador las supervisa con su nota y el cierre sigue
        // (18.check_mal_formado revisa cada supervisión). Sin esto, todo cierre_mes sería un 422.
        const verificacion = await new VerificarCierre().execute(
            { empresa_id: empresaId, tipo: 'mensual', periodo: periodo.slice(0, 7) },
            this.ctx,
        )
        const supervisados: string[] = []
        for (const check of verificacion.checks.filter((c) => c.estado === 'anomalia')) {
            await new RevisarCheck().execute(
                {
                    check_id: check.id,
                    estado: 'supervisado',
                    nota: `auditoría: ${check.clave} supervisado en el escenario`,
                },
                this.ctx,
            )
            supervisados.push(check.clave)
        }
        const cierre = await new CerrarPeriodo().execute({ empresa_id: empresaId, anio, mes }, this.ctx)
        const foto = normalizarResumen(cierre.resumen)
        if (estado.foto && !estado.cambiado && JSON.stringify(estado.foto) !== JSON.stringify(foto)) {
            this.extra.push({
                invariante: '7.reabrir_y_cerrar_cambia_la_foto',
                detalle: { empresaId, periodo, antes: estado.foto, despues: foto },
            })
        }
        estado.cerrado = true
        estado.foto = foto
        estado.cambiado = false
        return `cierra ${periodo.slice(0, 7)} en la empresa ${empresaId}: ${foto.asientos} asientos, debe ${foto.debe}${supervisados.length > 0 ? ` (supervisados: ${supervisados.join(', ')})` : ''}`
    }

    /*
    |--------------------------------------------------------------------------
    | Pasos de la fase 3 (FEL)
    |--------------------------------------------------------------------------
    */

    /** Facturas vivas con un DTE en el estado dado (de las dos empresas). */
    private async facturasConDte(estados: string[], extra = '') {
        const { rows } = (await db.rawQuery(
            `SELECT f.id, f.tipo, f.total::text, f.pagado::text, f.estado, f.cliente_id, d.id AS dte_id, d.estado AS dte_estado
               FROM billing.facturas f
               JOIN fiscal.dte d ON d.documento_id = f.id
                AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
              WHERE f.empresa_id = ANY(?::bigint[]) AND f.estado <> 'anulada' AND d.estado = ANY(?::text[]) ${extra}
              ORDER BY f.id`,
            [this.empresas, estados],
        )) as {
            rows: Array<{
                id: number
                tipo: string
                total: string
                pagado: string
                estado: string
                cliente_id: number
                dte_id: number
                dte_estado: string
            }>
        }
        return rows
    }

    /**
     * Una corrida de la cola `fel`. A veces el certificador falso responde mal a lo siguiente
     * (error temporal, caída después de certificar o rechazo) y a veces los reintentos ya vencieron.
     */
    private async cola_fel() {
        const respuesta = this.azar.ponderado({ bien: 6, error_temporal: 2, caida: 2, rechazado: 1 })
        if (respuesta !== 'bien') controlFelFalso.siguiente.push(respuesta)
        if (this.azar.moneda(0.5)) {
            await db
                .from('fiscal.dte')
                .whereIn('empresa_id', this.empresas)
                .whereIn('estado', ['error_temporal', 'anulacion_pendiente'])
                .whereNotNull('proximo_intento')
                .update({ proximo_intento: db.knexRawQuery('now()') } as Record<string, unknown>)
        }
        const r = await procesarColaFel(this.ctx)
        controlFelFalso.siguiente = []
        return `cola fel (${respuesta}): ${r.solicitados} pedidos, ${r.enviados} enviados, ${r.anulados} anulados, ${r.errores} errores`
    }

    /** `POST /facturas/:id/certificar` a mano (un aviso se certifica aunque no esté cubierto). */
    private async certificar_manual() {
        const todas = await pendientes(this.empresas)
        const lista = todas.filter((f) => f.tipo === 'servicio')
        if (lista.length === 0) return 'sin facturas'
        const factura = this.azar.elegir(lista)
        const r = await new SolicitarCertificacion().execute({ factura_id: factura.id }, this.ctx)
        return `certificar a mano la factura ${factura.id} (empresa ${factura.empresa_id}): DTE ${r.dte?.id} ${r.dte?.estado} (${r.motivo ?? 'nuevo'})`
    }

    /** El certificador rechaza (definitivo) lo próximo que se envíe. */
    private async rechazo_sat() {
        controlFelFalso.siguiente.push('rechazado')
        const r = await procesarColaFel(this.ctx)
        controlFelFalso.siguiente = []
        return `rechazo de la SAT: ${r.enviados} enviados, ${r.errores} errores`
    }

    /** `POST /dte/:id/reintentar` de un DTE rechazado (dato corregido) o con error temporal. */
    private async reintentar_dte() {
        const { rows } = (await db.rawQuery(
            `SELECT d.id, d.estado, d.ultimo_error FROM fiscal.dte d
              WHERE d.empresa_id = ANY(?::bigint[]) AND d.estado IN ('rechazado', 'error_temporal')
                AND coalesce(d.ultimo_error, '') <> 'documento_anulado'
              ORDER BY d.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number; estado: string; ultimo_error: string | null }> }
        if (rows.length === 0) return 'sin DTE para reintentar'
        const dte = this.azar.elegir(rows)
        const nuevo = await new ReintentarDte().execute({ dte_id: Number(dte.id) }, this.ctx)
        return `reintentar el DTE ${dte.id} (${dte.estado}: ${dte.ultimo_error}) → DTE ${nuevo.id} ${nuevo.estado}`
    }

    /** Activa o levanta la contingencia de la empresa B (obligatoria). */
    private async contingencia() {
        const actual = await configuracionFel(this.e.B)
        await new CambiarContingenciaFel().execute(
            { empresa_id: this.e.B, activa: !actual.contingencia_activa, motivo: 'auditoría: contingencia' },
            { ...this.ctx, empresaId: this.e.B },
        )
        return `contingencia de la empresa ${this.e.B}: ${actual.contingencia_activa ? 'se levanta' : 'se activa'}`
    }

    /** `facturas.anular` sobre una factura certificada (dos pasos; a veces corre la cola enseguida). */
    private async anular_dte() {
        const lista = await this.facturasConDte(['certificado'], `AND f.pagado = 0`)
        if (lista.length === 0) return 'sin facturas certificadas anulables'
        const f = this.azar.elegir(lista)
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'auditoría: anular DTE' }, this.ctx)
        let detalle = `anular la factura ${f.id} (${f.tipo}) con DTE ${f.dte_id} certificado`
        if (this.azar.moneda(0.6)) {
            const r = await procesarColaFel(this.ctx)
            detalle += `; cola: ${r.anulados} anulados, ${r.errores} errores`
        }
        return detalle
    }

    /** Nota de crédito por línea (NCRE si la factura está certificada; interna si es un aviso sin DTE). */
    private async ncre_linea() {
        const lista = await pendientes(this.empresas)
        if (lista.length === 0) return 'sin facturas pendientes'
        const factura = this.azar.elegir(lista)
        const lineas = (await db
            .from('billing.facturas_lineas as l')
            .where('l.factura_id', factura.id)
            .select(
                'l.id',
                db.raw(
                    `(l.total - (SELECT coalesce(sum(nl.monto), 0) FROM billing.notas_credito_lineas nl WHERE nl.linea_id = l.id))::text AS resto`,
                ),
            )) as Array<{ id: number; resto: string }>
        const conResto = lineas.filter((l) => centavosDe(l.resto) > 0n)
        if (conResto.length === 0) return `factura ${factura.id} sin líneas por acreditar`
        const linea = this.azar.elegir(conResto)
        const pendiente = centavosDe(factura.total) - centavosDe(factura.pagado)
        const tope = centavosDe(linea.resto) < pendiente ? centavosDe(linea.resto) : pendiente
        const monto = this.azar.moneda(0.4) ? tope : this.parcial(tope)
        const nota = await new EmitirNotaCredito().execute(
            {
                factura_id: factura.id,
                motivo: 'auditoría: nota por línea',
                lineas: [{ linea_id: Number(linea.id), monto: texto(monto) }],
            },
            this.ctx,
        )
        return `nota por línea ${nota.id} de ${texto(monto)} (IVA ${nota.iva}) a la línea ${linea.id} de la factura ${factura.id}`
    }

    /** `facturas.sustituir` (NIT mal emitido): NCRE si está certificada, anulación si no. */
    private async sustituir() {
        const { rows } = (await db.rawQuery(
            `SELECT f.id FROM billing.facturas f
              WHERE f.empresa_id = ANY(?::bigint[]) AND f.tipo = 'servicio'
                AND f.estado IN ('emitida', 'vencida', 'por_certificar')
                AND NOT EXISTS (SELECT 1 FROM billing.sustituciones s WHERE s.original_id = f.id)
                AND NOT EXISTS (SELECT 1 FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
                                 WHERE a.factura_id = f.id AND p.estado = 'registrado')
              ORDER BY f.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number }> }
        if (rows.length === 0) return 'sin facturas sustituibles'
        const f = this.azar.elegir(rows)
        const r = await new SustituirFactura().execute(
            {
                factura_id: Number(f.id),
                motivo: 'auditoría: NIT mal emitido',
                cliente_fiscal: {
                    tipo_documento_fiscal: 'nit',
                    nit_cui: '12345679',
                    nombre_fiscal: 'Corregido, S.A.',
                },
            },
            this.ctx,
        )
        return `sustituir la factura ${f.id} por la ${r.nueva.id} (${r.tipo}${r.nota_credito_id ? `, nota ${r.nota_credito_id}` : ''})`
    }

    /**
     * Cubre un aviso por completo y anula el pago, antes o después de que la cola lo certifique: el
     * DTE certificado nunca se revierte y el IVA queda donde debe (§10.1).
     */
    private async pagar_aviso_y_anular() {
        const { rows } = (await db.rawQuery(
            `SELECT f.id, f.cliente_id, f.empresa_id, (f.total - f.pagado)::text AS pendiente FROM billing.facturas f
              WHERE f.empresa_id = ANY(?::bigint[]) AND f.aviso_cobro AND f.estado IN ('emitida', 'parcial', 'vencida')
              ORDER BY f.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number; cliente_id: number; empresa_id: number; pendiente: string }> }
        if (rows.length === 0) return 'sin avisos pendientes'
        const f = this.azar.elegir(rows)
        const pago = await this.pagar({
            cliente_id: f.cliente_id,
            metodo: 'caja',
            monto: f.pendiente,
            facturas: [Number(f.id)],
            empresa_id: Number(f.empresa_id),
        })
        const despues = this.azar.moneda()
        let detalle = `paga ${f.pendiente} del aviso ${f.id}`
        if (despues) {
            const r = await procesarColaFel(this.ctx)
            detalle += `; cola: ${r.solicitados} pedidos, ${r.enviados} enviados`
            // los DTE recién certificados ya son hechos fiscales: anular el pago no los toca
            this.dtes = await this.estadosDte()
        }
        for (const p of pago.pagos) {
            await new AnularPago().execute({ pago_id: p.id, motivo: 'auditoría: aviso anulado' }, this.ctx)
        }
        return `${detalle}; anula el pago ${despues ? 'después' : 'antes'} de certificar`
    }

    /*
    |--------------------------------------------------------------------------
    | Pasos de la fase 4 (cobros, bancos y cartera; §10.3 y §10.9)
    |--------------------------------------------------------------------------
    */

    /** Proveedor de cobro de la pasarela falsa (desde hoy) y una segunda cuenta bancaria por empresa. */
    private async prepararFase4() {
        for (const empresaId of this.empresas) {
            const p = await new CrearProveedorCobro().execute(
                {
                    empresa_id: empresaId,
                    metodo: 'pasarela',
                    pasarela: 'falsa',
                    nombre: 'Pasarela del auditor',
                    cuenta_bancaria_id: this.e.cuentas.get(empresaId)!,
                },
                this.ctx,
            )
            this.proveedores.set(empresaId, Number(p.id))
            const otra = await cuentaBancariaPrueba('Banrural', empresaId)
            this.segundas.set(empresaId, Number(otra.id))
        }
    }

    private async cuentaLibro(cuentaBancariaId: number): Promise<number> {
        const fila = (await db
            .from('billing.cuentas_bancarias')
            .where('id', cuentaBancariaId)
            .select('cuenta_id')
            .firstOrFail()) as { cuenta_id: number }
        return Number(fila.cuenta_id)
    }

    /** Liquidación de la pasarela: algunos pagos sin liquidar y todos los contracargos pendientes. */
    private async liquidar() {
        const empresaId = this.azar.elegir(this.empresas)
        const proveedorId = this.proveedores.get(empresaId)!
        const { rows: pagos } = (await db.rawQuery(
            `SELECT p.id, p.monto::text FROM billing.pagos p
              WHERE p.proveedor_cobro_id = ? AND p.estado = 'registrado'
                AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
              ORDER BY p.id`,
            [proveedorId],
        )) as { rows: Array<{ id: number; monto: string }> }
        const { rows: contra } = (await db.rawQuery(
            `SELECT p.id, p.monto::text FROM billing.pagos p
              WHERE p.proveedor_cobro_id = ? AND p.estado = 'anulado'
                AND EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
                AND NOT EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'contracargo')
              ORDER BY p.id`,
            [proveedorId],
        )) as { rows: Array<{ id: number; monto: string }> }
        const elegidos = pagos.filter(() => this.azar.moneda(0.7))
        if (elegidos.length === 0 && pagos.length > 0) elegidos.push(pagos[0]!)
        const bruto =
            elegidos.reduce((s, p) => s + centavosDe(p.monto), 0n) -
            contra.reduce((s, p) => s + centavosDe(p.monto), 0n)
        if (bruto <= 0n) return `empresa ${empresaId}: nada que liquidar (bruto ${texto(bruto)})`
        const comision = this.azar.centavos(0, Number(bruto / 20n))
        const l = await new LiquidarCobros().execute(
            {
                proveedor_cobro_id: proveedorId,
                referencia: this.nuevaReferencia('LIQ'),
                bruto: texto(bruto),
                comision: texto(comision),
                pagos: elegidos.map((p) => Number(p.id)),
                contracargos: contra.map((p) => Number(p.id)),
            },
            this.ctx,
        )
        this.porExtracto.push({
            tipo: 'liquidacion',
            id: Number(l.id),
            empresaId,
            cuentaId: Number(l.cuenta_id),
            monto: texto(bruto - comision),
            referencia: l.referencia,
        })
        return `liquidación ${l.id} de la empresa ${empresaId}: ${elegidos.length} pagos, ${contra.length} contracargos, bruto ${texto(bruto)}, comisión ${texto(comision)}`
    }

    /** Contracargo: se anula un pago de pasarela ya liquidado (1.1.10.NN queda negativo hasta la próxima). */
    private async contracargo() {
        const { rows } = (await db.rawQuery(
            `SELECT p.id, p.monto::text FROM billing.pagos p
              WHERE p.empresa_id = ANY(?::bigint[]) AND p.estado = 'registrado' AND p.proveedor_cobro_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro')
              ORDER BY p.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number; monto: string }> }
        if (rows.length === 0) return 'sin pagos liquidados'
        const p = this.azar.elegir(rows)
        await new AnularPago().execute({ pago_id: Number(p.id), motivo: 'auditoría: contracargo' }, this.ctx)
        return `contracargo: anula el pago liquidado ${p.id} (${p.monto})`
    }

    /** Depósito de una parte del efectivo del turno abierto. */
    private async depositar() {
        const empresaId = this.azar.elegir(this.empresas)
        const cajaId = this.e.cajas.get(empresaId)!
        const { rows } = (await db.rawQuery(
            `SELECT t.id, (t.fondo_inicial
                    + coalesce((SELECT sum(p.monto - p.retenido) FROM billing.pagos p WHERE p.turno_id = t.id AND p.estado = 'registrado'), 0)
                    - coalesce((SELECT sum(pp.monto) FROM ledger.pagos_proveedores pp WHERE pp.turno_id = t.id
                                 AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = pp.id)), 0)
                    - coalesce((SELECT sum(e.monto) FROM ledger.egresos e WHERE e.turno_id = t.id
                                 AND NOT EXISTS (SELECT 1 FROM ledger.egresos_anulaciones x WHERE x.egreso_id = e.id)), 0)
                    - coalesce((SELECT sum(d.monto) FROM ledger.depositos d WHERE d.turno_id = t.id), 0))::text AS efectivo
               FROM ledger.cajas_turnos t WHERE t.caja_id = ? AND t.cerrado_en IS NULL`,
            [cajaId],
        )) as { rows: Array<{ efectivo: string }> }
        const efectivo = centavosDe(rows[0]?.efectivo ?? '0')
        if (efectivo < 100n) return `caja de la empresa ${empresaId} sin efectivo para depositar`
        const monto = this.azar.centavos(100, Number(efectivo))
        const cuenta = this.azar.moneda() ? this.e.cuentas.get(empresaId)! : this.segundas.get(empresaId)!
        const boleta = this.nuevaReferencia('BOL')
        const d = await new DepositarCaja().execute(
            { caja_id: cajaId, monto: texto(monto), boleta, cuenta_bancaria_id: cuenta },
            this.ctx,
        )
        this.porExtracto.push({
            tipo: 'deposito',
            id: Number(d.id),
            empresaId,
            cuentaId: await this.cuentaLibro(cuenta),
            monto: texto(monto),
            referencia: boleta,
        })
        return `depósito ${d.id} de ${texto(monto)} de la caja de la empresa ${empresaId} (efectivo ${texto(efectivo)})`
    }

    /** Traslado entre las dos cuentas bancarias de la empresa. */
    private async trasladar() {
        const empresaId = this.azar.elegir(this.empresas)
        const [a, b] = this.azar.moneda()
            ? [this.e.cuentas.get(empresaId)!, this.segundas.get(empresaId)!]
            : [this.segundas.get(empresaId)!, this.e.cuentas.get(empresaId)!]
        const monto = this.azar.centavos(100, 20000)
        const referencia = this.nuevaReferencia('TR')
        const t = await new TrasladarFondos().execute(
            {
                monto: texto(monto),
                referencia,
                origen: { cuenta_bancaria_id: a },
                destino: { cuenta_bancaria_id: b },
            },
            this.ctx,
        )
        this.porExtracto.push({
            tipo: 'traslado',
            id: Number(t.id),
            empresaId,
            cuentaId: await this.cuentaLibro(b),
            monto: texto(monto),
            referencia,
        })
        return `traslado ${t.id} de ${texto(monto)} en la empresa ${empresaId}`
    }

    /**
     * Extracto de una cuenta: las llegadas que le tocan (depósitos, traslados, liquidaciones),
     * a veces una comisión y un interés sin documento. Encadena con el anterior de la cuenta.
     */
    private async extracto() {
        const empresaId = this.azar.elegir(this.empresas)
        const cuentaBancaria = this.azar.moneda()
            ? this.e.cuentas.get(empresaId)!
            : this.segundas.get(empresaId)!
        const cuentaId = await this.cuentaLibro(cuentaBancaria)
        const llegan = this.porExtracto.filter((x) => x.cuentaId === cuentaId && this.azar.moneda(0.8))
        const hoy = DateTime.now().setZone('America/Guatemala').toISODate()!
        const lineas: Array<{
            fecha: string
            descripcion: string
            referencia: string | null
            monto: string
        }> = llegan.map((x) => ({
            fecha: hoy,
            descripcion: `ABONO ${x.tipo.toUpperCase()}`,
            referencia: x.referencia,
            monto: x.monto,
        }))
        if (this.azar.moneda(0.6)) {
            lineas.push({
                fecha: hoy,
                descripcion: 'COMISION MANEJO CUENTA',
                referencia: this.nuevaReferencia('COM'),
                monto: texto(-this.azar.centavos(100, 2500)),
            })
        }
        if (this.azar.moneda(0.3)) {
            lineas.push({
                fecha: hoy,
                descripcion: 'INTERESES',
                referencia: this.nuevaReferencia('INT'),
                monto: texto(this.azar.centavos(1, 900)),
            })
        }
        if (lineas.length === 0) return `cuenta ${cuentaId}: nada para el extracto`
        const inicial = this.saldosExtracto.get(cuentaId) ?? 0n
        const final = inicial + lineas.reduce((s, l) => s + centavosDe(l.monto), 0n)
        const ext = await new ImportarExtracto().execute(
            {
                cuenta_bancaria_id: cuentaBancaria,
                desde: hoy,
                hasta: hoy,
                saldo_inicial: texto(inicial),
                saldo_final: texto(final),
                archivo: `${this.nuevaReferencia('EXT')}.csv`,
                lineas,
            },
            this.ctx,
        )
        this.saldosExtracto.set(cuentaId, final)
        const filas = (await db
            .from('ledger.extractos_lineas')
            .where('extracto_id', ext.id)
            .orderBy('orden')
            .select('id')) as Array<{ id: number }>
        filas.forEach((f, i) => {
            const doc = llegan[i]
            this.lineasDoc.set(
                Number(f.id),
                doc ? { tipo: doc.tipo, id: doc.id } : { tipo: 'suelta', id: Number(f.id) },
            )
        })
        this.porExtracto = this.porExtracto.filter((x) => !llegan.includes(x))
        return `extracto ${ext.id} de la cuenta ${cuentaId} (empresa ${empresaId}): ${lineas.length} líneas, ${texto(inicial)} → ${texto(final)}`
    }

    /** Movimiento del libro, en la cuenta de la línea, que la línea ya tiene (para volver a conciliar). */
    private async movimientoDe(lineaId: number, doc: { tipo: string; id: number }): Promise<number | null> {
        const origen =
            doc.tipo === 'liquidacion' ? 'liquidacion_cobro' : doc.tipo === 'suelta' ? 'banco' : doc.tipo
        const { rows } = (await db.rawQuery(
            `SELECT m.id FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
               JOIN ledger.extractos_lineas el ON el.id = ? AND el.cuenta_id = m.cuenta_id
              WHERE a.origen_tipo = ? AND a.origen_id = ? AND a.reversa_de IS NULL AND m.debe - m.haber = el.monto
              ORDER BY m.id DESC LIMIT 1`,
            [lineaId, origen, doc.id],
        )) as { rows: Array<{ id: number }> }
        return rows[0] ? Number(rows[0].id) : null
    }

    /** Concilia una línea libre con lo que le corresponde (o la registra si no tiene documento). */
    private async conciliar() {
        const { rows } = (await db.rawQuery(
            `SELECT el.id FROM ledger.extractos_lineas el
              WHERE el.empresa_id = ANY(?::bigint[])
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones c WHERE c.linea_id = el.id
                                 AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id))
              ORDER BY el.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number }> }
        if (rows.length === 0) return 'sin líneas por conciliar'
        const lineaId = Number(this.azar.elegir(rows).id)
        const doc = this.lineasDoc.get(lineaId)
        if (!doc) return `línea ${lineaId} sin documento conocido`
        const acreditado =
            doc.tipo === 'deposito' || doc.tipo === 'traslado'
                ? await db
                      .from('ledger.transitos_acreditados')
                      .where({ tipo: doc.tipo, documento_id: doc.id })
                      .first()
                : null
        const registrada =
            doc.tipo === 'suelta'
                ? await db.from('ledger.asientos').where({ origen_tipo: 'banco', origen_id: lineaId }).first()
                : null
        if ((doc.tipo === 'deposito' || doc.tipo === 'traslado') && !acreditado) {
            await new ConciliarLinea().execute(
                {
                    linea_id: lineaId,
                    ...(doc.tipo === 'deposito' ? { depositos: [doc.id] } : { traslados: [doc.id] }),
                },
                this.ctx,
            )
            return `concilia la línea ${lineaId} con la llegada del ${doc.tipo} ${doc.id}`
        }
        if (doc.tipo === 'suelta' && !registrada) {
            const linea = (await db.from('ledger.extractos_lineas').where('id', lineaId).firstOrFail()) as {
                monto: string
            }
            await new RegistrarDesdeExtracto().execute(
                { linea_id: lineaId, ...(centavosDe(linea.monto) > 0n ? { cuenta: '4.1.03' } : {}) },
                this.ctx,
            )
            return `registra y concilia la línea suelta ${lineaId} (${linea.monto})`
        }
        const movimiento = await this.movimientoDe(lineaId, doc)
        if (!movimiento) return `línea ${lineaId}: sin movimiento para ${doc.tipo} ${doc.id}`
        await new ConciliarLinea().execute({ linea_id: lineaId, movimientos: [movimiento] }, this.ctx)
        return `concilia la línea ${lineaId} con el movimiento ${movimiento} (${doc.tipo} ${doc.id})`
    }

    /** Deshace una conciliación vigente (nunca toca el libro). */
    private async anular_conciliacion() {
        const { rows } = (await db.rawQuery(
            `SELECT min(c.id) AS id FROM ledger.conciliaciones c
              WHERE c.empresa_id = ANY(?::bigint[])
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = c.id)
              GROUP BY c.grupo ORDER BY 1`,
            [this.empresas],
        )) as { rows: Array<{ id: number }> }
        if (rows.length === 0) return 'sin conciliaciones'
        const c = this.azar.elegir(rows)
        await new AnularConciliacion().execute(
            { conciliacion_id: Number(c.id), motivo: 'auditoría: línea equivocada' },
            this.ctx,
        )
        return `anula la conciliación ${c.id}`
    }

    /** Paga casi todo (deja de 1 a 100 centavos) y cierra la diferencia. */
    private async cerrar_diferencia() {
        const todas = await pendientes(this.empresas)
        const lista = todas.filter((f) => centavosDe(f.total) - centavosDe(f.pagado) > 100n)
        if (lista.length === 0) return 'sin facturas con saldo'
        const f = this.azar.elegir(lista)
        const falta = this.azar.centavos(1, 100)
        const monto = centavosDe(f.total) - centavosDe(f.pagado) - falta
        const r = await this.pagar({
            cliente_id: f.cliente_id,
            metodo: 'caja',
            monto: texto(monto),
            facturas: [f.id],
            empresa_id: f.empresa_id,
        })
        // paso compuesto: el pago ya quedó; un rechazo del cierre (p. ej. DTE en contingencia) es parte del detalle
        try {
            const cerrada = await new CerrarDiferenciaPago().execute({ pago_id: r.pagos[0]!.id }, this.ctx)
            return `paga ${texto(monto)} de la factura ${f.id} y cierra la diferencia de ${cerrada.monto}`
        } catch (error) {
            if (!(error instanceof Problema) || error.status >= 500) throw error
            return `paga ${texto(monto)} de la factura ${f.id}; el cierre de la diferencia se rechaza: ${error.status} ${error.tipo.split(':').at(-1)}`
        }
    }

    private async provisionar() {
        const empresaId = this.azar.elegir(this.empresas)
        const p = await new ProvisionarCartera().execute({ empresa_id: empresaId, anio: 2026 }, this.ctx)
        return `estimación de la empresa ${empresaId}: base ${p.base}, tope ${p.tope}, monto ${p.monto}`
    }

    /** Castiga una o dos facturas pendientes de un cliente en una empresa. */
    private async castigar() {
        const lista = await pendientes(this.empresas)
        if (lista.length === 0) return 'sin cartera'
        const f = this.azar.elegir(lista)
        const otras = lista.filter(
            (x) => x.cliente_id === f.cliente_id && x.empresa_id === f.empresa_id && x.id !== f.id,
        )
        const facturas = [
            f.id,
            ...(otras.length > 0 && this.azar.moneda() ? [this.azar.elegir(otras).id] : []),
        ]
        const k = await new CastigarCartera().execute(
            { facturas, motivo: 'auditoría: incobrable', evidencia: 'tres gestiones de cobro documentadas' },
            this.ctx,
        )
        return `castigo ${k.id} del cliente ${f.cliente_id} (empresa ${f.empresa_id}): facturas ${facturas.join(', ')}, ${k.monto} (IVA ${k.iva}, estimación ${k.estimacion}, gasto ${k.gasto})`
    }

    /*
    |--------------------------------------------------------------------------
    | Fase 5 de A3: compras, proveedores, retenciones, activos y diferidos
    |--------------------------------------------------------------------------
    */

    private async prepararFase5() {
        for (const empresaId of this.empresas) {
            const general = await proveedorEn(empresaId, this.ctx, { dias_credito: 30 })
            const pequeno = await proveedorEn(empresaId, this.ctx, { tipo: 'pequeno_contribuyente' })
            this.proveedoresCompra.set(empresaId, {
                general: Number(general.id),
                pequeno: Number(pequeno.id),
            })
        }
        await hacerAgenteRetencion(this.e.B, this.ctx)
    }

    /** Medio de pago al contado de la empresa: su caja, su cuenta bancaria o la segunda. */
    private medio(empresaId: number) {
        const cual = this.azar.entero(0, 2)
        if (cual === 0) return { metodo: 'caja' as const, caja_id: this.e.cajas.get(empresaId)! }
        return {
            metodo: 'cuenta_bancaria' as const,
            cuenta_bancaria_id: cual === 1 ? this.e.cuentas.get(empresaId)! : this.segundas.get(empresaId)!,
        }
    }

    /** Compra al crédito o al contado (FACT o FPEQ), con líneas de servicio, bien, activo fijo o gasto diferido. */
    private async compra() {
        const empresaId = this.azar.elegir(this.empresas)
        const prov = this.proveedoresCompra.get(empresaId)!
        const pequena = this.azar.moneda(0.2)
        const credito = this.azar.moneda(0.6)
        const lineas = Array.from({ length: this.azar.entero(1, 3) }, (_, i) => {
            const total = texto(this.azar.centavos(500, 900000))
            const tipo = this.azar.elegir(['servicio', 'bien', 'activo', 'diferido', 'exenta'] as const)
            if (tipo === 'activo' && !pequena) {
                return {
                    descripcion: `auditoría: equipo ${i}`,
                    tipo: 'activo_fijo' as const,
                    clase_activo: 'equipo_red' as const,
                    total,
                }
            }
            if (tipo === 'diferido') {
                return {
                    descripcion: `auditoría: licencia ${i}`,
                    tipo: 'servicio' as const,
                    categoria: 'otros',
                    total,
                    diferir_meses: this.azar.entero(2, 12),
                }
            }
            if (tipo === 'exenta' && !pequena) {
                return {
                    descripcion: `auditoría: exento ${i}`,
                    tipo: 'servicio' as const,
                    categoria: 'otros',
                    total,
                    exento: true,
                }
            }
            return {
                descripcion: `auditoría: ${tipo} ${i}`,
                tipo: tipo === 'bien' ? ('bien' as const) : ('servicio' as const),
                categoria: 'otros',
                total,
            }
        })
        const c = await new RegistrarCompra().execute(
            {
                proveedor_id: pequena ? prov.pequeno : prov.general,
                tipo_documento: pequena ? 'FPEQ' : 'FACT',
                numero: this.nuevaReferencia('C'),
                fecha_documento: this.azar.elegir(FECHAS_COMPRA),
                condicion: credito ? 'credito' : 'contado',
                // B es agente de retención: sin lista, el producto sugiere las suyas
                ...(empresaId === this.e.B && this.azar.moneda() ? {} : { retenciones: [] }),
                ...(credito ? {} : this.medio(empresaId)),
                lineas,
            },
            this.ctx,
        )
        return `compra ${c.id} ${c.tipo_documento} ${c.condicion} de la empresa ${empresaId}: total ${c.total}, IVA ${c.iva}, retenciones ${c.retencion_iva}/${c.retencion_isr}, ${lineas.length} líneas (${lineas.map((l) => l.tipo + ('diferir_meses' in l ? '/diferida' : '') + ('exento' in l ? '/exenta' : '')).join(', ')})`
    }

    private async comprasAlCredito() {
        const { rows } = (await db.rawQuery(
            `SELECT c.id, c.empresa_id, c.proveedor_id,
                    (c.total - c.retencion_iva - c.retencion_isr
                     - coalesce((SELECT sum(n.total) FROM ledger.compras n WHERE n.compra_referencia_id = c.id AND n.tipo_documento = 'NCRE'
                                  AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = n.id)), 0)
                     - coalesce((SELECT sum(a.monto) FROM ledger.pagos_proveedores_aplicaciones a WHERE a.compra_id = c.id
                                  AND NOT EXISTS (SELECT 1 FROM ledger.pagos_proveedores_anulaciones x WHERE x.pago_id = a.pago_id)), 0))::text AS saldo
               FROM ledger.compras c
              WHERE c.empresa_id = ANY(?::bigint[]) AND c.condicion = 'credito' AND c.tipo_documento <> 'NCRE'
                AND NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = c.id)
              ORDER BY c.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number; empresa_id: number; proveedor_id: number; saldo: string }> }
        return rows.filter((r) => centavosDe(r.saldo) > 0n)
    }

    private async ncre_compra() {
        const todas = await this.comprasAlCredito()
        const compras = todas.filter((c) => {
            const p = this.proveedoresCompra.get(Number(c.empresa_id))
            return p?.general === Number(c.proveedor_id)
        })
        if (compras.length === 0) return 'sin compras al crédito con saldo'
        const c = this.azar.elegir(compras)
        const total = this.azar.centavos(1, Number(centavosDe(c.saldo)))
        const n = await new RegistrarCompra().execute(
            {
                proveedor_id: Number(c.proveedor_id),
                tipo_documento: 'NCRE',
                numero: this.nuevaReferencia('NC'),
                fecha_documento: this.azar.elegir(FECHAS_COMPRA.slice(1)),
                condicion: 'credito',
                compra_referencia_id: Number(c.id),
                lineas: [{ descripcion: 'auditoría: descuento', categoria: 'otros', total: texto(total) }],
            },
            this.ctx,
        )
        return `NCRE ${n.id} de ${n.total} a la compra ${c.id} (saldo ${c.saldo})`
    }

    private async pagar_proveedor() {
        const compras = await this.comprasAlCredito()
        if (compras.length === 0) return 'sin compras al crédito con saldo'
        const c = this.azar.elegir(compras)
        const mismas = compras.filter((x) => x.proveedor_id === c.proveedor_id)
        const saldo = mismas.reduce((s, x) => s + centavosDe(x.saldo), 0n)
        // a veces de más (el producto debe rechazarlo: no paga de más)
        const monto = this.azar.moneda(0.1) ? saldo + 1n : this.azar.centavos(1, Number(saldo))
        const empresaId = Number(c.empresa_id)
        const p = await new RegistrarPagoProveedor().execute(
            { proveedor_id: Number(c.proveedor_id), monto: texto(monto), ...this.medio(empresaId) },
            this.ctx,
        )
        return `pago a proveedor ${p.id} de ${texto(monto)} (saldo ${texto(saldo)}) de la empresa ${empresaId}`
    }

    private async anular_pago_proveedor() {
        const pagos = (await db
            .from('ledger.pagos_proveedores as pp')
            .whereIn('pp.empresa_id', this.empresas)
            .whereNotExists((q) =>
                q.from('ledger.pagos_proveedores_anulaciones as x').whereRaw('x.pago_id = pp.id'),
            )
            .orderBy('pp.id')
            .select('pp.id')) as Array<{ id: number }>
        if (pagos.length === 0) return 'sin pagos a proveedores'
        const p = this.azar.elegir(pagos)
        await new AnularPagoProveedor().execute(
            { pago_id: Number(p.id), motivo: 'auditoría: cheque devuelto' },
            this.ctx,
        )
        return `anula el pago a proveedor ${p.id}`
    }

    private async anular_compra() {
        const compras = (await db
            .from('ledger.compras as c')
            .whereIn('c.empresa_id', this.empresas)
            .whereNotExists((q) => q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = c.id'))
            .orderBy('c.id')
            .select('c.id', 'c.tipo_documento')) as Array<{ id: number; tipo_documento: string }>
        if (compras.length === 0) return 'sin compras'
        const c = this.azar.elegir(compras)
        await new AnularCompra().execute(
            { compra_id: Number(c.id), motivo: 'auditoría: documento equivocado' },
            this.ctx,
        )
        return `anula la compra ${c.id} (${c.tipo_documento})`
    }

    /** Un egreso de la caja (sin compra) pasa a compra con su factura (reclasificación del IVA). */
    private async compra_desde_egreso() {
        const egresos = (await db
            .from('ledger.egresos as e')
            .whereIn('e.empresa_id', this.empresas)
            .whereNull('e.compra_id')
            .whereNotExists((q) => q.from('ledger.egresos_anulaciones as x').whereRaw('x.egreso_id = e.id'))
            .whereNotExists((q) =>
                q
                    .from('ledger.compras as c')
                    .whereRaw('c.egreso_id = e.id')
                    .whereNotExists((x) =>
                        x.from('ledger.compras_anulaciones as y').whereRaw('y.compra_id = c.id'),
                    ),
            )
            .orderBy('e.id')
            .select(
                'e.id',
                'e.empresa_id',
                'e.monto',
                db.raw(`to_char(e.fecha, 'YYYY-MM-DD') as fecha`),
            )) as Array<{
            id: number
            empresa_id: number
            monto: string
            fecha: string
        }>
        if (egresos.length === 0) return 'sin egresos sin compra'
        const e = this.azar.elegir(egresos)
        const c = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: Number(e.id),
                proveedor_id: this.proveedoresCompra.get(Number(e.empresa_id))!.general,
                tipo_documento: 'FACT',
                numero: this.nuevaReferencia('E'),
                fecha_documento: e.fecha,
                retenciones: [],
                lineas: [{ descripcion: 'auditoría: gasto con factura', categoria: 'otros', total: e.monto }],
            },
            this.ctx,
        )
        return `compra ${c.id} desde el egreso ${e.id} (${e.monto}, IVA ${c.iva}, crédito ${c.credito_fiscal})`
    }

    /** Alta a mano (inventario inicial), a veces ya depreciado. */
    private async alta_activo() {
        const empresaId = this.azar.elegir(this.empresas)
        const costo = this.azar.centavos(10000, 2000000)
        const inicial = this.azar.moneda() ? this.azar.centavos(0, Number(costo / 2n)) : 0n
        const residual = this.azar.moneda(0.3) ? this.azar.centavos(0, Number((costo - inicial) / 10n)) : 0n
        const a = await new RegistrarActivo().execute(
            {
                empresa_id: empresaId,
                clase: this.azar.elegir(['equipo_red', 'mobiliario', 'computacion', 'vehiculos'] as const),
                descripcion: 'auditoría: activo inicial',
                fecha_alta: `2026-0${this.azar.entero(1, 9)}-${String(this.azar.entero(1, 28)).padStart(2, '0')}`,
                costo: texto(costo),
                depreciacion_inicial: texto(inicial),
                valor_residual: texto(residual),
                tasa_anual: this.azar.moneda() ? null : this.azar.elegir(['3.33', '10', '7.77']),
            },
            this.ctx,
        )
        return `alta a mano del activo ${a.id} (${a.clase}) en la empresa ${empresaId}: costo ${a.costo}, inicial ${a.depreciacion_inicial}, residual ${a.valor_residual}, tasa ${a.tasa_anual}, desde ${a.inicio_depreciacion}`
    }

    private async depreciar() {
        const r = await new DepreciarActivos().execute(
            { empresa_id: this.azar.elegir(this.empresas) },
            this.ctx,
        )
        return `depreciación hasta ${r.hasta}: ${r.cuotas} cuotas por ${r.monto}`
    }

    private async baja_activo() {
        const activos = (await db
            .from('ledger.activos as ac')
            .whereIn('ac.empresa_id', this.empresas)
            .whereNotExists((q) => q.from('ledger.activos_bajas as b').whereRaw('b.activo_id = ac.id'))
            .orderBy('ac.id')
            .select('ac.id', 'ac.empresa_id', 'ac.costo')) as Array<{
            id: number
            empresa_id: number
            costo: string
        }>
        if (activos.length === 0) return 'sin activos vigentes'
        const a = this.azar.elegir(activos)
        const venta = this.azar.moneda()
        const b = await new DarDeBajaActivo().execute(
            {
                activo_id: Number(a.id),
                tipo: venta ? 'venta' : 'retiro',
                motivo: 'auditoría: baja',
                ...(venta
                    ? {
                          precio_venta: texto(this.azar.centavos(1, Number(centavosDe(a.costo)) * 2)),
                          cuenta_bancaria_id: this.e.cuentas.get(Number(a.empresa_id))!,
                      }
                    : {}),
            },
            this.ctx,
        )
        return `baja (${b.baja!.tipo}) del activo ${a.id}: valor en libros ${b.baja!.valor_libros}, precio ${b.baja!.precio_venta}`
    }

    /** Ingreso diferido sobre una línea de una factura (plan pagado por adelantado). */
    private async diferir_factura() {
        const { rows } = (await db.rawQuery(
            `SELECT l.id FROM billing.facturas_lineas l JOIN billing.facturas f ON f.id = l.factura_id
              WHERE f.empresa_id = ANY(?::bigint[]) AND f.tipo = 'servicio' AND f.estado NOT IN ('anulada', 'por_certificar')
                AND l.tipo = 'servicio'
                AND NOT EXISTS (SELECT 1 FROM ledger.diferimientos d WHERE d.factura_linea_id = l.id)
              ORDER BY l.id`,
            [this.empresas],
        )) as { rows: Array<{ id: number }> }
        if (rows.length === 0) return 'sin líneas de factura'
        const l = this.azar.elegir(rows)
        const d = await new RegistrarDiferimiento().execute(
            { origen: 'factura', factura_linea_id: Number(l.id), meses: this.azar.entero(2, 12) },
            this.ctx,
        )
        return `diferimiento ${d.id} de la línea ${l.id}: ${d.total} en ${d.meses} meses desde ${d.inicio}`
    }

    private async amortizar() {
        const r = await new AmortizarDiferidos().execute(
            { empresa_id: this.azar.elegir(this.empresas) },
            this.ctx,
        )
        return `amortización hasta ${r.hasta}: ${r.cuotas} cuotas por ${r.monto}`
    }

    /** Pago en caja con una constancia de retención de IVA o ISR (a veces sobre un castigo: H19). */
    private async pagar_con_retencion() {
        const clienteId = await this.clienteConDeuda()
        const cliente =
            clienteId === null
                ? this.azar.elegir(this.clientes)
                : this.clientes.find((c) => c.id === clienteId)!
        const empresaId = this.azar.elegir(cliente.empresas)
        const efectivo = this.azar.centavos(1000, 30000)
        const retencion = this.azar.centavos(1, Number(efectivo / 10n))
        const iva = this.azar.moneda()
        const r = await this.pagar({
            cliente_id: cliente.id,
            metodo: 'caja',
            monto: texto(efectivo),
            empresa_id: empresaId,
            retenciones: [
                {
                    codigo: iva ? 'RET_IVA_ESP' : 'RET_ISR_OPC',
                    numero: this.nuevaReferencia(iva ? 'CI' : 'CR'),
                    monto: texto(retencion),
                },
            ],
        })
        return `cliente ${cliente.id} paga ${texto(efectivo)} + constancia ${iva ? 'IVA' : 'ISR'} ${texto(retencion)} en la empresa ${empresaId} (pago ${r.pagos.map((p) => p.id).join(', ')})`
    }
}
