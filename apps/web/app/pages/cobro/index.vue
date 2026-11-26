<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cobro POS (tablero NuevoCobro y NuevoCobroMovil): buscar al cliente, marcar lo que paga (por
 * servicio, con las cuentas «a su cargo»), elegir Pago completo o Abono y el método, escribir lo
 * recibido y ver el cambio justo debajo. Teclado en pantalla con punto y teclado físico (números,
 * punto, Retroceso, Tab, Enter cobra, Esc empieza otro cobro, F2 busca). En el teléfono son dos
 * pantallas: la lista y el cobro.
 */
definePageMeta({ permiso: 'pagos.registrar' })

useHead({ title: 'Cobrar · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const toast = useToast()

function idQuery(valor: unknown): number {
    const id = Number(typeof valor === 'string' ? valor : '')
    return Number.isInteger(id) && id > 0 ? id : 0
}

// Cliente elegido
const clienteId = ref(idQuery(route.query.cliente))
const cliente = shallowRef<Cliente | null>(null)
const problemaCliente = ref<Problem | null>(null)

// Lo que debe
const cuenta = shallowRef<EstadoCuenta | null>(null)
const cargandoCuenta = ref(false)
const problemaCuenta = ref<Problem | null>(null)
const resumen = computed(() => (cuenta.value ? resumenPendiente(cuenta.value.facturas_pendientes, hoyGuatemala()) : null))

// Sus servicios
const servicios = shallowRef<Servicio[]>([])
const cargandoServicios = ref(false)
const problemaServicios = ref<Problem | null>(null)

/**
 * Pago de terceros (A3, día 4): facturas de otros clientes que paga el mismo pagador. Los
 * dependientes del pagador (responsable de pago, A1) se cargan solos como grupo plegado; el
 * cajero puede agregar cualquier otro cliente. Cada grupo lee su estado de cuenta y servicios.
 */
interface GrupoCobro {
    cliente: { id: number, nombre: string, nit_cui: string | null }
    origen: 'dependiente' | 'agregado'
    cuenta: EstadoCuenta | null
    problema: Problem | null
    cargando: boolean
    servicios: Servicio[]
    abierto: boolean
}
const grupos = ref<GrupoCobro[]>([])
const problemaDependientes = ref<Problem | null>(null)
const agregando = ref(false)
const clienteAgregado = ref(0)
const hoy = hoyGuatemala()

function resumenGrupo(grupo: GrupoCobro): ResumenPendiente | null {
    return grupo.cuenta ? resumenPendiente(grupo.cuenta.facturas_pendientes, hoy) : null
}

/** Todas las facturas en el orden de la pantalla: primero las del pagador, luego cada grupo. */
const facturasPantalla = computed(() => [
    ...(resumen.value?.facturas ?? []),
    ...grupos.value.flatMap(g => resumenGrupo(g)?.facturas ?? []),
])
/** Servicios de todos los clientes en pantalla (pagador y grupos). */
const serviciosPantalla = computed(() => [...servicios.value, ...grupos.value.flatMap(g => g.servicios)])

/**
 * Multiempresa: las facturas marcadas de varias empresas se cobran con un pago por empresa (cada
 * NIT recibe lo suyo, en su caja). Se muestra el reparto antes de registrar.
 */
const { conSelector: variasEmpresas, nombre: nombreEmpresa, empresaId: empresaActiva } = useEmpresaActiva()
const reparto = computed(() => (variasEmpresas.value ? repartoPorEmpresa(facturasPantalla.value, marcadas.value, serviciosPantalla.value) : []))

// Cajas (método "caja"). Elegir caja es opcional: sin `caja_id`, la API usa la caja principal.
const CAJA_PRINCIPAL = 'principal'
const cajas = shallowRef<Caja[]>([])
const problemaCajas = ref<Problem | null>(null)
const cajasActivas = computed(() => cajas.value.filter(c => c.activa))
const cajaElegida = computed({
    get: () => (estado.caja_id === null ? CAJA_PRINCIPAL : String(estado.caja_id)),
    set: (valor: string) => {
        estado.caja_id = valor === CAJA_PRINCIPAL ? null : Number(valor)
    },
})

/*
 * Caja que recibe el efectivo: la elegida o, sin elegir, la del turno abierto del cajero (si no
 * tiene, la principal). Sin caja abierta el efectivo no entra a ningún turno ni a ningún cierre:
 * se avisa antes de cobrar y «Abrir caja» la abre en un modal sin salir del cobro.
 */
const cajaDestino = computed<Caja | null>(() => (estado.caja_id === null
    ? (cajasActivas.value.find(c => c.turno_abierto_id !== null && (c.cajero_id === usuario.value?.id || c.turno_abierto_por === usuario.value?.id)) ?? null)
    : (cajasActivas.value.find(c => c.id === estado.caja_id) ?? null)))
const cajasLeidas = ref(false)
const avisoSinCaja = computed<{ titulo: string, detalle: string, opciones: Caja[] } | null>(() => {
    if (estado.metodo !== 'caja' || !puede('cajas.ver') || !cajasLeidas.value || problemaCajas.value || pago.value) {
        return null
    }
    if (cajaDestino.value?.turno_abierto_id) {
        return null
    }
    if (cajaDestino.value) {
        return {
            titulo: `${cajaDestino.value.nombre} está cerrada`,
            detalle: 'Ábrela para que este cobro entre a su turno y salga en el cierre de caja.',
            opciones: [cajaDestino.value],
        }
    }
    const cerradas = cajasActivas.value.filter(c => c.turno_abierto_id === null && (c.cajero_id === usuario.value?.id || c.cajero_id === null))
    return {
        titulo: 'No tienes una caja abierta',
        detalle: 'Sin caja abierta, el efectivo entra a la caja principal sin turno y no aparece en ningún cierre. Abre tu caja antes de cobrar.',
        opciones: cerradas,
    }
})

/** Modal «Abrir caja» desde el cobro: con la caja ya elegida o para elegir entre `opciones`. */
const aperturaAbierta = ref(false)
const aperturaOpciones = shallowRef<Caja[]>([])

function abrirCaja(opciones: Caja[]) {
    aperturaOpciones.value = opciones
    aperturaAbierta.value = true
}

/** Cajas que se pueden abrir para la empresa de un 422 `caja_no_abierta`. */
function cajasDeEmpresa(empresaId: number): Caja[] {
    return cajasActivas.value.filter(c => c.empresa_id === empresaId && c.turno_abierto_id === null)
}

async function alAbrirCaja(turno: TurnoCaja) {
    toast.add({ title: 'Caja abierta', description: `Fondo inicial ${formatearQuetzales(turno.fondo_inicial)}. Ya puedes registrar el cobro.`, icon: 'i-lucide-lock-open', color: 'success' })
    await cargarCajas()
    if (cajasActivas.value.some(c => c.id === turno.caja_id)) {
        estado.caja_id = turno.caja_id
    }
    if (sinCaja.value) {
        problemaPago.value = null
    }
}

// Datos bancarios (depósito, transferencia, ACH, remesa): banco de origen y cuenta propia de destino.
const bancos = shallowRef<Banco[]>([])
const problemaBancos = ref<Problem | null>(null)
const cuentasBancarias = shallowRef<CuentaBancaria[]>([])
const problemaCuentas = ref<Problem | null>(null)
/** Solo las activas en quetzales reciben pagos (una cuenta en USD responde 422). */
const cuentasDestino = computed(() => cuentasBancarias.value.filter(c => c.activa && c.moneda === 'GTQ'))
const itemsBanco = computed(() => bancos.value.map(b => ({ label: b.nombre, value: b.id })))
const itemsCuenta = computed(() => cuentasDestino.value.map(c => ({
    label: `${c.banco_nombre} · ${c.alias}`,
    description: c.numero,
    value: c.id,
})))

// Pantalla del cobro (tablero NuevoCobro)
/** Pago completo (lo marcado) o Abono (menos que lo marcado, sin mezclarse). */
const modo = ref<'completo' | 'abono'>('completo')
/** Campo que recibe el teclado en pantalla y el físico: lo recibido o el abono. */
const foco = ref<'recibido' | 'abono'>('recibido')
/** Efectivo que entrega el cliente (solo para calcular el cambio; no va a la API). */
const recibido = ref('')
/** Al llegar a un campo, la primera tecla reemplaza lo que tenía. */
let reemplazar = false
/** Teléfono: dos pantallas, la lista y el cobro a pantalla completa. */
const pantalla = ref<'lista' | 'cobro'>('lista')
/** Cambio que se entregó en el último cobro (se muestra al terminar). */
const cambioEntregado = shallowRef<Decimal | null>(null)

type GrupoMetodo = 'efectivo' | 'tarjeta' | 'transferencia' | 'deposito'
/**
 * Los cuatro métodos del tablero y los de la API que agrupa cada uno: transferencia del mismo
 * banco o por ACH; depósito en ventanilla, por agente bancario o por remesa.
 */
const GRUPOS_METODO: { id: GrupoMetodo, etiqueta: string, icono: string, metodos: MetodoCobro[] }[] = [
    { id: 'efectivo', etiqueta: 'Efectivo', icono: 'i-lucide-banknote', metodos: ['caja'] },
    { id: 'tarjeta', etiqueta: 'Tarjeta', icono: 'i-lucide-credit-card', metodos: ['debito'] },
    { id: 'transferencia', etiqueta: 'Transferencia', icono: 'i-lucide-zap', metodos: ['ach', 'transferencia'] },
    { id: 'deposito', etiqueta: 'Depósito', icono: 'i-lucide-landmark', metodos: ['deposito', 'agente', 'remesa'] },
]
const grupoMetodo = computed<GrupoMetodo>({
    get: () => GRUPOS_METODO.find(g => g.metodos.includes(estado.metodo))?.id ?? 'efectivo',
    set: (id) => {
        estado.metodo = GRUPOS_METODO.find(g => g.id === id)?.metodos[0] ?? 'caja'
    },
})
const itemsGrupoMetodo = GRUPOS_METODO.map(g => ({ label: g.etiqueta, value: g.id, icon: g.icono }))
const itemsTipoTransferencia = [
    { label: 'Mismo banco', value: 'transferencia' },
    { label: 'ACH · otro banco', value: 'ach' },
]
const itemsTipoDeposito = [
    { label: 'Boleta', value: 'deposito' },
    { label: 'Agente bancario', value: 'agente' },
    { label: 'Remesa', value: 'remesa' },
]
const metodoElegido = computed({
    get: () => estado.metodo,
    set: (valor: string) => {
        const metodo = GRUPOS_METODO.flatMap(g => g.metodos).find(m => m === valor)
        if (metodo) {
            estado.metodo = metodo
        }
    },
})
const itemsModo = [
    { label: 'Pago completo', value: 'completo' },
    { label: 'Abono', value: 'abono' },
]

/** Tarjeta: marca y últimos 4 dígitos (van en la nota del pago). */
const MARCAS_TARJETA = ['Visa', 'Mastercard', 'Otra'] as const
const marcaTarjeta = ref<typeof MARCAS_TARJETA[number]>('Visa')
const ultimos4 = ref('')
const conNota = ref(false)

function notaDelCobro(datos: SalidaCobro): string {
    if (datos.metodo !== 'debito') {
        return datos.nota
    }
    const tarjeta = `Tarjeta ${marcaTarjeta.value}${/^\d{4}$/.test(ultimos4.value) ? ` ···${ultimos4.value}` : ''}`
    return [tarjeta, datos.nota].filter(Boolean).join(' · ')
}

const RECIBIDO = /^\d{0,12}(\.\d{0,2})?$/
const montoActual = computed(() => (montoValido.value ? new Decimal(estado.monto.trim()) : null))
const recibidoValor = computed(() => (/^\d{1,12}(\.\d{0,2})?$/.test(recibido.value) ? new Decimal(recibido.value.replace(/\.$/, '')) : null))
/** Cambio (o lo que falta recibir) en efectivo; sin recibido escrito, se cobra exacto. */
const cambio = computed(() => (estado.metodo === 'caja' && montoActual.value && recibidoValor.value ? recibidoValor.value.minus(montoActual.value) : null))
const puedeCobrar = computed(() => Boolean(cliente.value && montoActual.value?.gt(0) && !cambio.value?.lt(0) && !enviando.value))
const textoCobrar = computed(() => (montoActual.value?.gt(0) ? `Cobrar ${formatearQuetzales(montoActual.value)}` : 'Marca qué paga'))

/** Montos rápidos de lo recibido: exacto y billetes grandes. */
const RAPIDOS = [
    { etiqueta: 'Q 100', valor: '100' },
    { etiqueta: 'Q 500', valor: '500' },
    { etiqueta: 'Q 1,000', valor: '1000' },
]
function recibidoRapido(valor: string | null) {
    recibido.value = valor ?? (montoActual.value ? montoActual.value.toFixed(2) : '')
    foco.value = 'recibido'
    reemplazar = true
}

function enfocar(campo: 'recibido' | 'abono') {
    foco.value = campo
    reemplazar = true
}

/** Una tecla (en pantalla o física) en el campo activo: números, punto (uno) y dos decimales. */
function tecla(valor: string) {
    const campo = modo.value === 'abono' && foco.value === 'abono' ? 'abono' : 'recibido'
    if (campo === 'recibido' && estado.metodo !== 'caja') {
        return
    }
    let texto = campo === 'abono' ? estado.monto : recibido.value
    if (reemplazar && valor !== '⌫') {
        texto = ''
    }
    reemplazar = false
    if (valor === '⌫') {
        texto = texto.slice(0, -1)
    }
    else if (valor === '.') {
        texto = texto.includes('.') ? texto : `${texto || '0'}.`
    }
    else if (!(texto.includes('.') && (texto.split('.')[1]?.length ?? 0) >= 2)) {
        texto = `${texto === '0' ? '' : texto}${valor}`
    }
    if (!RECIBIDO.test(texto)) {
        return
    }
    if (campo === 'abono') {
        estado.monto = texto
    }
    else {
        recibido.value = texto
    }
}

watch(modo, (nuevo) => {
    if (nuevo === 'abono') {
        enfocar('abono')
    }
    else {
        foco.value = 'recibido'
        estado.monto = totalMarcadas.value?.gt(0) ? totalMarcadas.value.toFixed(2) : ''
    }
})

/** Lo que quedará de cada factura marcada con el abono: «Octubre ✓ pagada · Noviembre abona Q 100.00, queda Q 100.00». */
const resumenAbono = computed(() => {
    if (modo.value !== 'abono' || !distribucion.value) {
        return null
    }
    return distribucion.value.marcadas.map((linea) => {
        const mes = etiquetaPeriodo(linea.factura.periodo).split(' ')[0] ?? ''
        const nombre = mes.charAt(0).toUpperCase() + mes.slice(1)
        if (linea.aplicado.isZero()) {
            return `${nombre} sin pago`
        }
        return linea.parcial
            ? `${nombre} abona ${formatearQuetzales(linea.aplicado)}, queda ${formatearQuetzales(saldoFactura(linea.factura).minus(linea.aplicado))}`
            : `${nombre} ✓ pagada`
    }).join(' · ')
})

/** Transferencia del mismo banco: el banco de origen es el de la cuenta que recibió. */
const cuentaElegida = computed(() => cuentasDestino.value.find(c => c.id === estado.cuenta_bancaria_id) ?? null)

/** Facturas del pagador agrupadas por servicio, en el orden de la pantalla. */
const gruposServicio = computed(() => {
    const grupos: { clave: string, servicio: Servicio | null, facturas: Schema<'Factura'>[] }[] = []
    for (const factura of resumen.value?.facturas ?? []) {
        const clave = factura.servicio_id === null ? 'sin-servicio' : String(factura.servicio_id)
        let grupo = grupos.find(g => g.clave === clave)
        if (!grupo) {
            grupo = { clave, servicio: serviciosVista.value.find(s => s.id === factura.servicio_id) ?? null, facturas: [] }
            grupos.push(grupo)
        }
        grupo.facturas.push(factura)
    }
    return grupos
})

/** «Todas las vencidas»: del pagador y de las cuentas a su cargo ya abiertas. */
function marcarVencidas() {
    const abiertas = grupos.value.filter(g => g.abierto).flatMap(g => resumenGrupo(g)?.facturas ?? [])
    const vencidas = [...(resumen.value?.facturas ?? []), ...abiertas].filter(f => facturaVencida(f, hoy)).map(f => f.id)
    marcadas.value = facturasPantalla.value.filter(f => vencidas.includes(f.id)).map(f => f.id)
}

/** Estado de una cuenta a su cargo: vencida o el próximo vencimiento. */
function insigniaGrupo(grupo: GrupoCobro): { etiqueta: string, color: 'error' | 'warning' } | null {
    const facturas = resumenGrupo(grupo)?.facturas ?? []
    if (!facturas.length) {
        return null
    }
    if (facturas.some(f => facturaVencida(f, hoy))) {
        return { etiqueta: 'Vencida', color: 'error' }
    }
    const proxima = [...facturas].sort((a, b) => a.vence_en.localeCompare(b.vence_en))[0]
    return proxima ? { etiqueta: `Vence ${formatearFechaCorta(proxima.vence_en)}`, color: 'warning' } : null
}

/** Cobros recientes del usuario: para volver a un cliente con un toque. */
const recientes = shallowRef<{ id: number, nombre: string, monto: string, cuando: string }[]>([])
const problemaRecientes = ref<Problem | null>(null)
async function cargarRecientes() {
    if (!puede('pagos.ver')) {
        return
    }
    const resultado = await usePagos().listar({ limit: 20 })
    problemaRecientes.value = resultado.ok ? null : resultado.problema
    if (!resultado.ok) {
        return
    }
    const vistos = new Set<number>()
    recientes.value = resultado.data.data
        .filter(p => p.estado !== 'anulado' && (usuario.value === null || p.registrado_por === null || p.registrado_por === usuario.value?.id))
        .filter((p) => {
            if (vistos.has(p.cliente_id)) {
                return false
            }
            vistos.add(p.cliente_id)
            return true
        })
        .slice(0, 8)
        .map(p => ({ id: p.cliente_id, nombre: p.cliente_nombre ?? `Cliente #${p.cliente_id}`, monto: p.monto, cuando: p.created_at }))
}

/** Impresión del recibo según la caja (decisión 20). */
const impresion = useImpresionCaja()
const imprimirAlCobrar = ref(true)
const cajaRecibo = computed(() => (estado.metodo === 'caja' ? cajaDestino.value : (cajasActivas.value.find(c => c.id === miCaja.abierta.value?.id) ?? null)))
const formatoRecibo = computed(() => impresion.formatoDe(cajaRecibo.value?.id ?? miCaja.abierta.value?.id))
const plantillaCarta = ref<number | null>(null)
async function cargarPlantillaCarta() {
    if (!puede('documentos.ver')) {
        return
    }
    const resultado = await usePlantillasDocumentos().listar({ tipo: 'recibo_cobro', activa: true })
    plantillaCarta.value = resultado.ok ? (resultado.data.find(p => p.formato === 'carta' && !p.predeterminada)?.id ?? null) : null
}
onMounted(cargarPlantillaCarta)

/** Enlace de WhatsApp con el resumen del recibo para el móvil del cliente. */
const enlaceWhatsapp = computed(() => {
    const numero = (cliente.value?.movil ?? cliente.value?.telefono ?? '').replace(/\D/g, '')
    if (!pago.value || numero.length < 8) {
        return null
    }
    const completo = numero.length === 8 ? `502${numero}` : numero
    const texto = `Recibo de pago #${pago.value.id} · ${formatearQuetzales(totalCobrado.value)} · ${ETIQUETAS_METODO[pago.value.metodo]} · ${cliente.value?.nombre ?? ''}. ¡Gracias!`
    return `https://wa.me/${completo}?text=${encodeURIComponent(texto)}`
})

const miCaja = useMiCaja()
/** Ventana de éxito: abierta mientras hay un pago registrado en pantalla. */
const exitoAbierto = computed({
    get: () => pago.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            nuevoCobro()
        }
    },
})

