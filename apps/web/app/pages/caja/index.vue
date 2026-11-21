<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cajas (tablero NuevoCajas): contadores del día, y en pestañas los cierres de todas las cajas
 * (con su cuadre, el efectivo contado y lo depositado del turno), los depósitos al banco con su
 * boleta y los retiros de efectivo. La caja propia se abre o se cierra desde aquí (acción
 * principal) o desde el icono de caja del encabezado; el cierre es la ventana en 3 pasos.
 */
definePageMeta({ permiso: 'cajas.ver' })

useHead({ title: 'Cajas · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const toast = useToast()
const miCaja = useMiCaja()
const impresion = useImpresionCaja()
const { conSelector: variasEmpresas, empresas: empresasUsuario } = useEmpresaActiva()

type Pestana = 'cierres' | 'depositos' | 'movimientos'
const pestana = computed<Pestana>({
    get: () => (['depositos', 'movimientos'].includes(String(route.query.vista)) ? route.query.vista as Pestana : 'cierres'),
    set: (valor) => {
        void router.replace({ query: { ...route.query, vista: valor === 'cierres' ? undefined : valor } })
    },
})

const cajas = shallowRef<Caja[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

/** Resumen del turno abierto de cada caja (lo que debe haber en efectivo). */
const resumenes = shallowRef<Map<number, ResumenTurnoCaja | Problem>>(new Map())

/** Cierres (turnos) de todas las cajas, del más reciente al más viejo. */
interface Cierre extends TurnoCaja {
    caja: Caja
}
const cierres = shallowRef<Cierre[]>([])
const cargandoCierres = ref(false)
const problemaCierres = ref<Problem | null>(null)

const depositos = shallowRef<Deposito[]>([])
const cargandoDepositos = ref(false)
const problemaDepositos = ref<Problem | null>(null)

const retiros = shallowRef<Egreso[]>([])
const cargandoRetiros = ref(false)
const problemaRetiros = ref<Problem | null>(null)

const cobradoHoy = shallowRef<{ monto: Decimal, cantidad: number } | null>(null)
const problemaCobrado = ref<Problem | null>(null)

const hoy = hoyGuatemala()
const meses = periodosRecientes(hoy, 12)
const mes = ref(meses[0] ?? hoy)
const itemsMes = meses.map(m => ({ label: etiquetaPeriodo(m).replace(/^./, c => c.toUpperCase()), value: m }))
const filtroCaja = ref<number | 'todas'>('todas')
const soloDiferencia = ref(false)

const itemsCaja = computed(() => [{ label: 'Todas las cajas', value: 'todas' as const }, ...cajas.value.map(c => ({ label: c.nombre, value: c.id }))])

function nombreEmpresa(id: number | undefined): string {
    return empresasUsuario.value.find(e => e.id === id)?.nombre_comercial ?? (id ? `Empresa ${id}` : '')
}

const abiertas = computed(() => cajas.value.filter(c => c.activa && c.turno_abierto_id !== null))
/** La caja del usuario: con turno abierto (para cerrar) o asignada y cerrada (para abrir). */
const propia = computed(() => miCaja.abierta.value ?? cajas.value.find(c => c.activa && c.cajero_id === usuario.value?.id) ?? null)

const resumenDe = (cajaId: number) => {
    const valor = resumenes.value.get(cajaId)
    return valor && 'turno_id' in valor ? valor : null
}

/** Efectivo en las cajas abiertas (lo que debe haber): solo con todos los resúmenes leídos. */
const efectivoEnCajas = computed<{ monto: Decimal, cajas: number } | null>(() => {
    if (!abiertas.value.length) {
        return { monto: new Decimal(0), cajas: 0 }
    }
    const leidos = abiertas.value.map(c => resumenDe(c.id))
    if (leidos.some(r => r === null)) {
        return null
    }
    return { monto: leidos.reduce((suma, r) => suma.plus(r?.esperado ?? '0'), new Decimal(0)), cajas: leidos.length }
})

const cierresMes = computed(() => cierres.value.filter(c => c.cerrado_en && fechaGuatemala(c.cerrado_en).slice(0, 7) === mes.value.slice(0, 7)))
const diferenciasMes = computed(() => {
    const con = cierresMes.value.filter(c => c.diferencia && !new Decimal(c.diferencia).isZero())
    return { monto: con.reduce((suma, c) => suma.plus(c.diferencia ?? '0'), new Decimal(0)), cierres: con.length }
})

const cierresFiltrados = computed(() => cierresMes.value
    .filter(c => filtroCaja.value === 'todas' || c.caja_id === filtroCaja.value)
    .filter(c => !soloDiferencia.value || (c.diferencia && !new Decimal(c.diferencia).isZero())))

/** Depósitos hechos durante cada turno (`Deposito.turno_id`). */
function depositosDe(turnoId: number): Deposito[] {
    return depositos.value.filter(d => d.turno_id === turnoId)
}

const contadores = computed(() => [
    {
        id: 'abiertas',
        etiqueta: 'Cajas abiertas',
        valor: String(abiertas.value.length),
        detalle: abiertas.value[0] ? `${abiertas.value[0].nombre}${abiertas.value[0].turno_abierto_por_nombre ? ` · ${abiertas.value[0].turno_abierto_por_nombre}` : ''}${abiertas.value.length > 1 ? ` y ${abiertas.value.length - 1} más` : ''}` : 'Ninguna',
        icono: 'i-lucide-wallet',
        tono: 'tono-exito',
    },
    {
        id: 'cobrado',
        etiqueta: 'Cobrado hoy',
        valor: cobradoHoy.value ? formatearQuetzales(cobradoHoy.value.monto) : '—',
        detalle: cobradoHoy.value ? `${cobradoHoy.value.cantidad} ${cobradoHoy.value.cantidad === 1 ? 'cobro' : 'cobros'}` : (problemaCobrado.value ? 'No se pudo leer' : 'Sin permiso para ver pagos'),
        icono: 'i-lucide-banknote',
        tono: 'tono-marca',
    },
    {
        id: 'efectivo',
        etiqueta: 'Efectivo en cajas',
        valor: efectivoEnCajas.value ? formatearQuetzales(efectivoEnCajas.value.monto) : '—',
        detalle: efectivoEnCajas.value ? `${efectivoEnCajas.value.cajas} ${efectivoEnCajas.value.cajas === 1 ? 'caja abierta' : 'cajas abiertas'} · por depositar` : 'No se pudo leer el resumen',
        icono: 'i-lucide-landmark',
        tono: 'tono-aviso',
    },
    {
        id: 'diferencias',
        etiqueta: 'Diferencias del mes',
        valor: diferenciasMes.value.cierres ? `${diferenciasMes.value.monto.isNegative() ? '−' : '+'} ${formatearQuetzales(diferenciasMes.value.monto.abs())}` : formatearQuetzales('0.00'),
        detalle: `${diferenciasMes.value.cierres} ${diferenciasMes.value.cierres === 1 ? 'cierre' : 'cierres'}`,
        icono: 'i-lucide-triangle-alert',
        tono: 'tono-error',
    },
])

const pestanas = computed(() => [
    { label: 'Cierres', value: 'cierres' },
    { label: 'Depósitos', value: 'depositos', badge: depositos.value.filter(d => d.estado === 'en_transito').length || undefined },
    { label: 'Retiros e ingresos', value: 'movimientos' },
])

async function cargarResumenes() {
    const mapa = new Map<number, ResumenTurnoCaja | Problem>()
    await Promise.all(abiertas.value.map(async (c) => {
        const resultado = await useCajas().resumen(c.id)
        mapa.set(c.id, resultado.ok ? resultado.data : resultado.problema)
    }))
    resumenes.value = mapa
}

/** Turnos del mes elegido en cada caja (hasta 10 páginas de 20 por caja). */
async function cargarCierres() {
    cargandoCierres.value = true
    problemaCierres.value = null
    const leidos: Cierre[] = []
    let fallo: Problem | null = null
    await Promise.all(cajas.value.map(async (caja) => {
        let cursor: string | undefined
        for (let pagina = 0; pagina < 10; pagina++) {
            const resultado = await useCajas().turnos(caja.id, cursor)
            if (!resultado.ok) {
                fallo = resultado.problema
                return
            }
            leidos.push(...resultado.data.data.filter(t => t.cerrado_en).map(t => ({ ...t, caja })))
            const ultimo = resultado.data.data.at(-1)
            if (!resultado.data.nextCursor || (ultimo && fechaGuatemala(ultimo.abierto_en).slice(0, 7) < mes.value.slice(0, 7))) {
                return
            }
            cursor = resultado.data.nextCursor
        }
    }))
    cargandoCierres.value = false
    problemaCierres.value = fallo
    cierres.value = fallo ? [] : leidos.sort((a, b) => (b.cerrado_en ?? '').localeCompare(a.cerrado_en ?? ''))
}

async function cargarDepositos() {
    if (!puede('cajas.ver') && !puede('bancos.ver')) {
        return
    }
    cargandoDepositos.value = true
    // Con `bancos.ver`, todos; sin él (el cajero), los de cada caja que ve (la API pide `caja_id`).
    const resultados = puede('bancos.ver')
        ? [await useFondosEnTransito().depositos(undefined, undefined, 200)]
        : await Promise.all(cajas.value.map(c => useFondosEnTransito().depositos(undefined, undefined, 200, { caja_id: c.id })))
    cargandoDepositos.value = false
    const fallo = resultados.find(r => !r.ok)
    depositos.value = fallo ? [] : resultados.flatMap(r => (r.ok ? r.data.data : [])).sort((x, y) => y.id - x.id)
    problemaDepositos.value = fallo && !fallo.ok ? fallo.problema : null
}

async function cargarRetiros() {
    cargandoRetiros.value = true
    const desde = `${mes.value.slice(0, 7)}-01`
    // Con `egresos.ver`, todos; con solo `cajas.ver` (el cajero), los de cada caja (la API pide `caja_id`).
    const resultados = puede('egresos.ver')
        ? [await useEgresos().listar({ metodo: 'caja', desde, limit: 200 })]
        : await Promise.all(cajas.value.map(c => useEgresos().listar({ metodo: 'caja', caja_id: c.id, desde, limit: 200 })))
    cargandoRetiros.value = false
    const fallo = resultados.find(r => !r.ok)
    retiros.value = fallo ? [] : resultados.flatMap(r => (r.ok ? r.data.data : [])).sort((x, y) => y.created_at.localeCompare(x.created_at))
    problemaRetiros.value = fallo && !fallo.ok ? fallo.problema : null
}

async function cargarCobradoHoy() {
    if (!puede('pagos.ver')) {
        return
    }
    let monto = new Decimal(0)
    let cantidad = 0
    let cursor: string | undefined
    for (let pagina = 0; pagina < 10; pagina++) {
        const resultado = await usePagos().listar({ desde: inicioDiaGuatemala(hoy), hasta: finDiaGuatemala(hoy), limit: 200 }, cursor)
        if (!resultado.ok) {
            problemaCobrado.value = resultado.problema
            cobradoHoy.value = null
            return
        }
        for (const p of resultado.data.data.filter(x => x.estado !== 'anulado')) {
            monto = monto.plus(p.monto)
            cantidad++
        }
        if (!resultado.data.nextCursor) {
            break
        }
        cursor = resultado.data.nextCursor
    }
    problemaCobrado.value = null
    cobradoHoy.value = { monto, cantidad }
}

async function cargar() {
    cargando.value = true
    const resultado = await useCajas().listar()
    cargando.value = false
    if (!resultado.ok) {
        cajas.value = []
        problema.value = resultado.problema
        return
    }
    problema.value = null
    cajas.value = resultado.data
    await Promise.all([cargarResumenes(), cargarCierres(), cargarDepositos(), cargarRetiros(), cargarCobradoHoy()])
}

watch(mes, () => {
    void cargarCierres()
    void cargarRetiros()
})

// Acciones de la caja propia y de la lista
const aperturaAbierta = ref(false)
/** La caja que se abre: la propia (acción principal) o la elegida en «Cajas e impresión». */
const cajaApertura = shallowRef<Caja | null>(null)
const cierreAbierto = ref(false)
const cajaCierre = shallowRef<Caja | null>(null)
const depositoAbierto = ref(false)
const altaAbierta = ref(false)
const administrarAbierto = ref(false)
const retiroAbierto = ref(false)
const categorias = shallowRef<CategoriaEgresoApi[]>([])

function abrirApertura(caja: Caja) {
    cajaApertura.value = caja
    aperturaAbierta.value = true
}

function abrirCierre(caja: Caja) {
    cajaCierre.value = caja
    cierreAbierto.value = true
}

async function abrirRetiro() {
    if (!categorias.value.length) {
        const resultado = await useEgresos().categorias()
        categorias.value = resultado.ok ? resultado.data : []
    }
    retiroAbierto.value = true
}

const opcionesDeposito = computed(() => abiertas.value.map(caja => ({ caja, efectivo: resumenDe(caja.id) ? new Decimal(resumenDe(caja.id)?.esperado ?? '0') : null })))

function alAbrir(turno: TurnoCaja) {
    toast.add({ title: 'Caja abierta', description: `Fondo inicial ${formatearQuetzales(turno.fondo_inicial)}`, icon: 'i-lucide-lock-open', color: 'success' })
    void miCaja.refrescar()
    void cargar()
}

function alCerrar(turno: TurnoCaja) {
    toast.add({
        title: 'Caja cerrada',
        description: turno.diferencia ? etiquetaCuadre(turno.diferencia) : undefined,
        icon: 'i-lucide-lock',
        color: colorDiferencia(turno.diferencia) === 'success' ? 'success' : 'warning',
    })
    void cargar()
}

function alDepositar(deposito: Deposito) {
    toast.add({ title: `Depósito de ${formatearQuetzales(deposito.monto)} registrado`, description: `Boleta ${deposito.boleta} a ${deposito.cuenta_nombre}: queda en tránsito hasta conciliar el estado de cuenta.`, icon: 'i-lucide-landmark', color: 'success' })
    void cargar()
}

function alRetirar(egreso: Egreso) {
    toast.add({ title: `Retiro de ${formatearQuetzales(egreso.monto)} registrado`, description: egreso.descripcion ?? undefined, icon: 'i-lucide-banknote', color: 'success' })
    void cargar()
}

async function alCrear(nueva: Caja) {
    toast.add({ title: 'Caja creada', description: `${nueva.nombre} · ${nombreEmpresa(nueva.empresa_id)}`, icon: 'i-lucide-wallet', color: 'success' })
    await cargar()
}

const itemsMas = computed<DropdownMenuItem[][]>(() => [[
    ...(puede('cajas.depositar') ? [{ label: 'Registrar depósito', icon: 'i-lucide-landmark', onSelect: () => { depositoAbierto.value = true } }] : []),
    ...(puede('egresos.registrar') ? [{ label: 'Registrar retiro', icon: 'i-lucide-banknote-arrow-down', onSelect: () => { void abrirRetiro() } }] : []),
    { label: 'Cajas e impresión', icon: 'i-lucide-settings-2', onSelect: () => { administrarAbierto.value = true } },
    ...(puede('cajas.crear') ? [{ label: 'Nueva caja', icon: 'i-lucide-plus', onSelect: () => { altaAbierta.value = true } }] : []),
]])

// Tabla de cierres
const columnasCierres: TableColumn<Cierre>[] = [
    { accessorKey: 'id', header: 'Corte', meta: SOLO_ANCHO },
    { id: 'caja', header: 'Caja y cajero' },
    { accessorKey: 'cerrado_en', header: 'Cerrada', meta: SOLO_ANCHO },
    { accessorKey: 'esperado', header: 'Debe haber', meta: SOLO_ESCRITORIO },
    { accessorKey: 'contado', header: 'Efectivo', meta: SOLO_ANCHO },
    { accessorKey: 'diferencia', header: 'Cuadre' },
    { id: 'deposito', header: 'Depósito', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-right' } } },
]

const imprimiendo = shallowRef<{ cierre: Cierre, formato: FormatoImpresion } | null>(null)
async function imprimir(cierre: Cierre, formato: FormatoImpresion = impresion.formatoDe(cierre.caja_id)) {
    imprimiendo.value = { cierre, formato }
    await nextTick()
    if (typeof window.print === 'function') {
        window.print()
    }
    imprimiendo.value = null
}

const menuFila = useMenuFila<Cierre>(cierre => [
    { etiqueta: 'Imprimir corte', icono: ICONOS.imprimir, alElegir: () => { void imprimir(cierre) } },
    { etiqueta: 'Imprimir en carta', icono: 'i-lucide-file-text', alElegir: () => { void imprimir(cierre, 'carta') }, soloMenu: true },
    ...(puede('pagos.ver') ? [{ etiqueta: 'Ver cobros del turno', icono: 'i-lucide-list', to: `/pagos?caja=${cierre.caja_id}&desde=${fechaGuatemala(cierre.abierto_en)}&hasta=${cierre.cerrado_en ? fechaGuatemala(cierre.cerrado_en) : hoy}`, soloMenu: true }] : []),
])

function exportar() {
    const filas = [['Corte', 'Caja', 'Cajero', 'Abierta', 'Cerrada', 'Fondo', 'Debe haber', 'Contado', 'Diferencia', 'Motivo']]
    for (const c of cierresFiltrados.value) {
        filas.push([String(c.id), c.caja.nombre, c.cerrado_por_nombre ?? c.abierto_por_nombre ?? '', formatearFechaHora(c.abierto_en), c.cerrado_en ? formatearFechaHora(c.cerrado_en) : '', c.fondo_inicial, c.esperado ?? '', c.contado ?? '', c.diferencia ?? '', c.motivo ?? ''])
    }
    const csv = filas.map(f => f.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const enlace = document.createElement('a')
    enlace.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    enlace.download = `cierres-${mes.value.slice(0, 7)}.csv`
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000)
}

const columnasDepositos: TableColumn<Deposito>[] = [
    { accessorKey: 'id', header: 'Depósito' },
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'cuenta_nombre', header: 'Cuenta', meta: SOLO_ESCRITORIO },
    { accessorKey: 'boleta', header: 'Boleta', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado' },
]

const columnasRetiros: TableColumn<Egreso>[] = [
    { accessorKey: 'fecha', header: 'Fecha' },
    { id: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { accessorKey: 'descripcion', header: 'Motivo y quién' },
    { accessorKey: 'caja_nombre', header: 'Caja', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

onMounted(() => {
    void miCaja.cargar()
    void cargar()
})
</script>

<template>
    <PanelPagina
        id="caja"
        titulo="Cajas"
        icono="i-lucide-wallet"
        sin-descripcion
    >
        <template #acciones>
            <UTabs
                v-model="pestana"
                :items="pestanas"
                :content="false"
                color="neutral"
                variant="pill"
                class="max-sm:w-full"
                :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1', trigger: 'rounded-lg px-4 data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm max-sm:flex-1', trailingBadge: 'bg-warning/15 text-warning' }"
                aria-label="Vista de cajas"
                data-prueba="pestanas-cajas"
            />
            <UButton
                v-if="propia && propia.turno_abierto_id !== null && puede('cajas.cerrar')"
                label="Cerrar caja"
                icon="i-lucide-lock"
                class="glow-brand rounded-full"
                data-prueba="cerrar-caja"
                @click="abrirCierre(propia)"
            />
            <UButton
                v-else-if="propia && puede('cajas.abrir')"
                label="Abrir caja"
                icon="i-lucide-lock-open"
                color="success"
                class="rounded-full"
                data-prueba="abrir-caja-barra"
                @click="abrirApertura(propia)"
            />
            <UDropdownMenu
                :items="itemsMas"
                :content="{ align: 'end' }"
            >
                <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="outline"
                    class="rounded-full"
                    aria-label="Más acciones de cajas"
                    data-prueba="mas-cajas"
                />
            </UDropdownMenu>
        </template>

        <div class="flex min-h-0 flex-1 flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />

            <template v-else>
                <div
                    v-if="pestana === 'cierres'"
                    class="grid grid-cols-2 gap-3 lg:grid-cols-4"
                    data-prueba="contadores-cajas"
                >
                    <div
                        v-for="c in contadores"
                        :key="c.id"
                        class="surface-card flex items-center gap-3 rounded-2xl p-3 sm:p-4"
                        :data-contador="c.id"
                    >
                        <span
                            class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                            :class="c.tono"
                        >
                            <UIcon
                                :name="c.icono"
                                class="size-5"
                            />
                        </span>
                        <span class="flex min-w-0 flex-col">
                            <span class="truncate text-xs text-muted">{{ c.etiqueta }}</span>
                            <span class="truncate text-lg font-bold tabular-nums text-highlighted">
                                <USkeleton
                                    v-if="cargando"
                                    class="h-6 w-20"
                                />
                                <template v-else>{{ c.valor }}</template>
                            </span>
                            <span class="hidden truncate text-[0.6875rem] text-muted sm:block">{{ c.detalle }}</span>
                        </span>
                    </div>
                </div>

                <!-- Cierres -->
                <div
                    v-if="pestana === 'cierres'"
                    class="surface-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
                >
                    <div class="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                        <UButton
                            label="Todos"
                            :color="!soloDiferencia ? 'primary' : 'neutral'"
                            :variant="!soloDiferencia ? 'solid' : 'outline'"
                            :aria-pressed="!soloDiferencia"
                            size="sm"
                            class="rounded-full"
                            @click="soloDiferencia = false"
                        />
                        <UButton
                            label="Con diferencia"
                            :color="soloDiferencia ? 'primary' : 'neutral'"
                            :variant="soloDiferencia ? 'solid' : 'outline'"
                            :aria-pressed="soloDiferencia"
                            size="sm"
                            class="rounded-full"
                            data-prueba="filtro-diferencia"
                            @click="soloDiferencia = true"
                        />
                        <USelect
                            v-model="mes"
                            :items="itemsMes"
                            icon="i-lucide-calendar"
                            size="sm"
                            aria-label="Mes"
                            class="w-40"
                            :ui="{ base: 'rounded-full' }"
                        />
                        <USelect
                            v-model="filtroCaja"
                            :items="itemsCaja"
                            size="sm"
                            aria-label="Caja"
                            class="w-40"
                            :ui="{ base: 'rounded-full' }"
                        />
                        <span class="flex-1" />
                        <UButton
                            label="Exportar"
                            :icon="ICONOS.exportar"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="rounded-full"
                            :disabled="!cierresFiltrados.length"
                            @click="exportar"
                        />
                    </div>
                    <div
                        v-if="problemaCierres"
                        class="p-3 sm:p-4"
                    >
                        <ProblemaAlerta
                            :problema="problemaCierres"
                            :reintentar="cargarCierres"
                            :reintentando="cargandoCierres"
                        />
                    </div>
                    <UContextMenu
                        v-else
                        :items="menuFila.items.value"
                    >
                        <UTable
                            :data="cierresFiltrados"
                            :columns="columnasCierres"
                            :loading="cargandoCierres"
                            sticky
                            class="min-h-0 flex-1"
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                            aria-label="Cierres de caja"
                            data-menu-contextual
                            data-prueba="tabla-cierres"
                            @contextmenu="menuFila.alContextmenu"
                        >
                            <template #id-cell="{ row }">
                                <span class="font-mono text-sm">#{{ row.original.id }}</span>
                            </template>
                            <template #caja-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="font-semibold text-highlighted">{{ row.original.caja.nombre }}<template v-if="row.original.cerrado_por_nombre ?? row.original.abierto_por_nombre"> · {{ row.original.cerrado_por_nombre ?? row.original.abierto_por_nombre }}</template></span>
                                    <span
                                        v-if="variasEmpresas"
                                        class="text-xs text-muted"
                                    >{{ nombreEmpresa(row.original.caja.empresa_id) }}</span>
                                    <span class="text-xs text-muted sm:hidden">{{ formatearFechaCorta(row.original.cerrado_en) }} · {{ formatearQuetzales(row.original.contado) }}</span>
                                    <span
                                        v-if="row.original.motivo"
                                        class="max-w-xs truncate text-xs text-muted"
                                        :title="row.original.motivo"
                                    >{{ row.original.motivo }}</span>
                                </div>
                            </template>
                            <template #cerrado_en-cell="{ row }">
                                <span class="text-muted">{{ row.original.cerrado_en ? `${formatearFechaCorta(row.original.cerrado_en)} ${formatearHora(row.original.cerrado_en)}` : '—' }}</span>
                            </template>
                            <template #esperado-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.esperado) }}</span>
                            </template>
                            <template #contado-cell="{ row }">
                                <span class="tabular-nums">{{ formatearQuetzales(row.original.contado) }}</span>
                            </template>
                            <template #diferencia-cell="{ row }">
                                <UBadge
                                    v-if="row.original.diferencia !== null"
                                    :label="etiquetaCuadre(row.original.diferencia)"
                                    :icon="iconoDiferencia(row.original.diferencia)"
                                    :color="colorDiferencia(row.original.diferencia)"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                />
                            </template>
                            <template #deposito-cell="{ row }">
                                <UBadge
                                    v-if="depositosDe(row.original.id).length"
                                    :label="`${formatearQuetzales(depositosDe(row.original.id).reduce((s, d) => s.plus(d.monto), new Decimal(0)))} · ${ESTADOS_TRANSITO[depositosDe(row.original.id)[0]!.estado].etiqueta}`"
                                    :icon="ESTADOS_TRANSITO[depositosDe(row.original.id)[0]!.estado].icono"
                                    :color="ESTADOS_TRANSITO[depositosDe(row.original.id)[0]!.estado].color"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                />
                                <span
                                    v-else
                                    class="text-xs text-muted"
                                >Sin depósito</span>
                            </template>
                            <template #acciones-cell="{ row }">
                                <div class="flex items-center justify-end gap-0.5">
                                    <AccionesFila
                                        :acciones="menuFila.accionesDe(row.original)"
                                        :nombre="`corte ${row.original.id}`"
                                    />
                                    <UDropdownMenu
                                        :items="menuFila.itemsDe(row.original)"
                                        :content="{ align: 'end' }"
                                    >
                                        <UButton
                                            icon="i-lucide-ellipsis"
                                            color="neutral"
                                            variant="ghost"
                                            size="sm"
                                            :aria-label="`Más acciones del corte ${row.original.id}`"
                                        />
                                    </UDropdownMenu>
                                </div>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-lock"
                                    :title="soloDiferencia ? 'Sin cierres con diferencia' : 'Sin cierres en este mes'"
                                    description="Cada cierre de caja queda aquí con su cuadre."
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </UContextMenu>
                </div>

                <!-- Depósitos -->
                <template v-else-if="pestana === 'depositos'">
                    <div
                        class="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3 sm:p-4"
                        data-prueba="aviso-por-depositar"
                    >
                        <span class="pastilla-icono size-10 bg-warning/15 text-warning">
                            <UIcon
                                name="i-lucide-landmark"
                                class="size-5"
                            />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="font-bold text-highlighted">{{ efectivoEnCajas ? `${formatearQuetzales(efectivoEnCajas.monto)} en efectivo en las cajas abiertas` : 'No se pudo leer el efectivo de las cajas' }}</span>
                            <span class="text-xs text-warning">{{ abiertas.map(c => c.nombre).join(' y ') || 'Ninguna caja abierta' }}</span>
                        </span>
                        <UButton
                            v-if="puede('cajas.depositar')"
                            label="Registrar depósito"
                            icon="i-lucide-plus"
                            class="glow-brand rounded-full"
                            :disabled="!abiertas.length"
                            data-prueba="abrir-deposito"
                            @click="depositoAbierto = true"
                        />
                    </div>
                    <div class="surface-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
                        <div
                            v-if="problemaDepositos"
                            class="p-3 sm:p-4"
                        >
                            <ProblemaAlerta
                                :problema="problemaDepositos"
                                :reintentar="cargarDepositos"
                                :reintentando="cargandoDepositos"
                            />
                        </div>
                        <UTable
                            v-else
                            :data="depositos"
                            :columns="columnasDepositos"
                            :loading="cargandoDepositos"
                            sticky
                            class="min-h-0 flex-1"
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                            aria-label="Depósitos al banco"
                            data-prueba="tabla-depositos"
                        >
                            <template #id-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="font-mono text-sm">#{{ row.original.id }}</span>
                                    <span class="text-xs text-muted">{{ row.original.caja_nombre }}</span>
                                </div>
                            </template>
                            <template #fecha-cell="{ row }">
                                <span class="text-muted">{{ formatearFechaCorta(row.original.fecha) }}</span>
                            </template>
                            <template #boleta-cell="{ row }">
                                <span class="font-mono text-sm">{{ row.original.boleta }}</span>
                            </template>
                            <template #monto-cell="{ row }">
                                <span class="font-bold tabular-nums text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                            </template>
                            <template #estado-cell="{ row }">
                                <UBadge
                                    :label="ESTADOS_TRANSITO[row.original.estado].etiqueta"
                                    :color="ESTADOS_TRANSITO[row.original.estado].color"
                                    :icon="ESTADOS_TRANSITO[row.original.estado].icono"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                />
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-landmark"
                                    title="Sin depósitos"
                                    description="El efectivo de una caja abierta se deposita con su boleta y queda en tránsito hasta conciliar."
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </div>
                </template>

                <!-- Retiros e ingresos -->
                <template v-else>
                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            v-if="puede('egresos.registrar')"
                            label="Registrar retiro"
                            icon="i-lucide-banknote"
                            color="neutral"
                            variant="outline"
                            class="rounded-full"
                            data-prueba="registrar-retiro"
                            @click="abrirRetiro"
                        />
                        <span class="text-xs text-muted">Cada retiro pide motivo y queda en la bitácora; el cierre lo descuenta.</span>
                    </div>
                    <div class="surface-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
                        <div
                            v-if="problemaRetiros"
                            class="p-3 sm:p-4"
                        >
                            <ProblemaAlerta
                                :problema="problemaRetiros"
                                :reintentar="cargarRetiros"
                                :reintentando="cargandoRetiros"
                            />
                        </div>
                        <UTable
                            v-else
                            :data="retiros"
                            :columns="columnasRetiros"
                            :loading="cargandoRetiros"
                            sticky
                            class="min-h-0 flex-1"
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                            aria-label="Retiros de efectivo"
                            data-prueba="tabla-retiros"
                        >
                            <template #fecha-cell="{ row }">
                                <span class="text-muted">{{ formatearFechaCorta(row.original.created_at) }} {{ formatearHora(row.original.created_at) }}</span>
                            </template>
                            <template #tipo-cell="{ row }">
                                <UBadge
                                    :label="row.original.estado === 'anulado' ? 'Anulado' : 'Retiro'"
                                    :icon="row.original.estado === 'anulado' ? 'i-lucide-ban' : 'i-lucide-arrow-up-right'"
                                    :color="row.original.estado === 'anulado' ? 'neutral' : 'error'"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                />
                            </template>
                            <template #descripcion-cell="{ row }">
                                <span class="whitespace-normal">{{ row.original.descripcion }}<template v-if="row.original.registrado_por_nombre"> · {{ row.original.registrado_por_nombre }}</template></span>
                            </template>
                            <template #monto-cell="{ row }">
                                <span
                                    class="font-bold tabular-nums"
                                    :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'text-highlighted'"
                                >− {{ formatearQuetzales(row.original.monto) }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-banknote"
                                    title="Sin retiros en este mes"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </div>
                </template>
            </template>
        </div>

        <CajaAperturaModal
            v-if="cajaApertura && puede('cajas.abrir')"
            v-model:open="aperturaAbierta"
            :caja="cajaApertura"
            @hecho="alAbrir"
        />
        <CajaCierreModal
            v-if="cajaCierre"
            v-model:open="cierreAbierto"
            :caja="cajaCierre"
            @hecho="alCerrar"
        />
        <CajaDepositoSlideover
            v-if="puede('cajas.depositar')"
            v-model:open="depositoAbierto"
            :opciones="opcionesDeposito"
            @hecho="alDepositar"
        />
        <EgresoRegistrarModal
            v-if="puede('egresos.registrar')"
            v-model:open="retiroAbierto"
            :categorias="categorias"
            @hecho="alRetirar"
        />
        <CajasAdministrarSlideover
            v-model:open="administrarAbierto"
            :cajas="cajas"
            @abrir="abrirApertura"
            @cerrar="abrirCierre"
            @nueva="altaAbierta = true"
        />
        <CajaCrearModal
            v-if="puede('cajas.crear')"
            v-model:open="altaAbierta"
            @hecho="alCrear"
        />
        <CajaCorteImpresion
            v-if="imprimiendo"
            :caja="imprimiendo.cierre.caja"
            :turno="imprimiendo.cierre"
            :resumen="null"
            :formato="imprimiendo.formato"
        />
    </PanelPagina>
</template>
