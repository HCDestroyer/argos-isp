<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cajas y efectivo (tablero PlanCajas y PlanCajasMovil; plan de contabilidad §5.7, lotes B1 y B9):
 * dónde está cada quetzal en efectivo y quién lo tiene. Cuatro indicadores (cajas de cobros,
 * custodia, caja chica y en camino al banco) y tres pestañas en la misma tarjeta:
 * - Camino del efectivo: el mapa caja de cobros → custodia → banco y caja chica → gasto, y los
 *   movimientos (entrega, depósito, gasto y reposición) con su número y estado;
 * - Caja chica: efectivo + comprobantes = fondo fijo, gastos sin reponer, gasto, reponer y contar;
 * - Custodia y depósitos: quién tiene el efectivo, desde cuándo y si pasa del plazo o del tope;
 *   recibir una entrega («Recibí» / «No lo recibí») y depositar.
 * En el teléfono las pestañas son Efectivo, Caja chica y Recibir, con su acción fija abajo.
 * Nada se calcula sobre lo que no se pudo leer: cada indicador muestra su error con «Reintentar».
 */
definePageMeta({ permiso: 'cajas.ver' })

useHead({ title: 'Cajas y efectivo · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const miCaja = useMiCaja()

type Vista = 'camino' | 'chica' | 'custodia'
const vista = computed<Vista>({
    get: () => (['chica', 'custodia'].includes(String(route.query.vista)) ? route.query.vista as Vista : 'camino'),
    set: (valor) => {
        void router.replace({ query: { ...route.query, vista: valor === 'camino' ? undefined : valor } })
    },
})

/** Teléfono (bajo 1024 px): pestañas cortas del tablero PlanCajasMovil y la acción fija abajo. */
const telefono = ref(false)
let consulta: MediaQueryList | null = null
function medir() {
    telefono.value = !(consulta?.matches ?? true)
}
onMounted(() => {
    consulta = window.matchMedia('(min-width: 1024px)')
    medir()
    consulta.addEventListener('change', medir)
})
onBeforeUnmount(() => consulta?.removeEventListener('change', medir))

// ── Datos ──────────────────────────────────────────────────────────────────────────────────
const cajas = shallowRef<Caja[] | null>(null)
const problemaCajas = ref<Problem | null>(null)
const resumenes = shallowRef<Map<number, ResumenTurnoCaja | Problem>>(new Map())

const custodia = shallowRef<CustodiaEfectivo | null>(null)
const problemaCustodia = ref<Problem | null>(null)

const entregas = shallowRef<EntregaCaja[]>([])
const problemaEntregas = ref<Problem | null>(null)

const leeDepositos = computed(() => puede('bancos.ver'))
const depositos = shallowRef<Deposito[] | null>(null)
const problemaDepositos = ref<Problem | null>(null)

const estadosChica = shallowRef<Map<number, EstadoCajaChica | Problem>>(new Map())
const gastos = shallowRef<Map<number, Egreso[]>>(new Map())
const problemaGastos = ref<Problem | null>(null)
const cargandoGastos = ref(false)
const reposiciones = shallowRef<ReposicionCaja[]>([])

const cajasCobros = computed(() => (cajas.value ?? []).filter(c => c.activa && !esCajaChica(c)))
const cajasChicas = computed(() => (cajas.value ?? []).filter(c => c.activa && esCajaChica(c)))
const abiertas = computed(() => cajasCobros.value.filter(c => c.turno_abierto_id !== null))

const cajaChicaId = ref<number | undefined>(undefined)
const itemsCajaChica = computed(() => cajasChicas.value.map(c => ({ label: c.nombre, value: c.id })))
const estadoChica = computed(() => {
    const valor = cajaChicaId.value === undefined ? undefined : estadosChica.value.get(cajaChicaId.value)
    return valor && 'caja_id' in valor ? valor : null
})
const problemaChica = computed(() => {
    const valor = cajaChicaId.value === undefined ? undefined : estadosChica.value.get(cajaChicaId.value)
    return valor && !('caja_id' in valor) ? valor : null
})
const gastosChica = computed(() => (cajaChicaId.value === undefined ? [] : gastos.value.get(cajaChicaId.value) ?? []))

async function cargarCajas() {
    problemaCajas.value = null
    const resultado = await useCajas().listar()
    cajas.value = resultado.ok ? resultado.data : null
    problemaCajas.value = resultado.ok ? null : resultado.problema
    if (!resultado.ok) {
        return
    }
    if (cajaChicaId.value === undefined || !cajasChicas.value.some(c => c.id === cajaChicaId.value)) {
        cajaChicaId.value = cajasChicas.value.find(c => c.cajero_id === usuario.value?.id)?.id ?? cajasChicas.value[0]?.id
    }
    await Promise.all([cargarResumenes(), cargarCajasChicas()])
}

async function cargarResumenes() {
    const mapa = new Map<number, ResumenTurnoCaja | Problem>()
    await Promise.all(abiertas.value.map(async (c) => {
        const resultado = await useCajas().resumen(c.id)
        mapa.set(c.id, resultado.ok ? resultado.data : resultado.problema)
    }))
    resumenes.value = mapa
}

async function cargarCajasChicas() {
    const mapa = new Map<number, EstadoCajaChica | Problem>()
    const leidas = new Map<number, Egreso[]>()
    const repuestas: ReposicionCaja[] = []
    let fallo: Problem | null = null
    cargandoGastos.value = true
    await Promise.all(cajasChicas.value.map(async (c) => {
        const [estado, lista, reps] = await Promise.all([
            useCajaChica().estado(c.id),
            useEgresos().listar({ caja_id: c.id, estado: 'registrado', limit: 100 }),
            useCajaChica().reposiciones(c.id),
        ])
        mapa.set(c.id, estado.ok ? estado.data : estado.problema)
        if (lista.ok) {
            leidas.set(c.id, lista.data.data)
        }
        else {
            fallo = lista.problema
        }
        if (reps.ok) {
            repuestas.push(...reps.data.data)
        }
    }))
    cargandoGastos.value = false
    estadosChica.value = mapa
    gastos.value = leidas
    reposiciones.value = repuestas
    problemaGastos.value = fallo
}

async function cargarCustodia() {
    problemaCustodia.value = null
    const resultado = await useCustodia().resumen()
    custodia.value = resultado.ok ? resultado.data : null
    problemaCustodia.value = resultado.ok ? null : resultado.problema
}

async function cargarEntregas() {
    problemaEntregas.value = null
    const resultado = await useCustodia().entregas()
    entregas.value = resultado.ok ? resultado.data.data : []
    problemaEntregas.value = resultado.ok ? null : resultado.problema
}

async function cargarDepositos() {
    if (!leeDepositos.value) {
        return
    }
    problemaDepositos.value = null
    const resultado = await useFondosEnTransito().depositos(undefined, undefined, 100)
    depositos.value = resultado.ok ? resultado.data.data : null
    problemaDepositos.value = resultado.ok ? null : resultado.problema
}

function cargarTodo() {
    void cargarCajas()
    void cargarCustodia()
    void cargarEntregas()
    void cargarDepositos()
}

onMounted(() => {
    cargarTodo()
    void miCaja.cargar()
})

// ── Indicadores ────────────────────────────────────────────────────────────────────────────
/** Efectivo en las cajas de cobros abiertas: solo con todos los resúmenes leídos. */
const enCobros = computed<Decimal | null>(() => {
    if (!cajas.value) {
        return null
    }
    const leidos = abiertas.value.map(c => resumenes.value.get(c.id))
    if (leidos.some(r => !r || !('turno_id' in r))) {
        return null
    }
    return leidos.reduce((suma, r) => suma.plus(r && 'turno_id' in r ? r.esperado : '0'), new Decimal(0))
})
const problemaCobros = computed(() => {
    if (problemaCajas.value) {
        return problemaCajas.value
    }
    for (const valor of resumenes.value.values()) {
        if (!('turno_id' in valor)) {
            return valor
        }
    }
    return null
})

const personasConSaldo = computed(() => (custodia.value?.personas ?? []).filter(p => new Decimal(p.saldo).gt(0)))
const custodiaFueraDePlazo = computed(() => personasConSaldo.value.some(p => p.fuera_de_plazo || p.sobre_tope))

const enCajaChica = computed<{ efectivo: Decimal, fondo: Decimal, cuadra: boolean } | null>(() => {
    if (!cajas.value || cajasChicas.value.some(c => !estadosChica.value.has(c.id))) {
        return null
    }
    const estados = [...estadosChica.value.values()]
    if (estados.some(e => !('caja_id' in e))) {
        return null
    }
    const leidos = estados.filter((e): e is EstadoCajaChica => 'caja_id' in e)
    return {
        efectivo: sumaMontos(leidos.map(e => e.efectivo)),
        fondo: sumaMontos(leidos.map(e => e.fondo_fijo)),
        cuadra: leidos.every(e => e.cuadra),
    }
})
const problemaCajaChicaIndicador = computed(() => problemaCajas.value ?? [...estadosChica.value.values()].find((e): e is Problem => !('caja_id' in e)) ?? null)

const enCamino = computed(() => {
    if (!depositos.value) {
        return null
    }
    const pendientes = depositos.value.filter(d => d.estado === 'en_transito')
    return { monto: sumaMontos(pendientes.map(d => d.monto)), cantidad: pendientes.length }
})

/** «Efectivo fuera del banco»: solo si se leyeron las cuatro partes. */
const fueraDelBanco = computed(() => {
    if (enCobros.value === null || !custodia.value || !enCajaChica.value || !enCamino.value) {
        return null
    }
    return enCobros.value.plus(custodia.value.total).plus(enCajaChica.value.efectivo).plus(enCamino.value.monto)
})

/** Días de la custodia más vieja aún sin depositar (la pastilla del nodo Custodia). */
const custodiaMasVieja = computed(() => {
    const fechas = personasConSaldo.value.map(p => p.desde).filter((d): d is string => Boolean(d)).sort()
    return fechas[0] ? diasDesde(fechas[0]) : null
})

/** Gastos de la caja chica del mes en curso (en hora de Guatemala), repuestos o no. */
const gastosDelMes = computed(() => {
    const mes = hoyGuatemala().slice(0, 7)
    return [...gastos.value.values()].flat().filter(g => g.fecha.slice(0, 7) === mes)
})

/** Teléfono (tablero PlanCajasMovil): los cuatro lugares en una lista, cada uno con su error. */
const lugaresMovil = computed(() => [
    { id: 'cobros', titulo: 'Cajas de cobros', icono: 'i-lucide-banknote', tono: 'tono-exito', valor: enCobros.value ? formatearQuetzales(enCobros.value) : '—', detalle: `${abiertas.value.length} ${abiertas.value.length === 1 ? 'turno abierto' : 'turnos abiertos'}`, aviso: null, problema: problemaCobros.value, reintentar: cargarCajas },
    { id: 'custodia', titulo: 'Custodia', icono: 'i-lucide-shield-check', tono: 'tono-aviso', valor: custodia.value ? formatearQuetzales(custodia.value.total) : '—', detalle: [personasConSaldo.value.map(p => p.usuario_nombre?.split(' ')[0] ?? 'Sin nombre').join(' y '), custodiaMasVieja.value ? `${custodiaMasVieja.value} ${custodiaMasVieja.value === 1 ? 'día' : 'días'}` : ''].filter(Boolean).join(' · ') || 'Nadie', aviso: custodiaFueraDePlazo.value ? 'Depositar' : null, problema: problemaCustodia.value, reintentar: cargarCustodia },
    { id: 'chica', titulo: 'Caja chica', icono: 'i-lucide-wallet', tono: 'tono-1', valor: enCajaChica.value ? formatearQuetzales(enCajaChica.value.efectivo) : '—', detalle: enCajaChica.value ? `de ${formatearQuetzales(enCajaChica.value.fondo)}` : 'Sin caja chica', aviso: enCajaChica.value && !enCajaChica.value.cuadra ? 'No cuadra' : null, problema: problemaCajaChicaIndicador.value, reintentar: cargarCajas },
    { id: 'camino', titulo: 'En camino al banco', icono: 'i-lucide-landmark', tono: 'tono-marca', valor: enCamino.value ? formatearQuetzales(enCamino.value.monto) : '—', detalle: enCamino.value ? `${enCamino.value.cantidad} ${enCamino.value.cantidad === 1 ? 'depósito' : 'depósitos'}` : (leeDepositos.value ? '' : 'Sin acceso'), aviso: null, problema: problemaDepositos.value, reintentar: cargarDepositos },
])

// ── Movimientos ────────────────────────────────────────────────────────────────────────────
const gastosTodos = computed(() => [...gastos.value.values()].flat())
const movimientos = computed(() => movimientosEfectivo({
    entregas: entregas.value,
    depositos: depositos.value ?? [],
    gastos: gastosTodos.value,
    reposiciones: reposiciones.value,
}, usuario.value?.id ?? null).slice(0, 50))

const columnasMovimientos: TableColumn<MovimientoEfectivo>[] = [
    { id: 'numero', header: 'N.º', meta: { class: { th: 'w-18', td: 'w-18' } } },
    { id: 'tipo', header: 'Qué', meta: { class: { th: 'w-32', td: 'w-32' } } },
    { id: 'trayecto', header: 'De dónde a dónde' },
    { id: 'cuando', header: 'Cuándo', meta: { class: { th: 'w-44 max-xl:hidden', td: 'w-44 max-xl:hidden' } } },
    { id: 'monto', header: 'Monto', meta: { class: { th: 'w-28 text-end', td: 'w-28 text-end' } } },
    { id: 'estado', header: 'Estado', meta: { class: { th: 'w-52', td: 'w-52' } } },
    { id: 'accion', header: '', meta: { class: { th: 'w-28', td: 'w-28 text-end' } } },
]

// ── Custodia ───────────────────────────────────────────────────────────────────────────────
const yo = computed(() => usuario.value?.id ?? null)
const miCustodia = computed(() => custodia.value?.personas.find(p => p.usuario_id === yo.value) ?? null)
const saldoMio = computed(() => (miCustodia.value ? new Decimal(miCustodia.value.saldo) : null))
const porRecibirMias = computed(() => entregas.value.filter(e => e.estado === 'por_recibir' && e.recibe_id === yo.value))
const porRecibirTodas = computed(() => entregas.value.filter(e => e.estado === 'por_recibir'))

function estadoPersona(persona: PersonaCustodia): EstadoMovimiento {
    if (persona.fuera_de_plazo) {
        const plazo = custodia.value?.ajustes.custodia_plazo_dias ?? 1
        return { etiqueta: `Pasa del plazo (${plazo} ${plazo === 1 ? 'día' : 'días'})`, color: 'warning', icono: 'i-lucide-clock' }
    }
    if (persona.sobre_tope) {
        return { etiqueta: 'Sobre el tope', color: 'warning', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: 'En plazo', color: 'success', icono: 'i-lucide-check' }
}

function detallePersona(persona: PersonaCustodia): string {
    const partes = [persona.desde ? `desde ${formatearFechaCorta(persona.desde)}` : null, persona.vence ? `depositar a más tardar ${formatearFechaCorta(persona.vence)}` : null]
    if (persona.por_recibir.cantidad) {
        partes.push(`${persona.por_recibir.cantidad} por recibir (${formatearQuetzales(persona.por_recibir.monto)})`)
    }
    return partes.filter(Boolean).join(' · ') || 'Sin efectivo pendiente'
}

// ── Ventanas ───────────────────────────────────────────────────────────────────────────────
const entregaElegida = shallowRef<EntregaCaja | null>(null)
const recibirAbierto = ref(false)
const depositarAbierto = ref(false)
const gastoAbierto = ref(false)
const reponerAbierto = ref(false)
const contarAbierto = ref(false)
const cierreAbierto = ref(false)

function abrirRecibir(entregaId: number | null) {
    const elegida = entregas.value.find(e => e.id === entregaId) ?? porRecibirMias.value[0]
    if (!elegida) {
        return
    }
    entregaElegida.value = elegida
    recibirAbierto.value = true
}

const puedeDepositar = computed(() => puede('cajas.depositar') && Boolean(saldoMio.value?.gt(0)))

function alRecibir() {
    void cargarEntregas()
    void cargarCustodia()
}

function alDepositar() {
    void cargarCustodia()
    void cargarDepositos()
}

function alCambiarCajaChica() {
    void cargarCajasChicas()
    void cargarCustodia()
}

const pestanas = computed<PestanaConta[]>(() => [
    { label: telefono.value ? 'Efectivo' : 'Camino del efectivo', value: 'camino', icon: telefono.value ? undefined : 'i-lucide-arrow-right' },
    { label: 'Caja chica', value: 'chica', icon: telefono.value ? undefined : 'i-lucide-wallet' },
    {
        label: telefono.value ? 'Recibir' : 'Custodia y depósitos',
        value: 'custodia',
        icon: telefono.value ? undefined : 'i-lucide-shield-check',
        contador: porRecibirMias.value.length || (telefono.value ? undefined : porRecibirTodas.value.length || undefined),
        tono: 'error',
    },
])
</script>

<template>
    <PanelPagina
        id="cajas-efectivo"
        titulo="Cajas y efectivo"
        icono="i-lucide-wallet-cards"
        descripcion="Dónde está cada quetzal en efectivo y quién lo tiene"
    >
        <template #acciones>
            <UButton
                v-if="miCaja.abierta.value && puede('cajas.cerrar')"
                label="Cerrar mi turno"
                icon="i-lucide-banknote"
                color="neutral"
                variant="outline"
                class="rounded-full max-lg:hidden"
                data-prueba="cerrar-mi-turno"
                @click="cierreAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
            <div class="grid grid-cols-4 gap-2.5 max-lg:hidden">
                <ContaIndicador
                    clave="efectivo-cobros"
                    icono="i-lucide-banknote"
                    tono="tono-exito"
                    :valor="enCobros ? formatearQuetzales(enCobros) : null"
                    :detalle="`${abiertas.length} ${abiertas.length === 1 ? 'turno abierto' : 'turnos abiertos'}`"
                    :problema="problemaCobros"
                    data-indicador="cobros"
                    @reintentar="cargarCajas"
                />
                <ContaIndicador
                    clave="efectivo-custodia"
                    icono="i-lucide-shield-check"
                    tono="tono-aviso"
                    :valor="custodia ? formatearQuetzales(custodia.total) : null"
                    :estado="custodiaFueraDePlazo ? 'atencion' : undefined"
                    :etiqueta-estado="custodiaFueraDePlazo ? 'Depositar' : undefined"
                    :detalle="`${personasConSaldo.length} ${personasConSaldo.length === 1 ? 'persona' : 'personas'}`"
                    :problema="problemaCustodia"
                    data-indicador="custodia"
                    @reintentar="cargarCustodia"
                />
                <ContaIndicador
                    clave="efectivo-caja-chica"
                    icono="i-lucide-wallet"
                    tono="tono-1"
                    :valor="enCajaChica ? formatearQuetzales(enCajaChica.efectivo) : null"
                    :estado="enCajaChica ? (enCajaChica.cuadra ? 'bien' : 'urgente') : undefined"
                    :etiqueta-estado="enCajaChica ? (enCajaChica.cuadra ? 'Cuadra' : 'No cuadra') : undefined"
                    :detalle="enCajaChica ? `de ${formatearQuetzales(enCajaChica.fondo)}` : undefined"
                    :problema="problemaCajaChicaIndicador"
                    :sin-datos="cajas && !cajasChicas.length ? 'No hay cajas chicas en esta empresa' : undefined"
                    titulo-sin-datos="Sin caja chica"
                    data-indicador="caja-chica"
                    @reintentar="cargarCajas"
                />
                <ContaIndicador
                    clave="efectivo-camino-banco"
                    icono="i-lucide-landmark"
                    tono="tono-marca"
                    :valor="enCamino ? formatearQuetzales(enCamino.monto) : null"
                    :detalle="enCamino ? `${enCamino.cantidad} ${enCamino.cantidad === 1 ? 'depósito sin confirmar' : 'depósitos sin confirmar'}` : undefined"
                    :problema="problemaDepositos"
                    :sin-datos="leeDepositos ? undefined : 'Para verlo tu usuario necesita el permiso bancos.ver'"
                    titulo-sin-datos="Sin acceso"
                    data-indicador="camino"
                    @reintentar="cargarDepositos"
                />
            </div>

            <section class="surface-card flex flex-col rounded-2xl lg:min-h-0 lg:flex-1 lg:overflow-hidden">
                <div class="flex flex-wrap items-center gap-3 border-b border-(--ax-borde) p-3 sm:px-4">
                    <ContaPestanas
                        v-model="vista"
                        :items="pestanas"
                        etiqueta="Cajas y efectivo"
                        class="max-lg:w-full"
                    />
                    <span class="flex-1" />
                    <p
                        class="text-sm text-muted max-lg:hidden"
                        data-prueba="fuera-del-banco"
                    >
                        Efectivo fuera del banco:
                        <strong class="tabular-nums text-highlighted">{{ fueraDelBanco ? formatearQuetzales(fueraDelBanco) : '—' }}</strong>
                    </p>
                </div>

                <!-- Camino del efectivo -->
                <div
                    v-if="vista === 'camino'"
                    class="flex min-h-0 flex-1 flex-col"
                    data-prueba="vista-camino"
                >
                    <div class="flex flex-col gap-2.5 p-3 sm:p-4">
                        <div class="rounded-2xl border border-(--ax-borde) p-4 lg:hidden">
                            <p class="text-xs text-muted">
                                Efectivo fuera del banco
                            </p>
                            <p
                                class="text-2xl font-bold tabular-nums text-highlighted"
                                data-prueba="fuera-del-banco-movil"
                            >
                                {{ fueraDelBanco ? formatearQuetzales(fueraDelBanco) : '—' }}
                            </p>
                        </div>
                        <ul
                            class="divide-y divide-(--ax-borde) rounded-2xl border border-(--ax-borde) px-4 lg:hidden"
                            data-prueba="lugares-efectivo"
                        >
                            <li
                                v-for="lugar in lugaresMovil"
                                :key="lugar.id"
                                class="flex items-center gap-3 py-3"
                                :data-lugar="lugar.id"
                            >
                                <span
                                    class="pastilla-icono pastilla-tono size-8.5 shrink-0 rounded-xl"
                                    :class="lugar.tono"
                                >
                                    <UIcon
                                        :name="lugar.icono"
                                        class="size-4"
                                    />
                                </span>
                                <span class="min-w-0 flex-1">
                                    <span class="block text-sm font-semibold text-highlighted">{{ lugar.titulo }}</span>
                                    <span class="block truncate text-xs text-muted">{{ lugar.detalle }}</span>
                                </span>
                                <span class="text-end">
                                    <UButton
                                        v-if="lugar.problema"
                                        label="Reintentar"
                                        icon="i-lucide-refresh-cw"
                                        color="error"
                                        variant="link"
                                        size="xs"
                                        @click="lugar.reintentar()"
                                    />
                                    <span
                                        v-else
                                        class="block font-bold tabular-nums text-highlighted"
                                    >{{ lugar.valor }}</span>
                                    <span
                                        v-if="lugar.aviso"
                                        class="block text-xs text-warning"
                                    >{{ lugar.aviso }}</span>
                                </span>
                            </li>
                        </ul>
                        <p class="text-xs text-muted lg:hidden">
                            Camino: caja de cobros, custodia, banco. La caja chica se repone por lo gastado.
                        </p>
                        <div class="flex flex-col items-stretch gap-2 max-lg:hidden lg:flex-row">
                            <CajaEfectivoNodo
                                icono="i-lucide-banknote"
                                tono="tono-exito"
                                titulo="Cajas de cobros"
                                :valor="enCobros ? formatearQuetzales(enCobros) : '—'"
                                :detalle="`${abiertas.length} ${abiertas.length === 1 ? 'turno abierto' : 'turnos abiertos'} · solo entra dinero de clientes`"
                            />
                            <CajaEfectivoFlecha
                                camino="Entrega"
                                cuando="al cerrar el turno"
                            />
                            <CajaEfectivoNodo
                                icono="i-lucide-shield-check"
                                tono="tono-aviso"
                                titulo="Custodia"
                                :valor="custodia ? formatearQuetzales(custodia.total) : '—'"
                                :detalle="personasConSaldo.map(p => `${p.usuario_nombre ?? 'Sin nombre'} ${formatearQuetzales(p.saldo)}`).join(' · ') || 'Nadie tiene efectivo en custodia'"
                                :aviso="custodiaMasVieja !== null && custodiaFueraDePlazo ? `${custodiaMasVieja} ${custodiaMasVieja === 1 ? 'día' : 'días'}` : undefined"
                            />
                            <CajaEfectivoFlecha
                                camino="Depósito"
                                cuando="con boleta"
                            />
                            <CajaEfectivoNodo
                                icono="i-lucide-landmark"
                                tono="tono-marca"
                                titulo="Banco"
                                :valor="enCamino ? formatearQuetzales(enCamino.monto) : '—'"
                                :detalle="enCamino ? 'en camino · el banco aún no lo muestra' : (leeDepositos ? 'No se pudieron leer los depósitos' : 'Sin acceso a los depósitos')"
                            />
                        </div>
                        <div class="flex flex-col items-stretch gap-2 max-lg:hidden lg:flex-row">
                            <CajaEfectivoNodo
                                icono="i-lucide-wallet"
                                tono="tono-1"
                                titulo="Caja chica"
                                :valor="enCajaChica ? formatearQuetzales(enCajaChica.efectivo) : '—'"
                                :detalle="enCajaChica ? `de un fondo fijo de ${formatearQuetzales(enCajaChica.fondo)} · ${formatearQuetzales(enCajaChica.fondo.minus(enCajaChica.efectivo))} en comprobantes` : 'Sin datos de la caja chica'"
                                :bien="enCajaChica?.cuadra ? 'Cuadra' : undefined"
                            />
                            <CajaEfectivoFlecha
                                camino="Gasto"
                                cuando="con comprobante"
                            />
                            <CajaEfectivoNodo
                                icono="i-lucide-file-text"
                                tono="tono-neutro"
                                titulo="Gastos del mes"
                                :valor="formatearQuetzales(sumaMontos(gastosDelMes.map(g => g.monto)))"
                                :detalle="`${gastosDelMes.length} ${gastosDelMes.length === 1 ? 'comprobante' : 'comprobantes'} · sin tope por gasto`"
                            />
                            <span
                                class="hidden lg:block lg:w-28 lg:shrink-0"
                                aria-hidden="true"
                            />
                            <div class="flex flex-1 flex-col gap-1.5 rounded-2xl border-[1.5px] border-dashed border-(--ax-borde) p-3">
                                <p class="text-sm font-semibold text-highlighted">
                                    La caja chica se repone
                                </p>
                                <p class="text-xs text-muted">
                                    desde la custodia o el banco, <strong>por lo gastado</strong>; nunca desde una caja de cobros.
                                </p>
                                <UButton
                                    v-if="estadoChica && puede('caja_chica.reponer')"
                                    :label="`Reponer ${formatearQuetzales(estadoChica.por_reponer)}`"
                                    icon="i-lucide-refresh-cw"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="self-start rounded-full"
                                    :disabled="Number(estadoChica.por_reponer) <= 0"
                                    @click="reponerAbierto = true"
                                />
                            </div>
                        </div>
                    </div>

                    <ProblemaAlerta
                        v-if="problemaEntregas"
                        class="mx-3"
                        :problema="problemaEntregas"
                        :reintentar="cargarEntregas"
                    />
                    <UTable
                        v-else
                        :data="movimientos"
                        :columns="columnasMovimientos"
                        sticky
                        class="min-h-0 flex-1 max-lg:hidden"
                        :ui="{ base: 'table-fixed', thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs uppercase', td: 'py-2.5' }"
                        data-prueba="tabla-movimientos"
                    >
                        <template #numero-cell="{ row }">
                            <span class="font-mono text-sm">{{ row.original.numero }}</span>
                        </template>
                        <template #tipo-cell="{ row }">
                            <UBadge
                                :label="TIPOS_MOVIMIENTO[row.original.tipo].etiqueta"
                                :icon="TIPOS_MOVIMIENTO[row.original.tipo].icono"
                                color="neutral"
                                variant="soft"
                                class="rounded-full"
                            />
                        </template>
                        <template #trayecto-cell="{ row }">
                            <span class="flex min-w-0 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ row.original.trayecto }}</span>
                                <span class="truncate text-xs text-muted xl:hidden">{{ cuandoEfectivo(row.original.cuando) }}{{ row.original.detalle ? ` · ${row.original.detalle}` : '' }}</span>
                            </span>
                        </template>
                        <template #cuando-cell="{ row }">
                            <span class="text-sm text-muted">{{ cuandoEfectivo(row.original.cuando) }}{{ row.original.detalle ? ` · ${row.original.detalle}` : '' }}</span>
                        </template>
                        <template #monto-cell="{ row }">
                            <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="row.original.estado.etiqueta"
                                :icon="row.original.estado.icono"
                                :color="row.original.estado.color"
                                variant="soft"
                                class="rounded-full"
                            />
                        </template>
                        <template #accion-cell="{ row }">
                            <UButton
                                v-if="row.original.accion === 'recibir' && puede('cajas.recibir_entrega')"
                                label="Recibir"
                                size="sm"
                                class="rounded-full"
                                :data-prueba="`recibir-${row.original.entregaId}`"
                                @click="abrirRecibir(row.original.entregaId)"
                            />
                            <UButton
                                v-else-if="row.original.accion === 'depositar' && puedeDepositar"
                                label="Depositar"
                                size="sm"
                                color="neutral"
                                variant="outline"
                                class="rounded-full"
                                @click="depositarAbierto = true"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-arrow-right-left"
                                title="Sin movimientos de efectivo"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <p class="flex items-center gap-2 border-t border-(--ax-borde) px-4 py-3 text-xs text-muted max-lg:hidden">
                        <UIcon
                            name="i-lucide-info"
                            class="size-4 shrink-0"
                        />
                        El efectivo solo se mueve por estos cuatro caminos. Cada uno tiene número, quién entrega, quién recibe y su movimiento en el libro.
                    </p>
                </div>

                <!-- Caja chica -->
                <div
                    v-else-if="vista === 'chica'"
                    class="flex min-h-0 flex-1 flex-col"
                    data-prueba="vista-chica"
                >
                    <div
                        v-if="itemsCajaChica.length > 1"
                        class="px-3 pt-3 sm:px-4"
                    >
                        <USelect
                            v-model="cajaChicaId"
                            :items="itemsCajaChica"
                            aria-label="Caja chica"
                            class="w-full sm:w-64"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaCajas"
                        class="m-3"
                        :problema="problemaCajas"
                        :reintentar="cargarCajas"
                    />
                    <UEmpty
                        v-else-if="cajas && !cajasChicas.length"
                        icon="i-lucide-wallet"
                        title="No hay cajas chicas"
                        description="Crea una caja de tipo «gastos» con su fondo fijo para registrar gastos con comprobante."
                        class="m-6"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaChica"
                        class="m-3"
                        :problema="problemaChica"
                        :reintentar="cargarCajasChicas"
                    />
                    <USkeleton
                        v-else-if="!estadoChica"
                        class="m-4 h-40"
                    />
                    <CajaChicaPanel
                        v-else
                        :estado="estadoChica"
                        :gastos="gastosChica"
                        :problema-gastos="problemaGastos"
                        :cargando-gastos="cargandoGastos"
                        @gasto="gastoAbierto = true"
                        @reponer="reponerAbierto = true"
                        @contar="contarAbierto = true"
                        @recargar-gastos="cargarCajasChicas"
                    />
                </div>

                <!-- Custodia y depósitos -->
                <div
                    v-else
                    class="flex min-h-0 flex-1 flex-col"
                    data-prueba="vista-custodia"
                >
                    <div
                        v-for="entrega in porRecibirMias"
                        :key="entrega.id"
                        class="mx-3 mt-3 rounded-2xl border border-warning/30 bg-warning/5 p-4 sm:mx-4 lg:hidden"
                        data-prueba="entrega-por-recibir"
                    >
                        <p class="text-sm text-muted">
                            Entrega {{ numeroMovimiento('E', entrega.id) }} · {{ entrega.entregado_por_nombre ?? 'El cajero' }} ({{ entrega.caja_nombre }}) te entrega
                        </p>
                        <p class="mt-1 text-3xl font-bold tabular-nums text-highlighted">
                            {{ formatearQuetzales(entrega.monto) }}
                        </p>
                    </div>
                    <p class="mx-3 mt-3 flex items-start gap-2 rounded-xl bg-info/10 px-3 py-2.5 text-sm text-info sm:mx-4">
                        <UIcon
                            name="i-lucide-shield-check"
                            class="mt-0.5 size-4 shrink-0"
                        />
                        <span><strong>Custodia</strong> es el efectivo que ya salió de una caja y todavía no llega al banco. Siempre está a nombre de una persona, desde que dice «Recibí» hasta que registra el depósito.</span>
                    </p>
                    <ProblemaAlerta
                        v-if="problemaCustodia"
                        class="m-3"
                        :problema="problemaCustodia"
                        :reintentar="cargarCustodia"
                    />
                    <USkeleton
                        v-else-if="!custodia"
                        class="m-4 h-32"
                    />
                    <div
                        v-if="custodia && !problemaCustodia"
                        class="mt-3 hidden grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.4fr)_12rem_8rem] gap-x-4 border-y border-(--ax-borde) bg-(--ax-cabecera-tabla) px-4 py-2 text-xs font-semibold text-muted uppercase lg:grid"
                        aria-hidden="true"
                    >
                        <span>Quién lo tiene</span><span class="text-end">Cuánto</span><span>De qué</span><span>Estado</span><span />
                    </div>
                    <ul
                        v-if="custodia && !problemaCustodia"
                        class="mt-3 min-h-0 flex-1 divide-y divide-(--ax-borde) overflow-y-auto border-t border-(--ax-borde) lg:mt-0 lg:border-t-0"
                        data-prueba="lista-custodia"
                    >
                        <li
                            v-for="persona in custodia.personas"
                            :key="`p-${persona.usuario_id}`"
                            class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.4fr)_12rem_8rem]"
                            :data-custodia="persona.usuario_id"
                        >
                            <span class="min-w-0">
                                <span class="block font-semibold text-highlighted">{{ persona.usuario_nombre ?? `Usuario ${persona.usuario_id}` }}{{ persona.usuario_id === yo ? ' (tú)' : '' }}</span>
                            </span>
                            <span class="text-end font-bold tabular-nums text-highlighted">{{ formatearQuetzales(persona.saldo) }}</span>
                            <span class="col-span-2 text-xs text-muted lg:col-span-1 lg:text-sm">{{ detallePersona(persona) }}</span>
                            <span>
                                <UBadge
                                    :label="estadoPersona(persona).etiqueta"
                                    :icon="estadoPersona(persona).icono"
                                    :color="estadoPersona(persona).color"
                                    variant="soft"
                                    class="rounded-full"
                                />
                            </span>
                            <span class="text-end">
                                <UButton
                                    v-if="persona.usuario_id === yo && puedeDepositar"
                                    label="Depositar"
                                    icon="i-lucide-landmark"
                                    size="sm"
                                    color="neutral"
                                    variant="outline"
                                    class="rounded-full max-lg:hidden"
                                    data-prueba="abrir-depositar"
                                    @click="depositarAbierto = true"
                                />
                            </span>
                        </li>
                        <li
                            v-for="entrega in porRecibirTodas"
                            :key="`e-${entrega.id}`"
                            class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_8rem_minmax(0,1.4fr)_12rem_8rem]"
                            :data-entrega="entrega.id"
                        >
                            <span class="min-w-0">
                                <span class="block font-semibold text-highlighted">{{ entrega.entregado_por_nombre ?? 'Cajero' }}</span>
                                <span class="block text-xs text-muted">{{ entrega.caja_nombre }}</span>
                            </span>
                            <span class="text-end font-bold tabular-nums text-highlighted">{{ formatearQuetzales(entrega.monto) }}</span>
                            <span class="col-span-2 text-xs text-muted lg:col-span-1 lg:text-sm">Entrega {{ numeroMovimiento('E', entrega.id) }}: {{ entrega.recibe_id === yo ? 'tú' : (entrega.recibe_nombre ?? 'quien recibe') }} aún no {{ entrega.recibe_id === yo ? 'dices' : 'dice' }} «Recibí»</span>
                            <span>
                                <UBadge
                                    label="Sigue a su nombre"
                                    icon="i-lucide-clock"
                                    color="info"
                                    variant="soft"
                                    class="rounded-full"
                                />
                            </span>
                            <span class="text-end">
                                <UButton
                                    v-if="entrega.recibe_id === yo && puede('cajas.recibir_entrega')"
                                    label="Recibir"
                                    size="sm"
                                    class="rounded-full max-lg:hidden"
                                    :data-prueba="`custodia-recibir-${entrega.id}`"
                                    @click="abrirRecibir(entrega.id)"
                                />
                            </span>
                        </li>
                        <li
                            v-if="!custodia.personas.length && !porRecibirTodas.length"
                            class="px-4 py-8"
                        >
                            <UEmpty
                                icon="i-lucide-shield-check"
                                title="Nadie tiene efectivo en custodia"
                                variant="naked"
                            />
                        </li>
                    </ul>
                    <p
                        v-if="custodia"
                        class="flex items-center gap-2 border-t border-(--ax-borde) px-4 py-3 text-xs text-muted"
                    >
                        <UIcon
                            name="i-lucide-info"
                            class="size-4 shrink-0"
                        />
                        Plazo para depositar: {{ custodia.ajustes.custodia_plazo_dias }} {{ custodia.ajustes.custodia_plazo_dias === 1 ? 'día hábil' : 'días hábiles' }}. Tope en custodia por persona: {{ formatearQuetzales(custodia.ajustes.custodia_tope) }}. Pasarse solo avisa.
                    </p>
                </div>
            </section>
        </div>

        <!-- Teléfono: la acción de cada pestaña fija abajo (tablero PlanCajasMovil). -->
        <div class="lg:hidden">
            <PanelBarraAccion
                v-if="vista === 'camino' && (puedeDepositar || (miCaja.abierta.value && puede('cajas.cerrar')))"
                estirar
            >
                <UButton
                    v-if="puedeDepositar"
                    label="Depositar"
                    icon="i-lucide-landmark"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="rounded-full"
                    @click="depositarAbierto = true"
                />
                <UButton
                    v-if="miCaja.abierta.value && puede('cajas.cerrar')"
                    label="Cerrar mi turno"
                    icon="i-lucide-banknote"
                    size="lg"
                    class="glow-brand justify-center rounded-full"
                    @click="cierreAbierto = true"
                />
            </PanelBarraAccion>
            <PanelBarraAccion
                v-else-if="vista === 'chica' && estadoChica && (puede('caja_chica.registrar_gasto') || puede('caja_chica.reponer'))"
                estirar
            >
                <UButton
                    v-if="puede('caja_chica.reponer')"
                    label="Reponer"
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="rounded-full"
                    :disabled="Number(estadoChica.por_reponer) <= 0"
                    data-prueba="movil-reponer"
                    @click="reponerAbierto = true"
                />
                <UButton
                    v-if="puede('caja_chica.registrar_gasto')"
                    label="Gasto con foto"
                    icon="i-lucide-image"
                    size="lg"
                    class="glow-brand justify-center rounded-full"
                    data-prueba="movil-gasto"
                    @click="gastoAbierto = true"
                />
            </PanelBarraAccion>
            <PanelBarraAccion
                v-else-if="vista === 'custodia' && porRecibirMias[0]"
                estirar
            >
                <UButton
                    v-if="puede('cajas.rechazar_entrega')"
                    label="No lo recibí"
                    color="error"
                    variant="outline"
                    size="lg"
                    class="rounded-full"
                    @click="abrirRecibir(porRecibirMias[0].id)"
                />
                <UButton
                    v-if="puede('cajas.recibir_entrega')"
                    :label="`Recibí ${formatearQuetzales(porRecibirMias[0].monto)}`"
                    icon="i-lucide-check"
                    size="lg"
                    class="glow-brand justify-center rounded-full"
                    data-prueba="movil-recibir"
                    @click="abrirRecibir(porRecibirMias[0].id)"
                />
            </PanelBarraAccion>
            <PanelBarraAccion
                v-else-if="vista === 'custodia' && puedeDepositar"
                estirar
            >
                <UButton
                    label="Depositar"
                    icon="i-lucide-landmark"
                    size="lg"
                    class="glow-brand justify-center rounded-full"
                    data-prueba="movil-depositar"
                    @click="depositarAbierto = true"
                />
            </PanelBarraAccion>
        </div>

        <CajaRecibirModal
            v-if="entregaElegida"
            v-model:open="recibirAbierto"
            :entrega="entregaElegida"
            @hecho="alRecibir"
        />
        <CajaDepositoCustodiaModal
            v-if="puede('cajas.depositar')"
            v-model:open="depositarAbierto"
            :saldo="saldoMio"
            @hecho="alDepositar"
        />
        <template v-if="estadoChica">
            <CajaChicaGastoModal
                v-if="puede('caja_chica.registrar_gasto')"
                v-model:open="gastoAbierto"
                :caja="estadoChica"
                @hecho="alCambiarCajaChica"
            />
            <CajaChicaReponerModal
                v-if="puede('caja_chica.reponer')"
                v-model:open="reponerAbierto"
                :caja="estadoChica"
                :custodia="saldoMio"
                @hecho="alCambiarCajaChica"
            />
            <CajaChicaContarModal
                v-if="puede('caja_chica.contar')"
                v-model:open="contarAbierto"
                :caja="estadoChica"
                @hecho="alCambiarCajaChica"
            />
        </template>
        <CajaCierreModal
            v-if="miCaja.abierta.value"
            v-model:open="cierreAbierto"
            :caja="miCaja.abierta.value"
            @hecho="cargarTodo"
        />
    </PanelPagina>
</template>