// Formulario
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaCobro>({ monto: '', metodo: 'caja', caja_id: null, cuenta_bancaria_id: null, banco_origen_id: null, referencia: '', nota: '' })
const enviando = ref(false)
const problemaPago = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

// Resultado
const pago = shallowRef<Pago | null>(null)
const facturasAntes = shallowRef<EstadoCuenta['facturas_pendientes']>([])
const seguimiento = useSeguimientoReactivacion()

/** Campos del formulario: un 422 en otro campo (p. ej. `facturas.0`) se lista en el aviso. */
const CAMPOS_COBRO = new Set(['monto', 'metodo', 'caja_id', 'cuenta_bancaria_id', 'banco_origen_id', 'referencia', 'nota'])
const erroresSinCampo = computed(() => (problemaPago.value?.status === 422
    ? (problemaPago.value.errors ?? []).filter(e => !CAMPOS_COBRO.has(e.field))
    : []))

/**
 * Cobro en efectivo de facturas de una empresa en la que el cajero no tiene caja abierta (422
 * `caja_no_abierta`, A3). Se nombra la empresa y se ofrece abrir la caja.
 */
const { empresas: empresasUsuario } = useEmpresaActiva()
const sinCaja = computed(() => {
    const id = problemaPago.value ? empresaSinCaja(problemaPago.value) : null
    if (id === null) {
        return null
    }
    const nombre = empresasUsuario.value.find(e => e.id === id)?.nombre_comercial ?? `la empresa ${id}`
    return { id, nombre }
})

/** Cobro repartido: un pago por empresa con el mismo `cobro_id` (solo efectivo). */
const pagosDelCobro = computed<Pago[]>(() => (pago.value ? (pago.value.pagos?.length ? pago.value.pagos : [pago.value]) : []))
const cobroRepartido = computed(() => (pago.value?.cobro_id ?? null) !== null && pagosDelCobro.value.length > 1)
function nombreDeEmpresa(id: number | undefined): string {
    return empresasUsuario.value.find(e => e.id === id)?.nombre_comercial ?? (id ? `Empresa ${id}` : 'Empresa sin identificar')
}
const totalCobrado = computed(() => pagosDelCobro.value.reduce((suma, p) => suma.plus(p.monto), new Decimal(0)))

