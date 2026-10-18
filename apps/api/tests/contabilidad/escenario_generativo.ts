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

type Accion = keyof typeof PESOS | keyof typeof PESOS_FEL

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

    constructor(
        readonly semilla: number,
        opciones: { fel?: boolean; incluirHallazgosAbiertos?: boolean } = {},
    ) {
        this.azar = new Azar(semilla)
        this.fel = opciones.fel ?? false
        this.incluirHallazgosAbiertos = opciones.incluirHallazgosAbiertos ?? false
        this.pesos = (this.fel ? { ...PESOS, ...PESOS_FEL } : PESOS) as Record<Accion, number>
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
                vence_en: DateTime.now().plus({ days: 3 }).toJSDate(),
                monto: texto(this.parcial(total + 1n)),
                canal: 'operador',
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
            { servicio_id: servicio.id, ahora: DateTime.now().plus({ days: 10 }).toJSDate() },
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
            .select(db.raw('coalesce(sum(monto), 0)::text as total'))
            .firstOrFail()
        const egresado = await db
            .from('ledger.egresos as e')
            .where('e.turno_id', turno.id)
            .whereNotExists((q) => q.from('ledger.egresos_anulaciones as x').whereRaw('x.egreso_id = e.id'))
            .select(db.raw('coalesce(sum(e.monto), 0)::text as total'))
            .firstOrFail()
        const esperado =
            centavosDe(turno.fondo_inicial) + centavosDe(cobrado.total) - centavosDe(egresado.total)
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
        return `cierra ${periodo.slice(0, 7)} en la empresa ${empresaId}: ${foto.asientos} asientos, debe ${foto.debe}`
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
}
