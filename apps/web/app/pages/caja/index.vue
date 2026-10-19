<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'cajas.ver' })

useHead({ title: 'Caja · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const toast = useToast()
const nombres = useNombresClientes()

const cajas = shallowRef<Caja[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const cajaId = computed<number>({
    get() {
        const id = Number(route.query.caja)
        if (cajas.value.some(c => c.id === id)) {
            return id
        }
        // Por defecto la caja del usuario, si tiene una.
        return cajas.value.find(c => c.cajero_id === usuario.value?.id)?.id ?? cajas.value[0]?.id ?? 0
    },
    set(id) {
        void router.replace({ query: { ...route.query, caja: String(id) } })
    },
})

const caja = computed(() => cajas.value.find(c => c.id === cajaId.value) ?? null)

/** Turnos de la caja elegida (el abierto sale de aquí por `turno_abierto_id`). */
const historial = usePaginacionCursor(cursor => (caja.value ? useCajas().turnos(caja.value.id, cursor) : Promise.resolve({ ok: true as const, data: { data: [], nextCursor: null } })))

const turnoAbierto = shallowRef<TurnoCaja | null>(null)
const problemaTurno = ref<Problem | null>(null)
const cargandoTurno = ref(false)

const cobros = shallowRef<Pago[]>([])
const cargandoCobros = ref(false)
const problemaCobros = ref<Problem | null>(null)

/*
 * Egresos en efectivo del turno (`GET /egresos?caja_id=&metodo=caja`, `egresos.ver`): bajan el
 * esperado. Sin ese permiso (el cajero) el panel no puede leerlos y no muestra un esperado que
 * saldría de más: lo calcula la API al cerrar.
 */
const egresos = shallowRef<Egreso[]>([])
const cargandoEgresos = ref(false)
const problemaEgresos = ref<Problem | null>(null)
const leeEgresos = computed(() => puede('egresos.ver'))
const egresosTurno = computed(() => (turnoAbierto.value ? egresosEnEfectivo(egresos.value, turnoAbierto.value.id) : []))
const totalEgresos = computed(() => egresosTurno.value.reduce((suma, e) => suma.plus(e.monto), new Decimal(0)))

/*
 * Depósitos al banco del turno (`GET /bancos/depositos?turno_id=`; fase 4): bajan el esperado
 * como un egreso. El cajero los lee de su caja con `cajas.ver`; con `bancos.ver`, cualquier caja.
 */
const depositos = shallowRef<Deposito[]>([])
const cargandoDepositos = ref(false)
const problemaDepositos = ref<Problem | null>(null)
const leeDepositos = computed(() => puede('cajas.ver') || puede('bancos.ver'))
const depositosTurno = computed(() => (turnoAbierto.value ? depositosDelTurno(depositos.value, turnoAbierto.value.id) : []))
const totalDepositos = computed(() => depositosTurno.value.reduce((suma, d) => suma.plus(d.monto), new Decimal(0)))
const depositoAbierto = ref(false)
/** El último depósito hecho en esta pantalla (lo ve también quien no tiene `bancos.ver`). */
const ultimoDeposito = shallowRef<Deposito | null>(null)

const aperturaAbierta = ref(false)
const altaAbierta = ref(false)

/** Con varias empresas, cada tarjeta dice de cuál es la caja. */
const { conSelector: variasEmpresas, empresas: empresasUsuario } = useEmpresaActiva()
function nombreEmpresa(id: number | undefined): string {
    return empresasUsuario.value.find(e => e.id === id)?.nombre_comercial ?? (id ? `Empresa ${id}` : '')
}
const cierreAbierto = ref(false)
/** Resultado oficial del último cierre (lo que devolvió la API). */
const ultimoCierre = shallowRef<TurnoCaja | null>(null)

/**
 * Fondo + efectivo cobrado − egresos en efectivo del turno: solo con cobros y egresos leídos
 * (nunca sobre una lista que falló ni sin poder leer los egresos).
 */
const esperado = computed<Decimal | null>(() => (turnoAbierto.value && leeEgresos.value && leeDepositos.value
    && !problemaCobros.value && !cargandoCobros.value && !problemaEgresos.value && !cargandoEgresos.value
    && !problemaDepositos.value && !cargandoDepositos.value
    ? esperadoProvisional(turnoAbierto.value.fondo_inicial, cobros.value, egresos.value, turnoAbierto.value.id).minus(totalDepositos.value)
    : null))

const efectivo = computed(() => cobrosEnEfectivo(cobros.value))
const efectivoCobrado = computed(() => efectivo.value.reduce((suma, p) => suma.plus(p.monto), new Decimal(0)))

/** Por qué no hay esperado provisional (se muestra en la página y en el cierre). */
const sinEsperado = computed<string | null>(() => {
    if (!turnoAbierto.value || esperado.value) {
        return null
    }
    if (!leeEgresos.value) {
        return 'El esperado lo calcula la API al cerrar: resta los egresos en efectivo del turno, que tu usuario no puede ver (falta egresos.ver).'
    }
    if (!leeDepositos.value) {
        return 'El esperado lo calcula la API al cerrar: resta los depósitos al banco del turno, que tu usuario no puede ver (falta cajas.ver).'
    }
    if (problemaCobros.value || problemaEgresos.value || problemaDepositos.value) {
        return 'No se pudieron leer los cobros, los egresos o los depósitos del turno: la API calcula el esperado y la diferencia al cerrar.'
    }
    return null
})

const columnasCobros: TableColumn<Pago>[] = [
    { accessorKey: 'id', header: 'Pago' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
]

const columnasTurnos: TableColumn<TurnoCaja>[] = [
    { accessorKey: 'abierto_en', header: 'Turno' },
    { accessorKey: 'fondo_inicial', header: 'Fondo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'esperado', header: 'Esperado', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'contado', header: 'Contado', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'diferencia', header: 'Diferencia' },
]

async function cargarCobros(turno: TurnoCaja) {
    if (!puede('pagos.ver')) {
        return
    }
    cargandoCobros.value = true
    const resultado = await usePagos().listar({ caja_id: turno.caja_id, desde: turno.abierto_en, limit: 200 })
    cargandoCobros.value = false
    cobros.value = resultado.ok ? resultado.data.data : []
    problemaCobros.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        void nombres.cargar(resultado.data.data.map(p => p.cliente_id))
    }
}

/** Egresos en efectivo de la caja desde el día en que abrió el turno (se filtran por `turno_id`). */
async function cargarEgresos(turno: TurnoCaja) {
    if (!leeEgresos.value) {
        return
    }
    cargandoEgresos.value = true
    const leidos: Egreso[] = []
    let cursor: string | undefined
    let fallo: Problem | null = null
    // Un turno no tiene cientos de egresos; se leen hasta 5 páginas de 200.
    for (let pagina = 0; pagina < 5; pagina++) {
        const resultado = await useEgresos().listar({ caja_id: turno.caja_id, metodo: 'caja', estado: 'registrado', desde: fechaGuatemala(turno.abierto_en), limit: 200 }, cursor)
        if (!resultado.ok) {
            fallo = resultado.problema
            break
        }
        leidos.push(...resultado.data.data)
        if (!resultado.data.nextCursor) {
            break
        }
        cursor = resultado.data.nextCursor
    }
    cargandoEgresos.value = false
    egresos.value = fallo ? [] : leidos
    problemaEgresos.value = fallo
}

/** Depósitos del turno abierto (`turno_id`, hasta 5 páginas de 200). */
async function cargarDepositos() {
    const turno = turnoAbierto.value
    if (!leeDepositos.value || !turno) {
        return
    }
    cargandoDepositos.value = true
    const leidos: Deposito[] = []
    let cursor: string | undefined
    let fallo: Problem | null = null
    for (let pagina = 0; pagina < 5; pagina++) {
        const resultado = await useFondosEnTransito().depositos(undefined, cursor, 200, { turno_id: turno.id })
        if (!resultado.ok) {
            fallo = resultado.problema
            break
        }
        leidos.push(...resultado.data.data)
        if (!resultado.data.nextCursor) {
            break
        }
        cursor = resultado.data.nextCursor
    }
    cargandoDepositos.value = false
    depositos.value = fallo ? [] : leidos
    problemaDepositos.value = fallo
}

function alDepositar(deposito: Deposito) {
    ultimoDeposito.value = deposito
    toast.add({
        title: `Depósito de ${formatearQuetzales(deposito.monto)} registrado`,
        description: `Boleta ${deposito.boleta} a ${deposito.cuenta_nombre}: queda en tránsito hasta conciliar el extracto.`,
        icon: 'i-lucide-landmark',
        color: 'success',
    })
    void cargarDepositos()
}

async function cargarTurno() {
    turnoAbierto.value = null
    cobros.value = []
    egresos.value = []
    depositos.value = []
    problemaDepositos.value = null
    ultimoDeposito.value = null
    problemaEgresos.value = null
    problemaCobros.value = null
    problemaTurno.value = null
    if (!caja.value) {
        return
    }
    cargandoTurno.value = true
    await historial.recargar()
    cargandoTurno.value = false
    problemaTurno.value = historial.problema.value
    const id = caja.value.turno_abierto_id
    turnoAbierto.value = id === null ? null : (historial.filas.value.find(t => t.id === id) ?? null)
    if (turnoAbierto.value) {
        void cargarCobros(turnoAbierto.value)
        void cargarEgresos(turnoAbierto.value)
        void cargarDepositos()
    }
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
    await cargarTurno()
}

async function alCrear(nueva: Caja) {
    toast.add({ title: 'Caja creada', description: `${nueva.nombre} · ${nombreEmpresa(nueva.empresa_id)}`, icon: 'i-lucide-wallet', color: 'success' })
    await cargar()
    cajaId.value = nueva.id
}

function alAbrir(turno: TurnoCaja) {
    ultimoCierre.value = null
    toast.add({ title: 'Turno abierto', description: `Fondo inicial ${formatearQuetzales(turno.fondo_inicial)}`, icon: 'i-lucide-lock-open', color: 'success' })
    void cargar()
}

function alCerrar(turno: TurnoCaja) {
    ultimoCierre.value = turno
    toast.add({
        title: 'Turno cerrado',
        description: turno.diferencia ? etiquetaDiferencia(turno.diferencia) : undefined,
        icon: 'i-lucide-lock',
        color: colorDiferencia(turno.diferencia) === 'success' ? 'success' : 'warning',
    })
    void cargar()
}

watch(cajaId, (nuevo, anterior) => {
    if (nuevo !== anterior) {
        ultimoCierre.value = null
        void cargarTurno()
    }
})

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="caja"
        titulo="Caja"
        icono="i-lucide-wallet"
    >
        <template #acciones>
            <UButton
                v-if="puede('cajas.crear')"
                icon="i-lucide-plus"
                label="Nueva caja"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nueva caja"
                data-prueba="nueva-caja"
                @click="altaAbierta = true"
            />
            <UButton
                v-if="puede('pagos.registrar')"
                to="/cobro"
                icon="i-lucide-hand-coins"
                label="Cobrar"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Cobrar"
            />
        </template>

        <div
            v-if="cargando && !cajas.length"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-20 w-full" />
            <USkeleton class="h-48 w-full" />
        </div>

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <UEmpty
            v-else-if="!cajas.length"
            icon="i-lucide-wallet"
            title="No hay cajas"
            :description="puede('cajas.crear') ? 'Crea la primera caja de esta empresa.' : 'Pide a un administrador que cree una caja.'"
            :actions="puede('cajas.crear') ? [{ label: 'Nueva caja', icon: 'i-lucide-plus', onClick: () => { altaAbierta = true } }] : []"
        />

        <div
            v-else
            class="flex flex-col gap-6"
        >
            <div
                class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                role="radiogroup"
                aria-label="Caja"
            >
                <UButton
                    v-for="c in cajas"
                    :key="c.id"
                    role="radio"
                    :aria-checked="c.id === cajaId"
                    :color="c.id === cajaId ? 'primary' : 'neutral'"
                    :variant="c.id === cajaId ? 'soft' : 'outline'"
                    class="justify-between p-3"
                    :data-caja="c.id"
                    @click="cajaId = c.id"
                >
                    <span class="flex flex-col items-start text-left">
                        <span class="font-medium">{{ c.nombre }}</span>
                        <span class="text-xs text-muted">{{ c.cajero_id === usuario?.id ? 'Tu caja' : c.cajero_id ? (c.cajero_nombre ?? `Cajero #${c.cajero_id}`) : 'Sin cajero asignado' }}</span>
                        <span
                            v-if="variasEmpresas"
                            class="text-xs text-muted"
                            :data-empresa-caja="c.empresa_id"
                        >{{ nombreEmpresa(c.empresa_id) }}</span>
                    </span>
                    <UBadge
                        :label="c.turno_abierto_id ? 'Turno abierto' : 'Cerrada'"
                        :icon="c.turno_abierto_id ? 'i-lucide-lock-open' : 'i-lucide-lock'"
                        :color="c.turno_abierto_id ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </UButton>
            </div>

            <UAlert
                v-if="ultimoCierre"
                :color="colorDiferencia(ultimoCierre.diferencia) === 'success' ? 'success' : 'warning'"
                variant="subtle"
                icon="i-lucide-lock"
                title="Turno cerrado"
                data-prueba="resultado-cierre"
            >
                <template #description>
                    <p class="tabular-nums">
                        Esperado {{ formatearQuetzales(ultimoCierre.esperado) }} · contado {{ formatearQuetzales(ultimoCierre.contado) }} ·
                        <strong>{{ ultimoCierre.diferencia ? etiquetaDiferencia(ultimoCierre.diferencia) : '—' }}</strong>
                    </p>
                    <p v-if="ultimoCierre.motivo">
                        Motivo: {{ ultimoCierre.motivo }}
                    </p>
                </template>
            </UAlert>

            <template v-if="caja">
                <ProblemaAlerta
                    v-if="problemaTurno"
                    :problema="problemaTurno"
                    :reintentar="cargarTurno"
                    :reintentando="cargandoTurno"
                />

                <USkeleton
                    v-else-if="cargandoTurno"
                    class="h-40 w-full"
                />

                <UPageCard
                    v-else-if="turnoAbierto"
                    variant="subtle"
                    data-prueba="turno-abierto"
                >
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="flex flex-col">
                                <h2 class="text-lg font-semibold text-highlighted">
                                    Turno #{{ turnoAbierto.id }} abierto
                                </h2>
                                <p class="text-sm text-muted">
                                    Desde {{ formatearFechaHora(turnoAbierto.abierto_en) }}
                                </p>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <UButton
                                    v-if="puede('cajas.depositar')"
                                    label="Depositar al banco"
                                    icon="i-lucide-landmark"
                                    color="neutral"
                                    variant="outline"
                                    data-prueba="abrir-deposito"
                                    @click="depositoAbierto = true"
                                />
                                <UButton
                                    v-if="puede('cajas.cerrar')"
                                    label="Cerrar turno"
                                    class="glow-brand"
                                    icon="i-lucide-lock"
                                    @click="cierreAbierto = true"
                                />
                            </div>
                        </div>

                        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                            <DatoFicha
                                etiqueta="Fondo inicial"
                                :valor="formatearQuetzales(turnoAbierto.fondo_inicial)"
                            />
                            <template v-if="!problemaCobros && !cargandoCobros && puede('pagos.ver')">
                                <DatoFicha
                                    etiqueta="Cobros en efectivo"
                                    :valor="`${efectivo.length}`"
                                />
                                <DatoFicha
                                    etiqueta="Efectivo cobrado"
                                    :valor="formatearQuetzales(efectivoCobrado)"
                                />
                            </template>
                            <template v-if="esperado">
                                <DatoFicha
                                    etiqueta="Egresos en efectivo"
                                    :valor="totalEgresos.isZero() ? formatearQuetzales(totalEgresos) : `− ${formatearQuetzales(totalEgresos)}`"
                                    data-prueba="turno-egresos"
                                />
                                <DatoFicha
                                    etiqueta="Depositado al banco"
                                    :valor="totalDepositos.isZero() ? formatearQuetzales(totalDepositos) : `− ${formatearQuetzales(totalDepositos)}`"
                                    data-prueba="turno-depositos"
                                />
                                <DatoFicha
                                    etiqueta="Esperado en caja"
                                    :valor="formatearQuetzales(esperado)"
                                    data-prueba="turno-esperado"
                                />
                            </template>
                        </dl>
                        <ul
                            v-if="depositosTurno.length"
                            class="flex flex-col gap-1 text-xs text-muted"
                            data-prueba="depositos-turno"
                        >
                            <li
                                v-for="deposito in depositosTurno"
                                :key="deposito.id"
                                class="flex flex-wrap items-center gap-2"
                            >
                                <UIcon
                                    name="i-lucide-landmark"
                                    class="size-3.5"
                                />
                                <span>Depósito #{{ deposito.id }} · boleta {{ deposito.boleta }} · {{ deposito.cuenta_nombre }} · <strong class="tabular-nums text-default">{{ formatearQuetzales(deposito.monto) }}</strong></span>
                                <UBadge
                                    :label="ESTADOS_TRANSITO[deposito.estado].etiqueta"
                                    :color="ESTADOS_TRANSITO[deposito.estado].color"
                                    :icon="ESTADOS_TRANSITO[deposito.estado].icono"
                                    variant="subtle"
                                    size="sm"
                                />
                            </li>
                        </ul>
                        <ProblemaAlerta
                            v-if="problemaDepositos"
                            :problema="problemaDepositos"
                            :reintentar="cargarDepositos"
                            :reintentando="cargandoDepositos"
                        />
                        <UAlert
                            v-if="ultimoDeposito && !leeDepositos"
                            color="success"
                            variant="subtle"
                            icon="i-lucide-landmark"
                            :title="`Depósito #${ultimoDeposito.id} registrado`"
                            :description="`${formatearQuetzales(ultimoDeposito.monto)} · boleta ${ultimoDeposito.boleta} · ${ultimoDeposito.cuenta_nombre}. La API lo resta del esperado al cerrar.`"
                            data-prueba="resultado-deposito"
                        />
                        <p
                            v-if="esperado"
                            class="text-xs text-muted"
                        >
                            Esperado provisional: fondo + efectivo cobrado − {{ egresosTurno.length }} {{ egresosTurno.length === 1 ? 'egreso' : 'egresos' }} en efectivo − {{ depositosTurno.length }} {{ depositosTurno.length === 1 ? 'depósito' : 'depósitos' }} al banco del turno. La API calcula el oficial al cerrar.
                        </p>
                        <UAlert
                            v-else-if="sinEsperado"
                            color="neutral"
                            variant="subtle"
                            icon="i-lucide-info"
                            title="Sin esperado provisional"
                            :description="sinEsperado"
                            data-prueba="sin-esperado"
                        />
                    </div>
                </UPageCard>

                <UAlert
                    v-else-if="caja.turno_abierto_id !== null"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="`El turno #${caja.turno_abierto_id} está abierto pero no aparece en la lista de turnos`"
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: cargar }]"
                />

                <UPageCard
                    v-else
                    variant="subtle"
                >
                    <UEmpty
                        icon="i-lucide-lock"
                        :title="`${caja.nombre} está cerrada`"
                        description="Abre un turno con el fondo inicial para empezar a cobrar en efectivo."
                        variant="naked"
                    >
                        <template #actions>
                            <UButton
                                v-if="puede('cajas.abrir')"
                                label="Abrir turno"
                                class="glow-brand"
                                icon="i-lucide-lock-open"
                                @click="aperturaAbierta = true"
                            />
                        </template>
                    </UEmpty>
                </UPageCard>

                <section
                    v-if="turnoAbierto && puede('pagos.ver')"
                    class="flex flex-col gap-2"
                >
                    <h3 class="text-sm font-semibold text-highlighted">
                        Cobros del turno
                    </h3>
                    <ProblemaAlerta
                        v-if="problemaCobros"
                        :problema="problemaCobros"
                        :reintentar="() => turnoAbierto && cargarCobros(turnoAbierto)"
                        :reintentando="cargandoCobros"
                    />
                    <UTable
                        v-else
                        :data="cobros"
                        tabindex="0"
                        aria-label="Cobros del turno"
                        :columns="columnasCobros"
                        :loading="cargandoCobros"
                    >
                        <template #id-cell="{ row }">
                            <div class="flex flex-col">
                                <ULink
                                    :to="`/pagos/${row.original.id}`"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >
                                    Pago #{{ row.original.id }}
                                </ULink>
                                <span class="text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }} · {{ ETIQUETAS_METODO[row.original.metodo] }}</span>
                                <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                            </div>
                        </template>
                        <template #cliente_id-cell="{ row }">
                            <span class="text-sm">{{ nombres.nombre(row.original.cliente_id) }}</span>
                        </template>
                        <template #monto-cell="{ row }">
                            <span
                                class="tabular-nums font-medium"
                                :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'text-highlighted'"
                            >{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #estado-cell="{ row }">
                            <EstadoPagoBadge
                                :estado="row.original.estado"
                                size="sm"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-banknote"
                                title="Sin cobros en este turno"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </section>

                <section
                    v-if="!problemaTurno"
                    class="flex flex-col gap-2"
                >
                    <h3 class="text-sm font-semibold text-highlighted">
                        Turnos de {{ caja.nombre }}
                    </h3>
                    <!-- Con scroll horizontal en el teléfono: enfocable para moverlo con el teclado (axe). -->
                    <UTable
                        :data="historial.filas.value"
                        tabindex="0"
                        :aria-label="`Turnos de ${caja.nombre}`"
                        :columns="columnasTurnos"
                        :loading="historial.cargando.value"
                    >
                        <template #abierto_en-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">Turno #{{ row.original.id }}</span>
                                <span class="text-xs text-muted">
                                    {{ formatearFechaHora(row.original.abierto_en) }} → {{ row.original.cerrado_en ? formatearFechaHora(row.original.cerrado_en) : 'abierto' }}
                                </span>
                                <span
                                    v-if="row.original.motivo"
                                    class="text-xs whitespace-normal text-muted"
                                >{{ row.original.motivo }}</span>
                            </div>
                        </template>
                        <template #fondo_inicial-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.fondo_inicial) }}</span>
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
                                :label="etiquetaDiferencia(row.original.diferencia)"
                                :icon="iconoDiferencia(row.original.diferencia)"
                                :color="colorDiferencia(row.original.diferencia)"
                                variant="subtle"
                                size="sm"
                            />
                            <UBadge
                                v-else
                                label="Abierto"
                                icon="i-lucide-lock-open"
                                color="success"
                                variant="outline"
                                size="sm"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-history"
                                title="Sin turnos todavía"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="historial.pagina.value"
                        :hay-anterior="historial.hayAnterior.value"
                        :hay-siguiente="historial.haySiguiente.value"
                        :cargando="historial.cargando.value"
                        :filas="historial.filas.value.length"
                        @anterior="historial.anterior"
                        @siguiente="historial.siguiente"
                    />
                </section>

                <CajaAperturaModal
                    v-model:open="aperturaAbierta"
                    :caja="caja"
                    @hecho="alAbrir"
                />
                <CajaDepositoModal
                    v-if="turnoAbierto && puede('cajas.depositar')"
                    v-model:open="depositoAbierto"
                    :caja="caja"
                    :turno="turnoAbierto"
                    :efectivo="esperado"
                    @hecho="alDepositar"
                />
                <CajaCierreModal
                    v-if="turnoAbierto"
                    v-model:open="cierreAbierto"
                    :caja="caja"
                    :turno="turnoAbierto"
                    :esperado="esperado"
                    :sin-esperado="sinEsperado"
                    @hecho="alCerrar"
                />
            </template>
        </div>
        <CajaCrearModal
            v-if="puede('cajas.crear')"
            v-model:open="altaAbierta"
            @hecho="alCrear"
        />
    </PanelPagina>
</template>