/** Los selectores de Nuxt UI usan `undefined` para "sin elegir"; el esquema, `null`. */
const bancoOrigen = computed<number | undefined>({
    get: () => estado.banco_origen_id ?? undefined,
    set: (valor) => {
        estado.banco_origen_id = valor ?? null
    },
})
const cuentaDestino = computed<number | undefined>({
    get: () => estado.cuenta_bancaria_id ?? undefined,
    set: (valor) => {
        estado.cuenta_bancaria_id = valor ?? null
    },
})

const montoValido = computed(() => /^\d{1,12}(\.\d{1,2})?$/.test(estado.monto.trim()))

/**
 * Facturas elegidas para este pago, en el orden de la pantalla (así se mandan en `facturas[]`).
 * Por defecto, las vencidas; el monto sugerido es la suma de las marcadas y sigue editable.
 */
const marcadas = ref<number[]>([])
const totalMarcadas = computed(() => (resumen.value ? sumaMarcadas(facturasPantalla.value, marcadas.value) : null))
/** Marcadas de otros clientes (pago de terceros): cuántas y cuánto suman. */
const marcadasDeTerceros = computed(() => {
    const propias = new Set((resumen.value?.facturas ?? []).map(f => f.id))
    const ajenas = new Set(marcadas.value.filter(id => !propias.has(id)))
    return { cuantas: ajenas.size, total: sumaMarcadas(facturasPantalla.value, [...ajenas]) }
})
/** Cómo aplicará la API el monto escrito (pedidas primero, luego las demás del pagador, luego anticipo). */
const distribucion = computed(() => (resumen.value && montoValido.value && marcadas.value.length
    ? distribuirPago(new Decimal(estado.monto.trim()), facturasPantalla.value, marcadas.value, resumen.value.facturas)
    : null))
/** Sin facturas marcadas: cuánto quedaría debiendo, o el saldo a favor si paga de más. */
const restante = computed(() => (resumen.value && montoValido.value && !marcadas.value.length ? resumen.value.pendiente.minus(new Decimal(estado.monto.trim())) : null))

const nombresServicio = computed(() => new Map(serviciosPantalla.value.map(s => [s.id, etiquetaServicio(s)])))

function marcar(facturaId: number, valor: boolean) {
    const elegidas = new Set(marcadas.value)
    if (valor) {
        elegidas.add(facturaId)
    }
    else {
        elegidas.delete(facturaId)
    }
    marcadas.value = facturasPantalla.value.filter(f => elegidas.has(f.id)).map(f => f.id)
}

/** Marca o desmarca de una vez las facturas de un grupo (con casilla "todas"). */
function marcarGrupo(grupo: GrupoCobro, valor: boolean) {
    const ids = new Set((resumenGrupo(grupo)?.facturas ?? []).map(f => f.id))
    const elegidas = new Set(marcadas.value.filter(id => !ids.has(id)))
    if (valor) {
        ids.forEach(id => elegidas.add(id))
    }
    marcadas.value = facturasPantalla.value.filter(f => elegidas.has(f.id)).map(f => f.id)
}

function estadoCasillaGrupo(grupo: GrupoCobro): boolean | 'indeterminate' {
    const ids = (resumenGrupo(grupo)?.facturas ?? []).map(f => f.id)
    const cuantas = ids.filter(id => marcadas.value.includes(id)).length
    if (!cuantas) {
        return false
    }
    return cuantas === ids.length ? true : 'indeterminate'
}

async function cargarGrupo(grupo: GrupoCobro) {
    grupo.cargando = true
    const [cuentaGrupo, serviciosGrupo] = await Promise.all([
        puede('clientes.estado_cuenta') ? useClientes().estadoCuenta(grupo.cliente.id) : Promise.resolve(null),
        puede('servicios.ver') ? useServicios().listar({ cliente_id: grupo.cliente.id, limit: 200 }) : Promise.resolve(null),
    ])
    grupo.cargando = false
    grupo.cuenta = cuentaGrupo?.ok ? cuentaGrupo.data : null
    grupo.problema = cuentaGrupo && !cuentaGrupo.ok ? cuentaGrupo.problema : null
    grupo.servicios = serviciosGrupo?.ok ? serviciosGrupo.data.data : grupo.servicios
}

function nuevoGrupo(datos: GrupoCobro['cliente'], origen: GrupoCobro['origen']): GrupoCobro {
    return { cliente: datos, origen, cuenta: null, problema: null, cargando: true, servicios: [], abierto: origen === 'agregado' }
}

/** Dependientes del pagador (`GET /clientes/:id/dependientes`), cada uno con sus pendientes. */
async function cargarDependientes(pagadorId: number) {
    problemaDependientes.value = null
    const resultado = await useClientes().dependientes(pagadorId)
    if (pagadorId !== clienteId.value) {
        return
    }
    if (!resultado.ok) {
        problemaDependientes.value = resultado.problema
        return
    }
    const agregados = grupos.value.filter(g => g.origen === 'agregado' && !resultado.data.data.some(d => d.id === g.cliente.id))
    grupos.value = [...resultado.data.data.map(d => nuevoGrupo({ id: d.id, nombre: d.nombre, nit_cui: d.nit_cui }, 'dependiente')), ...agregados]
    await Promise.all(grupos.value.map(g => cargarGrupo(g)))
}

/** "Agregar facturas de otro cliente": otro grupo, abierto, con sus pendientes. */
async function agregarCliente(otro: Cliente) {
    agregando.value = false
    clienteAgregado.value = 0
    if (otro.id === clienteId.value || grupos.value.some(g => g.cliente.id === otro.id)) {
        const existente = grupos.value.find(g => g.cliente.id === otro.id)
        if (existente) {
            existente.abierto = true
        }
        return
    }
    grupos.value.push(nuevoGrupo({ id: otro.id, nombre: otro.nombre, nit_cui: otro.nit_cui }, 'agregado'))
    const grupo = grupos.value.at(-1)
    if (grupo) {
        await cargarGrupo(grupo)
    }
}

function quitarGrupo(grupo: GrupoCobro) {
    const ids = new Set((resumenGrupo(grupo)?.facturas ?? []).map(f => f.id))
    marcadas.value = marcadas.value.filter(id => !ids.has(id))
    grupos.value = grupos.value.filter(g => g !== grupo)
}

async function recargarGrupos() {
    await Promise.all(grupos.value.map(g => cargarGrupo(g)))
}

/** Si una factura deja de estar en pantalla (pagada, grupo quitado), deja de estar marcada. */
watch(facturasPantalla, (facturas) => {
    const visibles = new Set(facturas.map(f => f.id))
    if (marcadas.value.some(id => !visibles.has(id))) {
        marcadas.value = marcadas.value.filter(id => visibles.has(id))
    }
})

/** Al cambiar las marcadas, el monto vuelve a ser su suma (el cajero puede editarlo después). */
watch(marcadas, () => {
    if (totalMarcadas.value && !pago.value && modo.value === 'completo') {
        estado.monto = totalMarcadas.value.gt(0) ? totalMarcadas.value.toFixed(2) : ''
    }
})

/** Caja del recibo: la elegida, o "Caja principal" si el cobro en efectivo no eligió ninguna. */
const nombreCaja = computed(() => {
    if (!pago.value || pago.value.metodo !== 'caja') {
        return null
    }
    const caja = cajas.value.find(c => c.id === pago.value?.caja_id)
    return caja?.nombre ?? (cajaPedida.value === null ? 'Caja principal' : null)
})
/** `caja_id` que se mandó en el último pago (`null` = la principal). */
const cajaPedida = ref<number | null>(null)
const saldoAFavor = computed(() => (cuenta.value?.saldo_a_favor ? new Decimal(cuenta.value.saldo_a_favor) : null))

/** Servicios del pagador a mostrar: los que sigue el seguimiento tras el pago, o los cargados. */
const serviciosVista = computed(() => {
    if (!pago.value || !seguimiento.servicios.value.length) {
        return servicios.value
    }
    const propios = new Set(servicios.value.map(s => s.id))
    return seguimiento.servicios.value.filter(s => propios.has(s.id) || s.cliente_id === cliente.value?.id)
})
const reactivados = computed(() => new Set(seguimiento.reactivados.value.map(s => s.id)))

/** La caja con turno abierto del cajero; si no tiene, la principal (`null`). */
function cajaPorDefecto() {
    if (estado.caja_id !== null && cajasActivas.value.some(c => c.id === estado.caja_id)) {
        return
    }
    const mia = cajasActivas.value.find(c => c.cajero_id === usuario.value?.id && c.turno_abierto_id !== null)
    estado.caja_id = mia?.id ?? null
}

async function cargarCajas() {
    if (!puede('cajas.ver')) {
        return
    }
    const resultado = await useCajas().listar()
    cajas.value = resultado.ok ? resultado.data : []
    problemaCajas.value = resultado.ok ? null : resultado.problema
    cajasLeidas.value = true
    cajaPorDefecto()
}

async function cargarBancos() {
    const resultado = await useBancos().listar()
    bancos.value = resultado.ok ? resultado.data : []
    problemaBancos.value = resultado.ok ? null : resultado.problema
}

async function cargarCuentasBancarias() {
    if (!puede('cuentas_bancarias.ver')) {
        return
    }
    const resultado = await useCuentasBancarias().listar({ activa: true })
    cuentasBancarias.value = resultado.ok ? resultado.data : []
    problemaCuentas.value = resultado.ok ? null : resultado.problema
    cuentaPorDefecto()
}

/** Con una sola cuenta de destino posible, queda elegida. */
function cuentaPorDefecto() {
    if (estado.cuenta_bancaria_id !== null && cuentasDestino.value.some(c => c.id === estado.cuenta_bancaria_id)) {
        return
    }
    estado.cuenta_bancaria_id = cuentasDestino.value.length === 1 ? (cuentasDestino.value[0]?.id ?? null) : null
}

