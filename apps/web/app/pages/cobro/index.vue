<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cobro rápido: una sola pantalla para buscar al cliente, ver lo que debe,
 * registrar el pago y entregar el recibo. Enter registra; Esc limpia.
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
const itemsCaja = computed<SelectItem[]>(() => [
    { label: 'Caja principal (automática)', value: CAJA_PRINCIPAL },
    ...cajasActivas.value.map(c => ({
        label: c.turno_abierto_id === null ? `${c.nombre} · cerrada` : c.nombre,
        value: String(c.id),
    })),
])
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

const itemsMetodo: SelectItem[] = METODOS_COBRO.map(m => ({ label: m.etiqueta, value: m.metodo, icon: m.icono }))

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
/** Ayuda del monto: lo marcado y, con facturas de terceros, cuánto es de otros clientes. */
const ayudaMonto = computed(() => {
    if (!resumen.value) {
        return undefined
    }
    const terceros = marcadasDeTerceros.value.cuantas ? ` (${formatearQuetzales(marcadasDeTerceros.value.total)} de otros clientes)` : ''
    return `Marcadas ${formatearQuetzales(totalMarcadas.value)}${terceros} · vencido del cliente ${formatearQuetzales(resumen.value.vencido)} · pendiente ${formatearQuetzales(resumen.value.pendiente)}`
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
    if (totalMarcadas.value && !pago.value) {
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
        nota: datos.nota || null,
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
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
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
    void cargarCuenta()
    void recargarGrupos()
}

function nuevoCobro() {
    pago.value = null
    seguimiento.reiniciar()
    void cargarServicios()
    void recargarGrupos()
    limpiarFormulario()
}

/** Servicios de un grupo tal como quedaron tras el pago (si hubo), para el estado y la insignia. */
function serviciosDeGrupo(grupo: GrupoCobro): Servicio[] {
    if (!pago.value) {
        return grupo.servicios
    }
    const ids = new Set(grupo.servicios.map(s => s.id))
    return seguimiento.servicios.value.filter(s => ids.has(s.id))
}

function imprimir() {
    window.print()
}

/** Esc limpia (o empieza otro cobro tras el recibo), salvo que haya un menú o modal abierto. */
function alTeclear(evento: KeyboardEvent) {
    if (evento.key !== 'Escape' || evento.defaultPrevented) {
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

onMounted(() => {
    window.addEventListener('keydown', alTeclear)
    void cargarCajas()
    void cargarBancos()
    void cargarCuentasBancarias()
    if (clienteId.value) {
        void elegirCliente(clienteId.value)
    }
})
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclear))
</script>

<template>
    <PanelPagina
        id="cobro"
        titulo="Cobrar"
        icono="i-lucide-hand-coins"
    >
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
            <div class="flex flex-col gap-4">
                <UFormField
                    label="Cliente"
                    description="Nombre, NIT, teléfono, usuario PPP o IP"
                    name="cliente"
                >
                    <ClienteSelector
                        v-model="clienteId"
                        :seleccionado="cliente"
                        placeholder="Buscar cliente…"
                        aria-label="Buscar cliente para cobrar"
                        @elegido="cliente = $event"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problemaCliente"
                    :problema="problemaCliente"
                    :reintentar="() => elegirCliente(clienteId)"
                />

                <UEmpty
                    v-if="!clienteId"
                    icon="i-lucide-hand-coins"
                    title="Busca al cliente que va a pagar"
                    description="Verás lo que debe, sus servicios y el formulario de cobro. Esc limpia la pantalla."
                    variant="naked"
                />

                <template v-else-if="cliente">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-col">
                            <ULink
                                :to="`/clientes/${cliente.id}`"
                                class="text-lg font-semibold text-highlighted hover:text-primary"
                            >
                                {{ cliente.nombre }}
                            </ULink>
                            <span class="text-sm text-muted">
                                Cliente #{{ cliente.id }} · NIT {{ cliente.nit_cui ?? 'CF' }}<template v-if="cliente.telefono"> · {{ cliente.telefono }}</template>
                            </span>
                        </div>
                    </div>

                    <section
                        v-if="puede('clientes.estado_cuenta')"
                        class="flex flex-col gap-3"
                        aria-label="Pendiente de pago"
                    >
                        <ProblemaAlerta
                            v-if="problemaCuenta"
                            :problema="problemaCuenta"
                            :reintentar="cargarCuenta"
                            :reintentando="cargandoCuenta"
                        />
                        <div
                            v-else-if="!resumen"
                            class="grid gap-3 sm:grid-cols-2"
                        >
                            <USkeleton class="h-20" />
                            <USkeleton class="h-20" />
                        </div>
                        <template v-else>
                            <div class="grid gap-3 sm:grid-cols-2">
                                <UPageCard
                                    variant="subtle"
                                    :ui="{ container: 'gap-1 sm:p-4' }"
                                >
                                    <p class="text-xs font-medium text-muted">
                                        Vencido
                                    </p>
                                    <p
                                        class="text-2xl font-semibold tabular-nums"
                                        :class="resumen.vencido.gt(0) ? 'text-error' : 'text-highlighted'"
                                        data-prueba="vencido"
                                    >
                                        {{ formatearQuetzales(resumen.vencido) }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        {{ resumen.vencidas }} {{ resumen.vencidas === 1 ? 'aviso vencido' : 'avisos vencidos' }}
                                    </p>
                                </UPageCard>
                                <UPageCard
                                    variant="subtle"
                                    :ui="{ container: 'gap-1 sm:p-4' }"
                                >
                                    <p class="text-xs font-medium text-muted">
                                        Pendiente total
                                    </p>
                                    <p
                                        class="text-2xl font-semibold tabular-nums text-highlighted"
                                        data-prueba="pendiente"
                                    >
                                        {{ formatearQuetzales(resumen.pendiente) }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        {{ resumen.facturas.length }} {{ resumen.facturas.length === 1 ? 'aviso por pagar' : 'avisos por pagar' }}
                                    </p>
                                </UPageCard>
                            </div>

                            <p
                                v-if="saldoAFavor && saldoAFavor.gt(0)"
                                class="flex items-center gap-2 text-sm text-info"
                                data-prueba="saldo-a-favor"
                            >
                                <UIcon
                                    name="i-lucide-piggy-bank"
                                    class="size-4"
                                />
                                Saldo a favor {{ formatearQuetzales(saldoAFavor) }}: se aplica solo a los próximos avisos.
                            </p>

                            <div
                                v-if="resumen.facturas.length"
                                class="flex flex-col gap-1"
                            >
                                <p class="text-xs text-muted">
                                    Marca las facturas que paga; se aplican en este orden.
                                </p>
                                <CobroFacturasLista
                                    :facturas="resumen.facturas"
                                    :marcadas="marcadas"
                                    :servicios="nombresServicio"
                                    @marcar="marcar"
                                />
                            </div>
                            <p
                                v-else
                                class="flex items-center gap-2 text-sm text-success"
                            >
                                <UIcon
                                    name="i-lucide-badge-check"
                                    class="size-4"
                                />
                                No tiene avisos pendientes.
                            </p>

                            <!-- Pago de terceros: dependientes del pagador y otros clientes agregados. -->
                            <ProblemaAlerta
                                v-if="problemaDependientes"
                                :problema="problemaDependientes"
                                :reintentar="() => cargarDependientes(clienteId)"
                            />
                            <div
                                v-for="grupo in grupos"
                                :key="grupo.cliente.id"
                                class="flex flex-col gap-2 rounded-md border border-default bg-elevated/40 p-2"
                                :data-grupo="grupo.cliente.id"
                            >
                                <div class="flex items-center gap-2">
                                    <UCheckbox
                                        v-if="resumenGrupo(grupo)?.facturas.length"
                                        :model-value="estadoCasillaGrupo(grupo)"
                                        :aria-label="`Pagar todas las facturas de ${grupo.cliente.nombre}`"
                                        class="ps-1"
                                        @update:model-value="marcarGrupo(grupo, $event === true)"
                                    />
                                    <UButton
                                        :icon="grupo.abierto ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                                        color="neutral"
                                        variant="ghost"
                                        class="min-w-0 flex-1 justify-start text-start"
                                        :aria-expanded="grupo.abierto"
                                        @click="grupo.abierto = !grupo.abierto"
                                    >
                                        <span class="flex min-w-0 flex-col">
                                            <span class="truncate text-xs text-muted">
                                                {{ grupo.origen === 'dependiente' ? 'Responsable de pago de:' : 'Facturas de otro cliente:' }}
                                            </span>
                                            <span class="truncate font-medium text-highlighted">{{ grupo.cliente.nombre }}</span>
                                        </span>
                                    </UButton>
                                    <span
                                        v-if="resumenGrupo(grupo)"
                                        class="flex shrink-0 flex-col items-end text-xs"
                                    >
                                        <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(resumenGrupo(grupo)?.pendiente ?? null) }}</span>
                                        <span :class="resumenGrupo(grupo)?.vencidas ? 'text-error' : 'text-muted'">
                                            {{ resumenGrupo(grupo)?.facturas.length }} {{ resumenGrupo(grupo)?.facturas.length === 1 ? 'aviso' : 'avisos' }}<template v-if="resumenGrupo(grupo)?.vencidas"> · {{ resumenGrupo(grupo)?.vencidas }} {{ resumenGrupo(grupo)?.vencidas === 1 ? 'vencido' : 'vencidos' }}</template>
                                        </span>
                                    </span>
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
                                    <ProblemaAlerta
                                        v-if="grupo.problema"
                                        :problema="grupo.problema"
                                        :reintentar="() => cargarGrupo(grupo)"
                                        :reintentando="grupo.cargando"
                                    />
                                    <USkeleton
                                        v-else-if="!resumenGrupo(grupo)"
                                        class="h-12"
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
                                        class="px-2 text-sm text-success"
                                    >
                                        No tiene avisos pendientes.
                                    </p>
                                    <div
                                        v-if="serviciosDeGrupo(grupo).length"
                                        class="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-1"
                                    >
                                        <span
                                            v-for="servicio in serviciosDeGrupo(grupo)"
                                            :key="servicio.id"
                                            class="flex items-center gap-1 text-xs"
                                            :data-servicio="servicio.id"
                                        >
                                            <ULink
                                                :to="`/servicios/${servicio.id}`"
                                                class="font-mono text-highlighted hover:text-primary"
                                            >
                                                {{ etiquetaServicio(servicio) }}
                                            </ULink>
                                            <UBadge
                                                v-if="reactivados.has(servicio.id)"
                                                label="Servicio reactivado"
                                                icon="i-lucide-party-popper"
                                                color="success"
                                                variant="solid"
                                                size="sm"
                                            />
                                            <EstadoServicioBadge
                                                :estado="servicio.estado"
                                                size="sm"
                                            />
                                        </span>
                                    </div>
                                </template>
                            </div>

                            <div class="flex flex-col gap-2">
                                <UButton
                                    v-if="!agregando"
                                    label="Agregar facturas de otro cliente"
                                    icon="i-lucide-user-plus"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="self-start"
                                    @click="agregando = true"
                                />
                                <div
                                    v-else
                                    class="flex items-center gap-2"
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
                                <p
                                    v-if="totalMarcadas && marcadas.length && !pago"
                                    class="text-xs text-muted"
                                    data-prueba="total-marcadas"
                                >
                                    {{ marcadas.length }} {{ marcadas.length === 1 ? 'marcada' : 'marcadas' }} · {{ formatearQuetzales(totalMarcadas) }}<template v-if="marcadasDeTerceros.cuantas">
                                        · {{ marcadasDeTerceros.cuantas }} de otros clientes ({{ formatearQuetzales(marcadasDeTerceros.total) }})
                                    </template>
                                </p>
                                <div
                                    v-if="reparto.length > 1 && !pago"
                                    class="surface-card flex flex-col gap-2 p-3"
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
                                    <ul class="flex flex-col divide-y divide-default">
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
                            </div>
                        </template>
                    </section>

                    <section
                        v-if="puede('servicios.ver')"
                        class="flex flex-col gap-2"
                        aria-label="Servicios del cliente"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                Servicios
                            </h3>
                            <span
                                v-if="seguimiento.siguiendo.value"
                                class="flex items-center gap-1.5 text-xs text-muted"
                            >
                                <UIcon
                                    name="i-lucide-loader-circle"
                                    class="size-3.5 animate-spin"
                                />
                                Esperando la reactivación…
                            </span>
                        </div>
                        <ProblemaAlerta
                            v-if="problemaServicios"
                            :problema="problemaServicios"
                            :reintentar="cargarServicios"
                            :reintentando="cargandoServicios"
                        />
                        <div
                            v-else-if="cargandoServicios && !serviciosVista.length"
                            class="flex flex-col gap-2"
                        >
                            <USkeleton class="h-12" />
                        </div>
                        <p
                            v-else-if="!serviciosVista.length"
                            class="text-sm text-muted"
                        >
                            Sin servicios.
                        </p>
                        <ul
                            v-else
                            class="flex flex-col divide-y divide-default rounded-md border border-default"
                        >
                            <li
                                v-for="servicio in serviciosVista"
                                :key="servicio.id"
                                class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                :data-servicio="servicio.id"
                            >
                                <ULink
                                    :to="`/servicios/${servicio.id}`"
                                    class="font-mono text-sm text-highlighted hover:text-primary"
                                >
                                    {{ etiquetaServicio(servicio) }}
                                </ULink>
                                <div class="flex flex-wrap items-center gap-1">
                                    <UBadge
                                        v-if="reactivados.has(servicio.id)"
                                        label="Servicio reactivado"
                                        icon="i-lucide-party-popper"
                                        color="success"
                                        variant="solid"
                                        size="sm"
                                    />
                                    <EstadoServicioBadge
                                        :estado="servicio.estado"
                                        size="sm"
                                    />
                                    <SuspensionManualBadge
                                        :servicio="servicio"
                                        size="sm"
                                    />
                                </div>
                                <p
                                    v-if="pago && servicio.estado !== 'activo' && servicio.estado !== 'retirado' && seguimiento.motivos.value.get(servicio.id)"
                                    class="w-full text-xs text-muted"
                                    data-prueba="motivo-evaluacion"
                                >
                                    Sigue {{ ESTADOS_SERVICIO[servicio.estado].etiqueta.toLowerCase() }}: {{ seguimiento.motivos.value.get(servicio.id) }}
                                </p>
                            </li>
                        </ul>
                        <UAlert
                            v-if="seguimiento.agotado.value"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-clock-alert"
                            title="El servicio no se ha reactivado"
                            description="Pasaron 30 segundos. Puede que aún deba avisos vencidos o que la reactivación siga en cola; revisa la ficha del servicio."
                        />
                        <ProblemaAlerta
                            v-else-if="seguimiento.problema.value"
                            :problema="seguimiento.problema.value"
                        />
                    </section>
                </template>
            </div>

            <div
                v-if="cliente && pago"
                class="flex flex-col gap-3"
            >
                <section
                    v-if="cobroRepartido"
                    class="surface-card flex flex-col gap-2 p-4"
                    aria-label="Pagos por empresa"
                    data-prueba="pagos-por-empresa"
                >
                    <p class="text-sm text-muted">
                        El cobro se repartió en un pago por empresa; cada uno va a la caja de su empresa.
                    </p>
                    <ul class="flex flex-col gap-1 text-sm">
                        <li
                            v-for="parte in pagosDelCobro"
                            :key="parte.id"
                            class="flex justify-between gap-3"
                        >
                            <span>
                                <span class="font-medium text-highlighted">{{ nombreDeEmpresa(parte.empresa_id) }}</span>
                                <span class="text-muted"> · Pago #{{ parte.id }}</span>
                            </span>
                            <span class="tabular-nums">{{ formatearQuetzales(parte.monto) }}</span>
                        </li>
                    </ul>
                    <p class="flex justify-between gap-3 font-semibold text-highlighted">
                        <span>Total cobrado</span>
                        <span class="tabular-nums">{{ formatearQuetzales(totalCobrado) }}</span>
                    </p>
                </section>
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
                <div class="flex flex-wrap gap-2">
                    <UButton
                        label="Imprimir"
                        icon="i-lucide-printer"
                        @click="imprimir"
                    />
                    <UButton
                        label="Nuevo cobro"
                        icon="i-lucide-rotate-ccw"
                        color="neutral"
                        variant="outline"
                        @click="nuevoCobro"
                    />
                </div>
            </div>

            <UPageCard
                v-else-if="cliente"
                title="Registrar pago"
                icon="i-lucide-banknote"
                variant="outline"
                class="lg:sticky lg:top-0"
            >
                <UForm
                    ref="formulario"
                    :schema="esquemaCobro"
                    :state="estado"
                    :validate-on="['input']"
                    class="flex flex-col gap-4"
                    @submit="registrar"
                >
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                        :help="ayudaMonto"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            autocomplete="off"
                            placeholder="0.00"
                            size="xl"
                            class="w-full"
                            :ui="{ base: 'text-lg tabular-nums' }"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>

                    <div
                        v-if="distribucion"
                        class="-mt-2 flex flex-col gap-1 text-xs"
                        data-prueba="distribucion"
                    >
                        <p
                            v-if="distribucion.parcial"
                            class="text-warning"
                            data-prueba="aviso-parcial"
                        >
                            No alcanza para las marcadas: el aviso #{{ distribucion.parcial.factura.id }} quedará parcial
                            ({{ formatearQuetzales(distribucion.parcial.aplicado) }} de {{ formatearQuetzales(saldoFactura(distribucion.parcial.factura)) }}).
                        </p>
                        <p
                            v-if="distribucion.sinCubrir.length"
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
                    <p
                        v-else-if="restante && restante.gt(0) && resumen && !resumen.pendiente.isZero()"
                        class="-mt-2 text-xs text-muted"
                    >
                        Quedará debiendo {{ formatearQuetzales(restante) }}.
                    </p>

                    <UFormField
                        label="Método"
                        name="metodo"
                        required
                    >
                        <USelect
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            class="w-full"
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

                    <UFormField
                        v-if="estado.metodo === 'caja'"
                        label="Caja"
                        name="caja_id"
                        hint="Opcional"
                        :help="estado.caja_id === null ? 'Sin elegir, el efectivo entra a la caja principal.' : undefined"
                    >
                        <USelect
                            v-if="cajasActivas.length"
                            v-model="cajaElegida"
                            :items="itemsCaja"
                            icon="i-lucide-archive"
                            class="w-full"
                        />
                        <p
                            v-else-if="!problemaCajas"
                            class="text-sm text-muted"
                        >
                            Caja principal
                        </p>
                        <!-- Sin la lista de cajas igual se cobra (va a la principal): aviso breve, no bloqueo. -->
                        <div
                            v-if="problemaCajas"
                            class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                            data-prueba="cajas-sin-lista"
                        >
                            <span class="flex items-center gap-1.5 text-muted">
                                <UIcon
                                    name="i-lucide-triangle-alert"
                                    class="size-4 shrink-0 text-warning"
                                />
                                Caja principal · no se pudo leer la lista de cajas ({{ problemaCajas.status }})
                            </span>
                            <UButton
                                label="Reintentar"
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="link"
                                size="xs"
                                @click="cargarCajas"
                            />
                        </div>
                    </UFormField>

                    <UFormField
                        v-if="pideDato(estado.metodo, 'banco_origen_id')"
                        label="Banco de origen"
                        name="banco_origen_id"
                        required
                        description="Banco desde el que el cliente envió el dinero"
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

                    <UFormField
                        v-if="pideDato(estado.metodo, 'cuenta_bancaria_id')"
                        label="Cuenta de destino"
                        name="cuenta_bancaria_id"
                        required
                        description="Cuenta propia donde entró el dinero (activas, en quetzales)"
                    >
                        <USelect
                            v-if="cuentasDestino.length"
                            v-model="cuentaDestino"
                            :items="itemsCuenta"
                            placeholder="Elegir cuenta…"
                            icon="i-lucide-wallet-cards"
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
                        :label="etiquetaReferencia(estado.metodo)"
                        name="referencia"
                        :required="pideDato(estado.metodo, 'referencia')"
                        :hint="pideDato(estado.metodo, 'referencia') ? undefined : 'Opcional'"
                    >
                        <UInput
                            v-model="estado.referencia"
                            autocomplete="off"
                            :placeholder="estado.metodo === 'remesa' ? 'Código que dio la remesadora' : 'Tal como aparece en el comprobante'"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
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

                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            type="submit"
                            label="Registrar pago"
                            icon="i-lucide-check"
                            size="lg"
                            :loading="enviando"
                            class="glow-brand grow justify-center sm:grow-0"
                        />
                        <UButton
                            label="Limpiar"
                            color="neutral"
                            variant="ghost"
                            :disabled="enviando"
                            @click="limpiarFormulario"
                        />
                        <span class="hidden text-xs text-muted sm:inline">
                            <UKbd value="Enter" /> registra · <UKbd value="Esc" /> limpia
                        </span>
                    </div>
                </UForm>
            </UPageCard>
        </div>
        <CajaAperturaModal
            v-if="puede('cajas.abrir')"
            v-model:open="aperturaAbierta"
            :caja="aperturaOpciones.length === 1 ? aperturaOpciones[0] : null"
            :opciones="aperturaOpciones"
            @hecho="alAbrirCaja"
        />
    </PanelPagina>
</template>