async function cargarCuenta() {
    if (!clienteId.value || !puede('clientes.estado_cuenta')) {
        return
    }
    cargandoCuenta.value = true
    const resultado = await useClientes().estadoCuenta(clienteId.value)
    cargandoCuenta.value = false
    cuenta.value = resultado.ok ? resultado.data : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

async function cargarServicios() {
    if (!clienteId.value || !puede('servicios.ver')) {
        return
    }
    cargandoServicios.value = true
    const resultado = await useServicios().listar({ cliente_id: clienteId.value, limit: 200 })
    cargandoServicios.value = false
    servicios.value = resultado.ok ? resultado.data.data : []
    problemaServicios.value = resultado.ok ? null : resultado.problema
}

function limpiarFormulario() {
    marcadas.value = resumen.value ? marcadasPorDefecto(resumen.value, hoyGuatemala()) : []
    estado.monto = totalMarcadas.value?.gt(0) ? totalMarcadas.value.toFixed(2) : ''
    estado.metodo = 'caja'
    estado.referencia = ''
    estado.banco_origen_id = null
    cuentaPorDefecto()
    estado.nota = ''
    cajaPorDefecto()
    problemaPago.value = null
    formulario.value?.clear()
    claveIdempotencia = nuevaClaveIdempotencia()
    modo.value = 'completo'
    foco.value = 'recibido'
    recibido.value = ''
    marcaTarjeta.value = 'Visa'
    ultimos4.value = ''
    conNota.value = false
}

async function elegirCliente(id: number) {
    pago.value = null
    seguimiento.reiniciar()
    cuenta.value = null
    servicios.value = []
    grupos.value = []
    problemaDependientes.value = null
    agregando.value = false
    problemaCliente.value = null
    problemaCuenta.value = null
    problemaServicios.value = null
    await router.replace({ query: id ? { cliente: String(id) } : {} })
    if (!id) {
        cliente.value = null
        limpiarFormulario()
        return
    }
    if (cliente.value?.id !== id) {
        const resultado = await useClientes().ver(id)
        cliente.value = resultado.ok ? resultado.data : null
        problemaCliente.value = resultado.ok ? null : resultado.problema
    }
    await Promise.all([cargarCuenta(), cargarServicios(), puede('clientes.ver') ? cargarDependientes(id) : Promise.resolve()])
    limpiarFormulario()
}

async function registrar(evento: FormSubmitEvent<SalidaCobro>) {
    if (!cliente.value || enviando.value) {
        return
    }
    enviando.value = true
    problemaPago.value = null
    const datos = evento.data
    const resultado = await usePagos().registrar({
        cliente_id: cliente.value.id,
        metodo: datos.metodo,
        monto: new Decimal(datos.monto).toFixed(2),
        referencia: datos.referencia || null,
        // Solo los datos que pide el método: con otro, la API responde `no_aplica`.
        ...datosBancarios(datos),
        nota: notaDelCobro(datos) || null,
        // En el orden de la pantalla; sin marcadas, la API aplica a la más antigua.
        ...(marcadas.value.length ? { facturas: [...marcadas.value] } : {}),
    }, claveIdempotencia)
    enviando.value = false

    if (!resultado.ok) {
        problemaPago.value = resultado.problema
        // Un rechazo definitivo (4xx salvo 409 "en curso") estrena clave; un error de red o 5xx
        // la conserva para que reintentar no cobre dos veces. La referencia duplicada también es
        // definitiva: el cajero corrige la referencia y eso ya es otro pago.
        const { status } = resultado.problema
        const duplicada = esReferenciaDuplicada(resultado.problema)
        if ((status >= 400 && status < 500 && status !== 409) || duplicada) {
            claveIdempotencia = nuevaClaveIdempotencia()
        }
        if (status === 422) {
            // Cada error junto a su campo; los de `facturas.<i>` van en el aviso de abajo.
            // Una cuenta desactivada (`inactiva`) se explica en llano junto al campo.
            formulario.value?.setErrors(erroresConCuentaInactiva(resultado.problema))
        }
        if (duplicada) {
            formulario.value?.setErrors([{ name: 'referencia', message: 'Ya está registrada en otro pago con este método y cuenta. Revisa el número.' }])
        }
        if (codigoProblema(resultado.problema) === 'cuenta_de_otra_empresa') {
            formulario.value?.setErrors([{ name: 'cuenta_bancaria_id', message: 'Esta cuenta es de otra empresa que las facturas marcadas. Elige una cuenta de la misma empresa.' }])
        }
        return
    }

    facturasAntes.value = [...(cuenta.value?.facturas_pendientes ?? []), ...grupos.value.flatMap(g => g.cuenta?.facturas_pendientes ?? [])]
    cajaPedida.value = datos.metodo === 'caja' ? datos.caja_id : null
    pago.value = resultado.data
    // `Pago.servicios[]` trae cómo quedó cada servicio de cada dueño de factura: la reactivación
    // se ve ya. Sin él, se sondean los del pagador.
    seguimiento.iniciar(cliente.value.id, serviciosPantalla.value, resultado.data.servicios)
    const reactivadosAhora = seguimiento.reactivados.value.length
    toast.add({
        title: 'Pago registrado',
        description: `${formatearQuetzales(totalCobrado.value)}${cobroRepartido.value ? ` en ${pagosDelCobro.value.length} empresas` : ''} · ${cliente.value.nombre}${reactivadosAhora ? ` · ${reactivadosAhora === 1 ? 'servicio reactivado' : `${reactivadosAhora} servicios reactivados`}` : ''}`,
        icon: 'i-lucide-badge-check',
        color: 'success',
    })
    cambioEntregado.value = cambio.value && cambio.value.gt(0) ? cambio.value : null
    void cargarCuenta()
    void recargarGrupos()
    if (imprimirAlCobrar.value) {
        void imprimirRecibo()
    }
}

function nuevoCobro() {
    pantalla.value = 'lista'
    cambioEntregado.value = null
    pago.value = null
    seguimiento.reiniciar()
    void cargarServicios()
    void recargarGrupos()
    limpiarFormulario()
}

/** Recibo con el formato de la caja (decisión 20): ticket de 80 mm en la impresora o PDF carta. */
async function imprimirRecibo() {
    if (formatoRecibo.value === 'pos_80' || !pago.value?.cobro_id || !puede('pagos.ver')) {
        await nextTick()
        if (typeof window.print === 'function') {
            window.print()
        }
        return
    }
    await abrirReciboPdf(plantillaCarta.value)
}

/**
 * Recibo del cobro en PDF (`GET /documentos/recibo-cobro/:cobroId`) con la plantilla predeterminada
 * o con la elegida en «Imprimir con…» (p. ej. POS 80 mm para la impresora térmica).
 */
const generandoRecibo = ref(false)
async function abrirReciboPdf(plantillaId: number | null) {
    const cobroId = pago.value?.cobro_id
    if (!cobroId || generandoRecibo.value) {
        return
    }
    generandoRecibo.value = true
    const problema = await abrirPdf(() => useDocumentos().reciboCobro(cobroId, plantillaId), `recibo-cobro-${cobroId}.pdf`)
    generandoRecibo.value = false
    if (problema) {
        toast.add({ title: 'No se pudo generar el recibo', description: problema.detail ?? problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
    }
}

/** El foco está en un campo de texto: el teclado escribe ahí y no en el campo activo del cobro. */
function escribeEnCampo(objetivo: EventTarget | null): boolean {
    return objetivo instanceof HTMLElement && (objetivo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName))
}

/**
 * Teclado físico: F2 busca otro cliente; con el foco fuera de un campo, números, punto y
 * Retroceso van al campo activo (recibido o abono) y Enter cobra. Esc limpia (o empieza otro
 * cobro tras el recibo), salvo que haya un menú o modal abierto.
 */
function alTeclear(evento: KeyboardEvent) {
    if (evento.defaultPrevented) {
        return
    }
    if (evento.key === 'F2') {
        evento.preventDefault()
        document.querySelector<HTMLInputElement>('[data-prueba="buscar-cliente-cobro"] input')?.focus()
        return
    }
    if (evento.key !== 'Escape') {
        if (pago.value || !cliente.value || escribeEnCampo(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) {
            return
        }
        if (document.querySelector('[role="dialog"], [role="listbox"], [data-state="open"][role="menu"]')) {
            return
        }
        if (/^[0-9.]$/.test(evento.key) || evento.key === 'Backspace') {
            evento.preventDefault()
            tecla(evento.key === 'Backspace' ? '⌫' : evento.key)
        }
        else if (evento.key === 'Enter' && puedeCobrar.value) {
            evento.preventDefault()
            formulario.value?.submit()
        }
        return
    }
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-state="open"][role="menu"]')) {
        return
    }
    if (pago.value) {
        nuevoCobro()
        return
    }
    if (clienteId.value) {
        clienteId.value = 0
    }
    else {
        limpiarFormulario()
    }
}

watch(clienteId, id => elegirCliente(id))
watch(() => estado.metodo, (metodo) => {
    if (metodo === 'caja') {
        cajaPorDefecto()
    }
    if (pideDato(metodo, 'cuenta_bancaria_id')) {
        cuentaPorDefecto()
    }
})

watch([() => estado.metodo, () => estado.cuenta_bancaria_id], () => {
    if (estado.metodo === 'transferencia') {
        estado.banco_origen_id = cuentaElegida.value?.banco_id ?? null
    }
})

/**
 * Flujo del cobro (FlujoCobro, paso 0): sin caja abierta, la ventana «Abrir caja» aparece una vez
 * al entrar; si ya está abierta, este paso no aparece.
 */
let aperturaOfrecida = false
watch(avisoSinCaja, (aviso) => {
    if (aviso && !aperturaOfrecida && puede('cajas.abrir') && aviso.opciones.length) {
        aperturaOfrecida = true
        abrirCaja(aviso.opciones)
    }
})

onMounted(() => {
    window.addEventListener('keydown', alTeclear)
    void cargarCajas()
    void cargarBancos()
    void cargarCuentasBancarias()
    void cargarRecientes()
    if (clienteId.value) {
        void elegirCliente(clienteId.value)
    }
})
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclear))

/** Chip de la caja en el buscador: la que recibe el efectivo y, al tocarla, elegir otra. */
const etiquetaCaja = computed(() => {
    if (!puede('cajas.ver') || problemaCajas.value) {
        return 'Caja principal'
    }
    if (estado.caja_id === null && !cajaDestino.value) {
        return 'Sin caja abierta'
    }
    return cajaDestino.value?.nombre ?? 'Caja principal'
})
const cajaAbierta = computed(() => Boolean(cajaDestino.value?.turno_abierto_id))
const itemsCajaMenu = computed<DropdownMenuItem[][]>(() => [
    [{ label: 'Caja principal (automática)', valor: CAJA_PRINCIPAL }, ...cajasActivas.value.map(c => ({ label: c.turno_abierto_id === null ? `${c.nombre} · cerrada` : c.nombre, valor: String(c.id) }))].map(item => ({
        label: item.label,
        icon: item.valor === CAJA_PRINCIPAL ? 'i-lucide-archive' : 'i-lucide-wallet',
        type: 'checkbox' as const,
        checked: cajaElegida.value === item.valor,
        onSelect: () => {
            cajaElegida.value = item.valor
        },
    })),
    ...(avisoSinCaja.value && puede('cajas.abrir') && avisoSinCaja.value.opciones.length
        ? [[{ label: 'Abrir caja…', icon: 'i-lucide-lock-open', onSelect: () => abrirCaja(avisoSinCaja.value?.opciones ?? []) }]]
        : []),
])
const itemsRecientes = computed<DropdownMenuItem[][]>(() => [recientes.value.length
    ? recientes.value.map(r => ({ label: r.nombre, description: `${formatearQuetzales(r.monto)} · ${formatearFechaCorta(r.cuando)}`, icon: 'i-lucide-user', onSelect: () => { clienteId.value = r.id } }))
    : [{ label: problemaRecientes.value ? 'No se pudieron leer los cobros recientes' : 'Sin cobros recientes', disabled: !problemaRecientes.value, icon: problemaRecientes.value ? 'i-lucide-refresh-cw' : 'i-lucide-history', onSelect: () => { void cargarRecientes() } }]])
</script>

<template>
    <PanelPagina
        id="cobro"
        titulo="Cobrar"
        icono="i-lucide-banknote"
        encabezado-propio
        sin-migas
    >
        <UForm
            ref="formulario"
            :schema="esquemaCobro"
            :state="estado"
            :validate-on="['input']"
            class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_27.5rem] lg:gap-5"
            @submit="registrar"
        >
            <!-- Pantalla 1: buscar, el cliente y lo que paga. -->
            <div
                class="min-h-0 flex-col gap-4 pb-24 lg:flex lg:pb-0"
                :class="pantalla === 'cobro' ? 'hidden' : 'flex'"
                data-prueba="cobro-lista"
            >
                <div class="flex items-center gap-2 lg:hidden">
                    <h1 class="flex-1 text-xl font-bold tracking-[-0.02em] text-highlighted lg:hidden">
                        Cobrar
                        <span class="block text-xs font-normal text-muted">{{ etiquetaCaja }} · {{ cajaAbierta ? 'abierta' : 'cerrada' }}</span>
                    </h1>
                </div>
                <h1 class="sr-only hidden lg:block">
                    Cobrar
                </h1>

                <div class="surface-card flex flex-wrap items-center gap-2 rounded-2xl p-2.5 sm:flex-nowrap sm:p-3">
                    <div
                        class="min-w-0 flex-1 max-sm:basis-full"
                        data-prueba="buscar-cliente-cobro"
                    >
                        <ClienteSelector
                            v-model="clienteId"
                            :seleccionado="cliente"
                            placeholder="Buscar cliente: nombre, teléfono, S-… o IP"
                            aria-label="Buscar cliente para cobrar"
                            variant="soft"
                            size="xl"
                            :ui="{ base: 'rounded-xl', trailing: 'pe-3' }"
                            @elegido="cliente = $event"
                        />
                    </div>
                    <UKbd
                        value="F2"
                        class="hidden lg:inline-flex"
                    />
                    <UDropdownMenu
                        v-if="puede('cajas.ver')"
                        :items="itemsCajaMenu"
                        :content="{ align: 'end' }"
                    >
                        <UButton
                            :label="etiquetaCaja"
                            :color="cajaAbierta ? 'success' : 'warning'"
                            variant="soft"
                            size="sm"
                            class="rounded-full"
                            :aria-label="`Caja del cobro: ${etiquetaCaja}`"
                            data-prueba="caja-cobro"
                        >
                            <template #leading>
                                <span
                                    class="size-2 rounded-full"
                                    :class="cajaAbierta ? 'bg-success' : 'bg-warning'"
                                    aria-hidden="true"
                                />
                            </template>
                        </UButton>
                    </UDropdownMenu>
                    <UDropdownMenu
                        v-if="puede('pagos.ver')"
                        :items="itemsRecientes"
                        :content="{ align: 'end' }"
                    >
                        <UButton
                            label="Recientes"
                            icon="i-lucide-history"
                            color="neutral"
                            variant="outline"
                            class="rounded-full"
                            data-prueba="recientes"
                        />
                    </UDropdownMenu>
                </div>

                <ProblemaAlerta
                    v-if="problemaCliente"
                    :problema="problemaCliente"
                    :reintentar="() => elegirCliente(clienteId)"
                />

                <div
                    v-if="!clienteId"
                    class="surface-card flex flex-1 items-center justify-center rounded-2xl p-6"
                >
                    <UEmpty
                        icon="i-lucide-banknote"
                        title="Busca al cliente que va a pagar"
                        description="Por nombre, teléfono, código del servicio o IP. Verás lo que debe marcado por servicio. Esc limpia la pantalla."
                        variant="naked"
                    />
                </div>

                <template v-else-if="cliente">
                    <div
                        class="surface-card flex items-center gap-3 rounded-2xl p-3 sm:p-4"
                        data-prueba="cliente-cobro"
                    >
                        <AvatarIniciales
                            :nombre="cliente.nombre"
                            class="size-11 rounded-xl"
                        />
                        <div class="flex min-w-0 flex-1 flex-col">
                            <ULink
                                :to="`/clientes/${cliente.id}`"
                                class="truncate text-base font-bold text-highlighted hover:text-primary sm:text-lg"
                            >
                                {{ cliente.nombre }}
                            </ULink>
                            <span class="truncate text-xs text-muted">
                                {{ cliente.codigo }}<template v-if="cliente.movil ?? cliente.telefono"> · {{ cliente.movil ?? cliente.telefono }}</template>
                            </span>
                            <span
                                v-if="saldoAFavor && saldoAFavor.gt(0)"
                                class="flex items-center gap-1 text-xs text-info"
                                data-prueba="saldo-a-favor"
                            >
                                <UIcon
                                    name="i-lucide-piggy-bank"
                                    class="size-3.5"
                                />
                                Saldo a favor {{ formatearQuetzales(saldoAFavor) }}
                            </span>
                        </div>
                        <div
                            v-if="resumen"
                            class="flex shrink-0 flex-col items-end"
                        >
                            <span class="text-[0.6875rem] text-muted">Debe</span>
                            <span
                                class="text-lg font-bold tabular-nums sm:text-xl"
                                :class="resumen.vencido.gt(0) ? 'text-error' : 'text-highlighted'"
                                data-prueba="pendiente"
                            >{{ formatearQuetzales(resumen.pendiente) }}</span>
                        </div>
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="ghost"
                            aria-label="Quitar cliente y empezar otro cobro"
                            aria-keyshortcuts="Escape"
                            @click="clienteId = 0"
                        />
                    </div>

                    <section
                        v-if="puede('clientes.estado_cuenta')"
                        class="surface-card flex min-h-0 flex-col overflow-hidden rounded-2xl"
                        aria-label="Qué paga"
                    >
                        <div class="flex items-center gap-2 border-b border-(--ax-borde) px-4 py-3">
                            <h2 class="text-[0.9375rem] font-bold text-highlighted">
                                ¿Qué paga?
                            </h2>
                            <span class="hidden flex-1 text-xs text-muted sm:inline">marca las facturas</span>
                            <span class="flex-1 sm:hidden" />
                            <UButton
                                v-if="resumen?.vencidas"
                                label="Todas las vencidas"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="rounded-full"
                                data-prueba="todas-vencidas"
                                @click="marcarVencidas"
                            />
                        </div>

                        <div class="min-h-0 flex-1 overflow-y-auto">
                            <div
                                v-if="problemaCuenta"
                                class="p-4"
                            >
                                <ProblemaAlerta
                                    :problema="problemaCuenta"
                                    :reintentar="cargarCuenta"
                                    :reintentando="cargandoCuenta"
                                />
                            </div>
                            <div
                                v-else-if="!resumen"
                                class="flex flex-col gap-2 p-4"
                            >
                                <USkeleton class="h-12" />
                                <USkeleton class="h-12" />
                            </div>
                            <template v-else>
                                <div
                                    v-for="grupo in gruposServicio"
                                    :key="grupo.clave"
                                    :data-grupo-servicio="grupo.clave"
                                >
                                    <div class="flex items-center gap-2 border-b border-(--ax-borde) bg-(--ax-cabecera-tabla) px-4 py-2.5 text-sm">
                                        <UIcon
                                            :name="grupo.servicio ? 'i-lucide-wifi' : 'i-lucide-receipt-text'"
                                            class="size-4 shrink-0 text-primary"
                                        />
                                        <span class="truncate font-semibold text-highlighted">
                                            <template v-if="grupo.servicio">{{ grupo.servicio.codigo }}<template v-if="grupo.servicio.nombre"> · {{ grupo.servicio.nombre }}</template></template>
                                            <template v-else-if="grupo.clave === 'sin-servicio'">Otros cargos</template>
                                            <template v-else>{{ nombresServicio.get(Number(grupo.clave)) ?? `Servicio #${grupo.clave}` }}</template>
                                        </span>
                                        <span
                                            v-if="grupo.servicio?.plan_nombre"
                                            class="hidden truncate text-muted sm:inline"
                                        >{{ grupo.servicio.plan_nombre }}</span>
                                        <span class="flex-1" />
                                        <UBadge
                                            v-if="grupo.servicio && reactivados.has(grupo.servicio.id)"
                                            label="Reactivado"
                                            icon="i-lucide-party-popper"
                                            color="success"
                                            variant="solid"
                                            size="sm"
                                        />
                                        <EstadoServicioBadge
                                            v-if="grupo.servicio"
                                            :estado="grupo.servicio.estado"
                                            size="sm"
                                            :data-servicio="grupo.servicio.id"
                                        />
                                        <SuspensionManualBadge
                                            v-if="grupo.servicio"
                                            :servicio="grupo.servicio"
                                            size="sm"
                                        />
                                    </div>
                                    <CobroFacturasLista
                                        :facturas="grupo.facturas"
                                        :marcadas="marcadas"
                                        :servicios="nombresServicio"
                                        agrupadas
                                        @marcar="marcar"
                                    />
                                </div>

                                <p
                                    v-if="!resumen.facturas.length"
                                    class="flex items-center gap-2 px-4 py-4 text-sm text-success"
                                >
                                    <UIcon
                                        name="i-lucide-badge-check"
                                        class="size-4"
                                    />
                                    No tiene facturas pendientes. Con «Abono» puedes dejar un anticipo.
                                </p>

                                <!-- Cuentas a su cargo (responsable de pago) y otros clientes agregados. -->
                                <div
                                    v-if="problemaDependientes"
                                    class="p-4"
                                >
                                    <ProblemaAlerta
                                        :problema="problemaDependientes"
                                        :reintentar="() => cargarDependientes(clienteId)"
                                    />
                                </div>
                                <div
                                    v-for="grupo in grupos"
                                    :key="grupo.cliente.id"
                                    :data-grupo="grupo.cliente.id"
                                >
                                    <div class="flex items-center gap-2 border-b border-(--ax-borde) bg-(--ax-cabecera-tabla) px-4 py-2.5 text-sm">
                                        <UIcon
                                            :name="grupo.origen === 'dependiente' ? 'i-lucide-hand' : 'i-lucide-user-plus'"
                                            class="size-4 shrink-0 text-primary"
                                        />
                                        <span class="min-w-0 truncate">
                                            <span class="font-semibold text-highlighted">{{ grupo.origen === 'dependiente' ? 'A su cargo' : 'Otro cliente' }}</span>
                                            <span class="text-muted"> · {{ grupo.cliente.nombre }}</span>
                                        </span>
                                        <span class="flex-1" />
                                        <UCheckbox
                                            v-if="grupo.abierto && resumenGrupo(grupo)?.facturas.length"
                                            :model-value="estadoCasillaGrupo(grupo)"
                                            :aria-label="`Pagar todas las facturas de ${grupo.cliente.nombre}`"
                                            @update:model-value="marcarGrupo(grupo, $event === true)"
                                        />
                                        <UBadge
                                            v-if="insigniaGrupo(grupo)"
                                            :label="insigniaGrupo(grupo)?.etiqueta"
                                            :color="insigniaGrupo(grupo)?.color"
                                            :icon="insigniaGrupo(grupo)?.color === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-clock'"
                                            variant="subtle"
                                            size="sm"
                                            class="rounded-full"
                                        />
                                        <UButton
                                            v-if="!grupo.abierto"
                                            label="Verifiqué el DPI"
                                            icon="i-lucide-id-card"
                                            size="xs"
                                            color="primary"
                                            variant="soft"
                                            class="rounded-full"
                                            :aria-expanded="false"
                                            :aria-label="`Verifiqué el DPI: ver las facturas de ${grupo.cliente.nombre}`"
                                            data-prueba="verifique-dpi"
                                            @click="grupo.abierto = true"
                                        />
                                        <UButton
                                            v-if="grupo.origen === 'agregado'"
                                            icon="i-lucide-x"
                                            color="neutral"
                                            variant="ghost"
                                            size="xs"
                                            :aria-label="`Quitar a ${grupo.cliente.nombre} de este cobro`"
                                            @click="quitarGrupo(grupo)"
                                        />
                                    </div>
                                    <template v-if="grupo.abierto">
                                        <div
                                            v-if="grupo.problema"
                                            class="p-4"
                                        >
                                            <ProblemaAlerta
                                                :problema="grupo.problema"
                                                :reintentar="() => cargarGrupo(grupo)"
                                                :reintentando="grupo.cargando"
                                            />
                                        </div>
                                        <USkeleton
                                            v-else-if="!resumenGrupo(grupo)"
                                            class="m-4 h-12"
                                        />
                                        <CobroFacturasLista
                                            v-else-if="resumenGrupo(grupo)?.facturas.length"
                                            :facturas="resumenGrupo(grupo)?.facturas ?? []"
                                            :marcadas="marcadas"
                                            :servicios="nombresServicio"
                                            :etiqueta="`Facturas pendientes de ${grupo.cliente.nombre}`"
                                            @marcar="marcar"
                                        />
                                        <p
                                            v-else
                                            class="px-4 py-3 text-sm text-success"
                                        >
                                            No tiene facturas pendientes.
                                        </p>
                                    </template>
                                </div>

                                <div class="flex flex-wrap items-center gap-2 px-4 py-3">
                                    <UButton
                                        v-if="!agregando"
                                        label="Agregar facturas de otro cliente"
                                        icon="i-lucide-user-plus"
                                        color="neutral"
                                        variant="link"
                                        size="sm"
                                        @click="agregando = true"
                                    />
                                    <div
                                        v-else
                                        class="flex w-full items-center gap-2"
                                    >
                                        <ClienteSelector
                                            v-model="clienteAgregado"
                                            placeholder="Buscar otro cliente…"
                                            aria-label="Buscar otro cliente para agregar sus facturas"
                                            @elegido="agregarCliente"
                                        />
                                        <UButton
                                            icon="i-lucide-x"
                                            color="neutral"
                                            variant="ghost"
                                            aria-label="Cancelar"
                                            @click="agregando = false"
                                        />
                                    </div>
                                    <span
                                        v-if="totalMarcadas && marcadas.length && !pago"
                                        class="ms-auto text-xs text-muted"
                                        data-prueba="total-marcadas"
                                    >
                                        {{ marcadas.length }} {{ marcadas.length === 1 ? 'marcada' : 'marcadas' }} · {{ formatearQuetzales(totalMarcadas) }}<template v-if="marcadasDeTerceros.cuantas"> · {{ marcadasDeTerceros.cuantas }} de otros clientes ({{ formatearQuetzales(marcadasDeTerceros.total) }})</template>
                                    </span>
                                </div>
                            </template>
                        </div>
                    </section>

                    <ProblemaAlerta
                        v-if="problemaServicios"
                        :problema="problemaServicios"
                        :reintentar="cargarServicios"
                        :reintentando="cargandoServicios"
                    />
                </template>

                <!--
                    Teléfono: total marcado y «Continuar» como acción fija, en su isla justo encima de
                    la navegación (tablero MarcoMovil), sin taparla ni quedar tapada.
                -->
                <PanelBarraAccion
                    v-if="cliente"
                    class="gap-3 ps-4 lg:hidden"
                >
                    <div class="flex min-w-0 flex-1 flex-col">
                        <span class="text-xs text-muted">{{ marcadas.length }} {{ marcadas.length === 1 ? 'factura' : 'facturas' }}</span>
                        <span class="text-xl font-bold tabular-nums text-highlighted">{{ formatearQuetzales(totalMarcadas ?? '0.00') }}</span>
                    </div>
                    <UButton
                        label="Continuar"
                        trailing-icon="i-lucide-chevron-right"
                        size="xl"
                        class="glow-brand rounded-full px-6"
                        data-prueba="continuar-cobro"
                        @click="pantalla = 'cobro'"
                    />
                </PanelBarraAccion>
            </div>

            <!--
                Pantalla 2: el cobro (panel derecho en escritorio). En el teléfono ocupa la pantalla y
                termina encima de la isla de navegación (tablero MarcoMovil), así «Cobrar» queda a la vista.
            -->
            <section
                class="surface-card min-h-0 flex-col overflow-hidden rounded-[1.375rem] max-lg:fixed max-lg:inset-x-0 max-lg:top-0 max-lg:bottom-(--ax-isla-reserva) max-lg:z-30 max-lg:rounded-none lg:flex"
                :class="pantalla === 'cobro' ? 'flex' : 'hidden'"
                aria-label="Registrar pago"
                data-prueba="panel-cobro"
            >
                <div class="flex items-center gap-3 border-b border-(--ax-borde) px-4 py-3 lg:hidden">
                    <UButton
                        icon="i-lucide-chevron-left"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        aria-label="Volver a la lista"
                        @click="pantalla = 'lista'"
                    />
                    <div class="flex min-w-0 flex-col">
                        <span class="truncate text-base font-bold text-highlighted">Cobrar a {{ cliente?.nombre ?? '…' }}</span>
                        <span class="text-xs text-muted">{{ marcadas.length }} {{ marcadas.length === 1 ? 'factura' : 'facturas' }} · {{ etiquetaCaja }}</span>
                    </div>
                </div>

                <div
                    v-if="!cliente"
                    class="flex flex-1 items-center justify-center p-6"
                >
                    <UEmpty
                        icon="i-lucide-hand-coins"
                        title="Primero elige al cliente"
                        description="Aquí eliges Pago completo o Abono, el método y lo que te entrega."
                        variant="naked"
                    />
                </div>

                <template v-else>
                    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
                        <UTabs
                            v-model="modo"
                            :items="itemsModo"
                            :content="false"
                            color="neutral"
                            variant="pill"
                            class="w-full"
                            :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1', trigger: 'flex-1 rounded-lg py-2 data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm' }"
                            aria-label="Pago completo o abono"
                            data-prueba="modo-cobro"
                        />

                        <div
                            v-if="modo === 'completo'"
                            class="flex items-end justify-between gap-3"
                        >
                            <span class="pb-1 text-sm text-muted">A cobrar</span>
                            <span
                                class="text-4xl font-bold tracking-tight tabular-nums text-highlighted"
                                data-prueba="a-cobrar"
                            >{{ formatearQuetzales(montoActual ?? '0.00') }}</span>
                        </div>
                        <UFormField
                            v-else
                            name="monto"
                            required
                            :ui="{ root: 'flex flex-col gap-1' }"
                        >
                            <div class="flex items-center justify-between gap-3">
                                <span class="flex flex-col">
                                    <span class="text-sm text-highlighted">Abona</span>
                                    <span
                                        v-if="totalMarcadas"
                                        class="text-xs text-muted"
                                    >de {{ formatearQuetzales(totalMarcadas) }}</span>
                                </span>
                                <UInput
                                    v-model="estado.monto"
                                    inputmode="decimal"
                                    autocomplete="off"
                                    placeholder="0.00"
                                    aria-label="Monto del abono"
                                    :variant="foco === 'abono' ? 'outline' : 'soft'"
                                    class="w-48"
                                    :ui="{ base: foco === 'abono' ? 'h-14 rounded-2xl border-2 border-primary text-end text-2xl font-bold tabular-nums ring-4 ring-primary/10' : 'h-10 rounded-xl border border-dashed border-(--ax-borde) text-end text-lg font-semibold tabular-nums' }"
                                    data-prueba="campo-abono"
                                    @focus="foco = 'abono'"
                                >
                                    <template #leading>
                                        <span class="text-sm text-muted">Q</span>
                                    </template>
                                </UInput>
                            </div>
                            <p
                                v-if="resumenAbono"
                                class="text-xs text-muted"
                                data-prueba="resumen-abono"
                            >
                                {{ resumenAbono }}
                            </p>
                        </UFormField>

                        <div
                            v-if="distribucion && (distribucion.parcial || distribucion.sinCubrir.length || distribucion.excedente.gt(0))"
                            class="-mt-2 flex flex-col gap-1 text-xs"
                            data-prueba="distribucion"
                        >
                            <p
                                v-if="distribucion.parcial && modo === 'completo'"
                                class="text-warning"
                                data-prueba="aviso-parcial"
                            >
                                No alcanza para las marcadas: el aviso #{{ distribucion.parcial.factura.id }} quedará parcial
                                ({{ formatearQuetzales(distribucion.parcial.aplicado) }} de {{ formatearQuetzales(saldoFactura(distribucion.parcial.factura)) }}).
                            </p>
                            <p
                                v-if="distribucion.sinCubrir.length && modo === 'completo'"
                                class="text-warning"
                                data-prueba="aviso-sin-cubrir"
                            >
                                {{ distribucion.sinCubrir.length === 1 ? 'El aviso' : 'Los avisos' }} {{ distribucion.sinCubrir.map(f => `#${f.id}`).join(', ') }} no {{ distribucion.sinCubrir.length === 1 ? 'recibe' : 'reciben' }} nada.
                            </p>
                            <p
                                v-if="distribucion.excedente.gt(0)"
                                class="text-info"
                                data-prueba="aviso-excedente"
                            >
                                Pasa {{ formatearQuetzales(distribucion.excedente) }} de las marcadas:
                                <template v-if="distribucion.otras.length">
                                    va a {{ distribucion.otras.map(l => `#${l.factura.id} (${formatearQuetzales(l.aplicado)})`).join(', ') }}<template v-if="distribucion.aFavor.gt(0)">
                                        y {{ formatearQuetzales(distribucion.aFavor) }} a saldo a favor
                                    </template>.
                                </template>
                                <template v-else>
                                    queda como saldo a favor.
                                </template>
                            </p>
                        </div>
                        <p
                            v-if="restante && restante.lt(0)"
                            class="-mt-2 text-xs text-info"
                        >
                            Paga {{ formatearQuetzales(restante.abs()) }} de más: queda como saldo a favor.
                        </p>

                        <UFormField
                            name="metodo"
                            label="Método"
                            :ui="{ label: 'sr-only' }"
                        >
                            <UTabs
                                v-model="grupoMetodo"
                                :items="itemsGrupoMetodo"
                                :content="false"
                                color="neutral"
                                variant="pill"
                                class="w-full"
                                :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1', trigger: 'flex-1 flex-col gap-1 rounded-lg px-1 py-2 text-xs data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm', leadingIcon: 'size-4' }"
                                aria-label="Método de pago"
                                data-prueba="metodos-cobro"
                            />
                        </UFormField>

                        <UAlert
                            v-if="avisoSinCaja"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-lock"
                            :title="avisoSinCaja.titulo"
                            :description="puede('cajas.abrir') ? avisoSinCaja.detalle : `${avisoSinCaja.detalle} Pide a un supervisor que la abra.`"
                            :actions="puede('cajas.abrir') && avisoSinCaja.opciones.length ? [{ label: 'Abrir caja', icon: 'i-lucide-lock-open', color: 'warning', variant: 'solid', onClick: () => abrirCaja(avisoSinCaja?.opciones ?? []) }] : []"
                            data-prueba="aviso-sin-caja"
                        />
                        <p
                            v-if="estado.metodo === 'caja' && problemaCajas"
                            class="flex flex-wrap items-center gap-1.5 text-xs text-muted"
                            data-prueba="cajas-sin-lista"
                        >
                            <UIcon
                                name="i-lucide-triangle-alert"
                                class="size-4 text-warning"
                            />
                            Caja principal · no se pudo leer la lista de cajas ({{ problemaCajas.status }})
                            <UButton
                                label="Reintentar"
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="link"
                                size="xs"
                                @click="cargarCajas"
                            />
                        </p>

                        <!-- Efectivo: «Recibido» destacado, el cambio justo debajo, montos rápidos y teclado. -->
                        <template v-if="estado.metodo === 'caja'">
                            <div class="flex flex-col gap-1.5">
                                <UInput
                                    v-model="recibido"
                                    inputmode="decimal"
                                    autocomplete="off"
                                    placeholder="0.00"
                                    aria-label="Recibido del cliente"
                                    :variant="modo === 'completo' || foco === 'recibido' ? 'outline' : 'soft'"
                                    class="w-full"
                                    :ui="{ base: modo === 'completo' || foco === 'recibido' ? 'h-16 rounded-2xl border-2 border-primary ps-24 text-end text-[1.75rem] font-bold tabular-nums ring-4 ring-primary/10' : 'h-11 rounded-xl border border-dashed border-(--ax-borde) ps-24 text-end text-base font-semibold tabular-nums', leading: 'ps-4' }"
                                    data-prueba="campo-recibido"
                                    @focus="foco = 'recibido'"
                                >
                                    <template #leading>
                                        <span class="text-sm font-semibold text-primary">Recibido</span>
                                    </template>
                                </UInput>
                                <p
                                    v-if="cambio"
                                    class="text-end text-sm font-bold"
                                    :class="cambio.lt(0) ? 'text-error' : 'text-success'"
                                    aria-live="polite"
                                    data-prueba="cambio"
                                >
                                    {{ cambio.lt(0) ? `Falta recibir ${formatearQuetzales(cambio.abs())}` : `Cambio a entregar: ${formatearQuetzales(cambio)}` }}
                                </p>
                            </div>
                            <div class="grid grid-cols-4 gap-2">
                                <UButton
                                    label="Exacto"
                                    color="primary"
                                    variant="soft"
                                    class="justify-center rounded-xl py-2.5 font-bold"
                                    @click="recibidoRapido(null)"
                                />
                                <UButton
                                    v-for="rapido in RAPIDOS"
                                    :key="rapido.valor"
                                    :label="rapido.etiqueta"
                                    color="primary"
                                    variant="soft"
                                    class="justify-center rounded-xl py-2.5 font-bold"
                                    @click="recibidoRapido(rapido.valor)"
                                />
                            </div>
                            <CobroTeclado
                                class="hidden lg:grid"
                                @tecla="tecla"
                            />
                            <p class="text-center text-[0.6875rem] text-dimmed">
                                También con tu teclado: números y punto · Tab cambia de campo · Enter cobra
                            </p>
                        </template>

                        <!-- Tarjeta: marca, autorización y últimos 4 dígitos. -->
                        <template v-else-if="estado.metodo === 'debito'">
                            <div
                                class="flex flex-wrap gap-2"
                                role="group"
                                aria-label="Marca de la tarjeta"
                            >
                                <UButton
                                    v-for="marca in MARCAS_TARJETA"
                                    :key="marca"
                                    :label="marca"
                                    :color="marcaTarjeta === marca ? 'primary' : 'neutral'"
                                    :variant="marcaTarjeta === marca ? 'solid' : 'outline'"
                                    :aria-pressed="marcaTarjeta === marca"
                                    class="rounded-full"
                                    @click="marcaTarjeta = marca"
                                />
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <UFormField
                                    :label="etiquetaReferencia(estado.metodo)"
                                    name="referencia"
                                >
                                    <UInput
                                        v-model="estado.referencia"
                                        autocomplete="off"
                                        placeholder="del voucher"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField label="Últimos 4 dígitos">
                                    <UInput
                                        v-model="ultimos4"
                                        inputmode="numeric"
                                        maxlength="4"
                                        autocomplete="off"
                                        placeholder="opcional"
                                        class="w-full"
                                    />
                                </UFormField>
                            </div>
                        </template>

                        <!-- Transferencia o depósito: tipo, cuenta propia, banco de origen y referencia. -->
                        <template v-else>
                            <UFormField
                                label="Tipo"
                                required
                            >
                                <UTabs
                                    v-model="metodoElegido"
                                    :items="grupoMetodo === 'transferencia' ? itemsTipoTransferencia : itemsTipoDeposito"
                                    :content="false"
                                    color="neutral"
                                    variant="pill"
                                    size="sm"
                                    class="w-full"
                                    :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1', trigger: 'flex-1 rounded-lg data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm' }"
                                    :aria-label="grupoMetodo === 'transferencia' ? 'Tipo de transferencia' : 'Tipo de depósito'"
                                    data-prueba="tipo-metodo"
                                />
                            </UFormField>
                            <UFormField
                                v-if="pideDato(estado.metodo, 'cuenta_bancaria_id')"
                                :label="grupoMetodo === 'transferencia' ? 'Cuenta que recibió' : estado.metodo === 'remesa' ? 'Cuenta donde entró' : 'Cuenta donde depositó'"
                                name="cuenta_bancaria_id"
                                required
                            >
                                <USelect
                                    v-if="cuentasDestino.length"
                                    v-model="cuentaDestino"
                                    :items="itemsCuenta"
                                    placeholder="Elegir cuenta…"
                                    icon="i-lucide-landmark"
                                    class="w-full"
                                    aria-label="Cuenta de destino"
                                />
                                <p
                                    v-else-if="!puede('cuentas_bancarias.ver')"
                                    class="text-sm text-error"
                                >
                                    Te falta el permiso para ver las cuentas bancarias (cuentas_bancarias.ver).
                                </p>
                                <div
                                    v-else-if="problemaCuentas"
                                    class="flex flex-wrap items-center gap-x-2 text-sm"
                                    data-prueba="cuentas-error"
                                >
                                    <span class="text-error">No se pudo leer las cuentas bancarias ({{ problemaCuentas.status }})</span>
                                    <UButton
                                        label="Reintentar"
                                        icon="i-lucide-refresh-cw"
                                        color="neutral"
                                        variant="link"
                                        size="xs"
                                        @click="cargarCuentasBancarias"
                                    />
                                </div>
                                <p
                                    v-else
                                    class="text-sm text-warning"
                                >
                                    No hay cuentas bancarias activas en quetzales.
                                    <ULink
                                        v-if="puede('cuentas_bancarias.editar')"
                                        to="/configuracion/cuentas-bancarias"
                                        class="text-primary"
                                    >
                                        Crear una
                                    </ULink>
                                </p>
                            </UFormField>
                            <UFormField
                                v-if="estado.metodo === 'ach'"
                                label="Banco de origen"
                                name="banco_origen_id"
                                required
                                help="De la lista de bancos de Ajustes"
                            >
                                <USelectMenu
                                    v-model="bancoOrigen"
                                    :items="itemsBanco"
                                    value-key="value"
                                    placeholder="Elegir banco…"
                                    icon="i-lucide-landmark"
                                    :search-input="{ placeholder: 'Buscar banco…' }"
                                    class="w-full"
                                    aria-label="Banco de origen"
                                />
                                <div
                                    v-if="problemaBancos"
                                    class="mt-1 flex flex-wrap items-center gap-x-2 text-sm"
                                    data-prueba="bancos-error"
                                >
                                    <span class="text-error">No se pudo leer el catálogo de bancos ({{ problemaBancos.status }})</span>
                                    <UButton
                                        label="Reintentar"
                                        icon="i-lucide-refresh-cw"
                                        color="neutral"
                                        variant="link"
                                        size="xs"
                                        @click="cargarBancos"
                                    />
                                </div>
                            </UFormField>
                            <p
                                v-else-if="estado.metodo === 'transferencia'"
                                class="-mt-2 text-xs text-muted"
                                data-prueba="banco-mismo"
                            >
                                Banco de origen: {{ cuentaElegida ? `${cuentaElegida.banco_nombre} (el mismo de la cuenta)` : 'el de la cuenta que recibió' }}
                            </p>
                            <UFormField
                                :label="estado.metodo === 'deposito' ? 'Número de boleta' : estado.metodo === 'remesa' ? 'Código de la remesa' : grupoMetodo === 'transferencia' ? 'Número de referencia' : etiquetaReferencia(estado.metodo)"
                                name="referencia"
                                :required="pideDato(estado.metodo, 'referencia')"
                                :hint="pideDato(estado.metodo, 'referencia') ? undefined : 'Opcional'"
                            >
                                <UInput
                                    v-model="estado.referencia"
                                    autocomplete="off"
                                    :placeholder="estado.metodo === 'deposito' ? 'impreso en la boleta' : estado.metodo === 'remesa' ? 'código que dio la remesadora' : 'de la transferencia'"
                                    class="w-full"
                                />
                            </UFormField>
                        </template>

                        <UButton
                            v-if="!conNota && !estado.nota"
                            label="Agregar nota"
                            icon="i-lucide-sticky-note"
                            color="neutral"
                            variant="link"
                            size="xs"
                            class="self-start"
                            @click="conNota = true"
                        />
                        <UFormField
                            v-else
                            label="Nota"
                            name="nota"
                            hint="Opcional"
                        >
                            <UInput
                                v-model="estado.nota"
                                autocomplete="off"
                                class="w-full"
                            />
                        </UFormField>

                        <div
                            v-if="reparto.length > 1 && !pago"
                            class="flex flex-col gap-2 rounded-xl bg-(--ax-panel) p-3"
                            role="group"
                            aria-label="Reparto del cobro por empresa"
                            data-prueba="reparto-empresas"
                        >
                            <p class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
                                <UIcon
                                    name="i-lucide-split"
                                    class="size-4"
                                />
                                Un pago por empresa
                            </p>
                            <p class="text-xs text-muted">
                                Las facturas son de {{ reparto.length }} empresas: se registra un pago para cada NIT, cada uno en la caja de esa empresa.
                            </p>
                            <ul class="flex flex-col divide-y divide-(--ax-borde)">
                                <li
                                    v-for="parte in reparto"
                                    :key="parte.empresaId ?? 'ninguna'"
                                    class="flex items-center justify-between gap-3 py-1.5 text-sm"
                                    :data-empresa="parte.empresaId ?? 'ninguna'"
                                >
                                    <span class="flex min-w-0 items-center gap-1.5">
                                        <UIcon
                                            name="i-lucide-building-2"
                                            class="size-4 shrink-0 text-muted"
                                        />
                                        <span class="truncate">{{ parte.empresaId !== null ? nombreEmpresa(parte.empresaId) : empresaActiva !== null ? 'Otras empresas' : 'Empresa sin identificar' }}</span>
                                        <span class="shrink-0 text-xs text-muted">· {{ parte.facturas.length }} {{ parte.facturas.length === 1 ? 'aviso' : 'avisos' }}</span>
                                    </span>
                                    <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(parte.total) }}</span>
                                </li>
                            </ul>
                        </div>

                        <UAlert
                            v-if="problemaPago && esReferenciaDuplicada(problemaPago)"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-copy-x"
                            title="Esa referencia ya se registró"
                            :description="`${problemaPago.detail ?? ''}. No se cobró de nuevo: revisa el comprobante o busca el pago anterior en Pagos.`"
                            data-prueba="referencia-duplicada"
                        />
                        <ProblemaAlerta
                            v-else-if="problemaPago && problemaPago.status !== 422"
                            :problema="problemaPago"
                        />
                        <UAlert
                            v-else-if="esCuentaInactiva(problemaPago)"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-landmark"
                            title="La cuenta bancaria está desactivada"
                            :description="MENSAJE_CUENTA_INACTIVA"
                            data-prueba="cuenta-inactiva"
                        />
                        <UAlert
                            v-else-if="sinCaja"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-lock"
                            :title="`No tienes caja abierta en ${sinCaja.nombre}`"
                            description="Las facturas marcadas incluyen avisos de esa empresa y el efectivo va a su propia caja. Abre una caja de esa empresa y vuelve a registrar el cobro."
                            :actions="puede('cajas.abrir') ? [{ label: 'Abrir caja', icon: 'i-lucide-lock-open', color: 'warning', variant: 'solid', onClick: () => abrirCaja(cajasDeEmpresa(sinCaja!.id)) }] : []"
                            data-prueba="caja-no-abierta"
                        />
                        <UAlert
                            v-else-if="problemaPago"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-circle-alert"
                            :title="problemaPago.title"
                            :description="problemaPago.detail ?? 'Corrige los campos marcados.'"
                        >
                            <template
                                v-if="erroresSinCampo.length"
                                #description
                            >
                                <p>{{ problemaPago.detail ?? 'Corrige los campos marcados.' }}</p>
                                <ul
                                    class="mt-1 list-disc ps-4"
                                    data-prueba="errores-sin-campo"
                                >
                                    <li
                                        v-for="error in erroresSinCampo"
                                        :key="`${error.field}-${error.message}`"
                                    >
                                        {{ error.message }}
                                    </li>
                                </ul>
                            </template>
                        </UAlert>
                    </div>

                    <div class="flex flex-col gap-3 border-t border-(--ax-borde) p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
                        <div class="flex flex-wrap items-center gap-2">
                            <UButton
                                :label="presentacionFormato(formatoRecibo).corta"
                                :icon="ICONOS.imprimir"
                                size="xs"
                                :color="imprimirAlCobrar ? 'primary' : 'neutral'"
                                :variant="imprimirAlCobrar ? 'solid' : 'outline'"
                                :aria-pressed="imprimirAlCobrar"
                                class="rounded-full"
                                :title="`Imprimir el recibo al cobrar (${presentacionFormato(formatoRecibo).etiqueta}, el formato de la caja)`"
                                data-prueba="chip-recibo"
                                @click="imprimirAlCobrar = !imprimirAlCobrar"
                            />
                            <span class="flex-1" />
                            <PromesaServicioBoton
                                v-if="puede('promesas.crear')"
                                :servicios="serviciosVista"
                                :boton="{ label: 'Promesa en vez de pago', color: 'primary', variant: 'link', size: 'sm', class: 'px-0' }"
                                @creada="elegirCliente(clienteId)"
                            />
                        </div>
                        <UButton
                            type="submit"
                            :label="textoCobrar"
                            icon="i-lucide-banknote"
                            size="xl"
                            color="success"
                            block
                            :loading="enviando"
                            :disabled="!puedeCobrar"
                            class="h-14 rounded-2xl text-lg font-bold shadow-lg shadow-success/25"
                            aria-keyshortcuts="Enter"
                            data-prueba="cobrar"
                        />
                    </div>
                </template>
            </section>
        </UForm>

        <!-- Recibo para imprimir (ticket de 80 mm): fuera de la vista, sale solo al imprimir. -->
        <div
            v-if="cliente && pago"
            class="pointer-events-none fixed top-0 -left-[200vw] w-[80mm] print:left-0"
        >
            <ReciboCobro
                v-if="cobroRepartido && pago.cobro_id && puede('pagos.ver')"
                :cobro-id="pago.cobro_id"
                :cliente="cliente"
                :cajero="usuario?.nombre ?? null"
            />
            <ReciboPago
                v-else
                :pago="pago"
                :cliente="cliente"
                :facturas="facturasAntes"
                :servicios="serviciosPantalla"
                :caja="nombreCaja"
                :cajero="usuario?.nombre ?? null"
                :reactivados="seguimiento.reactivados.value"
                :suspendidos-manual="seguimiento.suspendidosManual.value"
            />
        </div>

        <UModal
            v-model:open="exitoAbierto"
            title="¡Cobro listo!"
            :ui="{ content: 'sm:max-w-md', header: 'hidden' }"
        >
            <template #body>
                <div
                    v-if="pago"
                    class="flex flex-col items-center gap-3 py-2 text-center"
                    data-prueba="cobro-listo"
                >
                    <span class="flex size-18 items-center justify-center rounded-full bg-success/15 text-success">
                        <UIcon
                            name="i-lucide-check"
                            class="size-9"
                        />
                    </span>
                    <h2 class="text-xl font-bold text-highlighted">
                        ¡Cobro listo!
                    </h2>
                    <p class="text-sm text-muted">
                        Recibo <span class="font-mono">#{{ pago.cobro_id ?? pago.id }}</span> · {{ formatearQuetzales(totalCobrado) }} · {{ ETIQUETAS_METODO[pago.metodo] }}<template v-if="nombreCaja">
                            · {{ nombreCaja }}
                        </template>
                    </p>
                    <p
                        v-if="cambioEntregado"
                        class="text-base text-highlighted"
                        data-prueba="cambio-entregar"
                    >
                        Entregar cambio: <span class="text-2xl font-bold tabular-nums text-success">{{ formatearQuetzales(cambioEntregado) }}</span>
                    </p>
                    <ul
                        v-if="cobroRepartido"
                        class="flex w-full flex-col gap-1 rounded-xl bg-(--ax-panel) p-3 text-sm"
                        aria-label="Pagos por empresa"
                        data-prueba="pagos-por-empresa"
                    >
                        <li
                            v-for="parte in pagosDelCobro"
                            :key="parte.id"
                            class="flex justify-between gap-3"
                        >
                            <span class="truncate">{{ nombreDeEmpresa(parte.empresa_id) }} · Pago #{{ parte.id }}</span>
                            <span class="tabular-nums">{{ formatearQuetzales(parte.monto) }}</span>
                        </li>
                    </ul>
                    <div
                        v-for="servicio in seguimiento.reactivados.value"
                        :key="servicio.id"
                        class="flex w-full items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-start text-sm text-success"
                        :data-servicio="servicio.id"
                    >
                        <UIcon
                            name="i-lucide-zap"
                            class="size-4 shrink-0"
                        />
                        <span>
                            <ULink
                                :to="`/servicios/${servicio.id}`"
                                class="font-semibold underline"
                            >{{ servicio.codigo }}</ULink><template v-if="servicio.nombre"> · {{ servicio.nombre }}</template> se reactivó
                        </span>
                    </div>
                    <p
                        v-if="seguimiento.siguiendo.value"
                        class="flex items-center gap-1.5 text-xs text-muted"
                    >
                        <UIcon
                            name="i-lucide-loader-circle"
                            class="size-3.5 animate-spin"
                        />
                        Esperando la reactivación…
                    </p>
                    <template
                        v-for="servicio in serviciosVista"
                        :key="`motivo-${servicio.id}`"
                    >
                        <p
                            v-if="servicio.estado !== 'activo' && servicio.estado !== 'retirado' && seguimiento.motivos.value.get(servicio.id)"
                            class="w-full text-start text-xs text-muted"
                            data-prueba="motivo-evaluacion"
                        >
                            {{ servicio.codigo }} sigue {{ ESTADOS_SERVICIO[servicio.estado].etiqueta.toLowerCase() }}: {{ seguimiento.motivos.value.get(servicio.id) }}
                        </p>
                    </template>
                    <UAlert
                        v-if="seguimiento.agotado.value"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-clock-alert"
                        title="El servicio no se ha reactivado"
                        description="Pasaron 30 segundos. Puede que aún deba facturas vencidas o que la reactivación siga en cola; revisa la ficha del servicio."
                        class="text-start"
                    />
                    <ProblemaAlerta
                        v-else-if="seguimiento.problema.value"
                        :problema="seguimiento.problema.value"
                    />
                    <div class="grid w-full grid-cols-2 gap-2">
                        <!-- Reimprimir con el formato de la caja; «Elegir otra plantilla» abre el PDF con otra. -->
                        <ImprimirConPlantilla
                            v-if="pago.cobro_id && puede('pagos.ver')"
                            tipo="recibo_cobro"
                            etiqueta="Reimprimir"
                            :generando="generandoRecibo"
                            class="w-full justify-center"
                            data-prueba="recibo-pdf"
                            @imprimir="(id) => (id === null ? imprimirRecibo() : abrirReciboPdf(id))"
                        />
                        <UButton
                            v-else
                            label="Reimprimir"
                            :icon="ICONOS.imprimir"
                            color="neutral"
                            variant="outline"
                            class="justify-center rounded-full"
                            data-prueba="reimprimir"
                            @click="imprimirRecibo"
                        />
                        <UButton
                            v-if="enlaceWhatsapp"
                            :to="enlaceWhatsapp"
                            target="_blank"
                            label="WhatsApp"
                            icon="i-lucide-message-circle"
                            color="neutral"
                            variant="outline"
                            class="justify-center rounded-full"
                            data-prueba="recibo-whatsapp"
                        />
                    </div>
                    <UButton
                        label="Siguiente cliente"
                        size="lg"
                        block
                        class="glow-brand rounded-full"
                        aria-keyshortcuts="Escape"
                        data-prueba="siguiente-cliente"
                        @click="nuevoCobro"
                    />
                </div>
            </template>
        </UModal>

        <CajaAperturaModal
            v-if="puede('cajas.abrir')"
            v-model:open="aperturaAbierta"
            :caja="aperturaOpciones.length === 1 ? aperturaOpciones[0] : null"
            :opciones="aperturaOpciones"
            @hecho="alAbrirCaja"
        />
    </PanelPagina>
</template>
