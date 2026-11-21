<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Planes (tablero RedPlanes): tarjeta con buscador, pestañas por tipo (Todos, Residencial,
 * Empresarial, Dedicado), filtro por router y «En venta»; cada fila con su velocidad, reuso y
 * garantía, dónde se ofrece y precio. Al lado, el plan elegido con lo que recibe el router
 * (calculado por la API, `POST /planes/vista-previa`), «Sincronizar» y «Editar» (formulario en
 * página, `/planes/:id/editar`). «Nuevo plan» abre `/planes/nuevo`; «Prioridad (QoS)» lleva a
 * `/red/qos`. La columna «Clientes» del tablero no va: la API no da cuántos servicios tiene cada
 * plan (pedido en `.claude/integration/a4.md`).
 */
definePageMeta({ permiso: 'planes.ver' })

useHead({ title: 'Planes · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const TODOS = 'todos'
const tipo = ref<string>(esTipoPlan(route.query.tipo) ? route.query.tipo : TODOS)
const routerFiltro = ref<string>(typeof route.query.router === 'string' ? route.query.router : TODOS)
const enVenta = ref(route.query.venta === '1')
const busqueda = ref('')

watch([tipo, routerFiltro, enVenta], ([t, r, v]) => void router.replace({ query: { ...(t !== TODOS ? { tipo: t } : {}), ...(r !== TODOS ? { router: r } : {}), ...(v ? { venta: '1' } : {}) } }))

const planes = shallowRef<Plan[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const routers = shallowRef<RouterNas[]>([])

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await leerTodas(cursor => usePlanes().listar({
        limit: 200,
        ...(enVenta.value ? { activo: true } : {}),
        ...(routerFiltro.value !== TODOS ? { router_id: Number(routerFiltro.value) } : {}),
    }, cursor))
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    planes.value = resultado.data.filas
}

onMounted(async () => {
    void cargar()
    if (puede('routers.ver')) {
        const resultado = await leerTodas(cursor => useRouters().listar({ activo: true, limit: 200 }, cursor))
        routers.value = resultado.ok ? resultado.data.filas : []
    }
})
watch([routerFiltro, enVenta], () => void cargar())

const nombreRouter = computed(() => new Map(routers.value.map(r => [r.id, r.nombre])))

const filas = computed(() => {
    const texto = busqueda.value.trim().toLowerCase()
    return planes.value.filter(p => (tipo.value === TODOS || p.tipo === tipo.value) && (!texto || p.nombre.toLowerCase().includes(texto)))
})

function cuantos(valor: string): number {
    return planes.value.filter(p => valor === TODOS || p.tipo === valor).length
}

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Todos', value: TODOS, badge: { label: String(cuantos(TODOS)), color: 'neutral', variant: 'soft' } },
    ...(['residencial', 'empresarial', 'dedicado'] as const).map(valor => ({ label: TIPOS_PLAN[valor].etiqueta, value: valor, badge: { label: String(cuantos(valor)), color: 'neutral' as const, variant: 'soft' as const } })),
])

const itemsRouter = computed<SelectItem[]>(() => [{ label: 'Todos los routers', value: TODOS, icon: 'i-lucide-router' }, ...routers.value.map(r => ({ label: r.nombre, value: String(r.id) }))])

const columnas: TableColumn<Plan>[] = [
    { accessorKey: 'nombre', header: 'Plan', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'velocidad', header: 'Bajada / subida' },
    { id: 'reparto', header: 'Reuso · garantía', meta: SOLO_ESCRITORIO },
    { id: 'donde', header: 'Dónde se ofrece', meta: SOLO_ESCRITORIO },
    { accessorKey: 'precio', header: 'Precio', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { id: 'ir', header: '', meta: { class: { td: 'w-0' } } },
]

const ICONO_TIPO: Record<string, { icono: string, tono: string }> = {
    residencial: { icono: 'i-lucide-house', tono: 'bg-(--ax-panel) text-muted' },
    empresarial: { icono: 'i-lucide-building', tono: 'tono-marca' },
    dedicado: { icono: 'i-lucide-cable', tono: 'tono-2' },
}

function velocidadCorta(kbps: number): string {
    return kbps % 1000 === 0 ? String(kbps / 1000) : (kbps / 1000).toFixed(1)
}

function garantia(plan: Plan): string {
    const pct = plan.garantizado_pct ?? (plan.reuso ? 100 / plan.reuso : null)
    return pct === null ? '—' : `${Math.round(Number(pct) * 10) / 10} %`
}

function donde(plan: Plan): { texto: string, global: boolean } {
    if (plan.global) {
        return { texto: 'Todos los routers', global: true }
    }
    if (!plan.routers.length) {
        return { texto: 'En ningún router', global: false }
    }
    return { texto: plan.routers.map(id => nombreRouter.value.get(id) ?? `Router ${id}`).join(', '), global: false }
}

const elegido = shallowRef<Plan | null>(null)
watch(filas, (lista) => {
    if (!elegido.value || !lista.some(p => p.id === elegido.value?.id)) {
        elegido.value = lista[0] ?? null
    }
})
const detalleAbierto = ref(false)
function elegir(_evento: Event, fila: { original: Plan }) {
    elegido.value = fila.original
    detalleAbierto.value = true
}

const sincronizarAbierto = ref(false)
</script>

<template>
    <PanelPagina
        id="planes"
        titulo="Planes"
        icono="i-lucide-gauge"
        :descripcion="cargando ? 'Leyendo planes…' : `${planes.length} planes${enVenta ? ' en venta' : ''}`"
    >
        <template #acciones>
            <UButton
                v-if="puede('qos.ver')"
                to="/red/qos"
                label="Prioridad (QoS)"
                icon="i-lucide-list-ordered"
                color="neutral"
                variant="outline"
                class="hidden rounded-full sm:inline-flex"
            />
            <UButton
                v-if="puede('planes.crear')"
                to="/planes/nuevo"
                label="Nuevo plan"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand hidden rounded-full px-5 sm:inline-flex"
                data-prueba="nuevo-plan"
            />
        </template>

        <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
            <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
                <div class="flex flex-col gap-3 p-3 sm:p-4 2xl:flex-row 2xl:items-center">
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Buscar plan…"
                        aria-label="Buscar plan"
                        class="w-full 2xl:w-48"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <RedPestanas
                        v-model="tipo"
                        :items="pestanas"
                        etiqueta="Tipo de plan"
                        data-prueba="pestanas-planes"
                    />
                    <div class="flex flex-wrap items-center gap-2 2xl:ms-auto">
                        <USelect
                            v-if="routers.length"
                            v-model="routerFiltro"
                            :items="itemsRouter"
                            aria-label="Filtrar por router"
                            class="w-48"
                        />
                        <UButton
                            label="En venta"
                            :icon="enVenta ? 'i-lucide-check' : undefined"
                            :color="enVenta ? 'primary' : 'neutral'"
                            :variant="enVenta ? 'soft' : 'outline'"
                            :aria-pressed="enVenta"
                            class="rounded-full"
                            data-prueba="solo-en-venta"
                            @click="enVenta = !enVenta"
                        />
                    </div>
                </div>

                <div
                    v-if="problema"
                    class="p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        :problema="problema"
                        :reintentar="cargar"
                        :reintentando="cargando"
                    />
                </div>
                <UTable
                    v-else
                    :data="filas"
                    :columns="columnas"
                    :loading="cargando"
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3', tr: 'cursor-pointer' }"
                    data-prueba="tabla-planes"
                    @select="elegir"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 items-center gap-3"
                            :class="elegido?.id === row.original.id ? 'xl:-ms-1 xl:border-s-2 xl:border-primary xl:ps-2' : ''"
                        >
                            <span
                                class="pastilla-icono pastilla-tono size-9 shrink-0 rounded-xl"
                                :class="ICONO_TIPO[row.original.tipo]?.tono"
                            >
                                <UIcon
                                    :name="ICONO_TIPO[row.original.tipo]?.icono ?? 'i-lucide-gauge'"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="`/planes/${row.original.id}`"
                                    class="font-semibold text-highlighted hover:text-primary"
                                >{{ row.original.nombre }}</ULink>
                                <span class="text-xs text-muted">
                                    <span :data-tipo-plan="row.original.tipo">{{ TIPOS_PLAN[row.original.tipo]?.etiqueta }}</span>
                                    <span v-if="!row.original.activo"> · no en venta</span>
                                </span>
                            </div>
                        </div>
                    </template>
                    <template #velocidad-cell="{ row }">
                        <span class="text-sm whitespace-nowrap"><span class="font-semibold text-highlighted">{{ velocidadCorta(row.original.bajada_kbps) }} / {{ velocidadCorta(row.original.subida_kbps) }}</span> <span class="text-muted">Mbps</span></span>
                    </template>
                    <template #reparto-cell="{ row }">
                        <span class="text-sm">1:{{ row.original.reuso }} <span class="text-muted">· {{ garantia(row.original) }}</span></span>
                    </template>
                    <template #donde-cell="{ row }">
                        <span class="flex items-center gap-1.5 text-sm">
                            <UIcon
                                :name="donde(row.original).global ? 'i-lucide-globe' : 'i-lucide-router'"
                                class="size-4 shrink-0"
                                :class="donde(row.original).global ? 'text-success' : 'text-primary'"
                            />
                            <span class="truncate">{{ donde(row.original).texto }}</span>
                        </span>
                    </template>
                    <template #precio-cell="{ row }">
                        <span class="font-semibold whitespace-nowrap text-highlighted">{{ formatearQuetzales(row.original.precio) }}</span>
                    </template>
                    <template #ir-cell="{ row }">
                        <UButton
                            :to="`/planes/${row.original.id}`"
                            icon="i-lucide-chevron-right"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="rounded-full"
                            :aria-label="`Abrir ${row.original.nombre}`"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-gauge"
                            :title="busqueda || tipo !== TODOS ? 'Ningún plan coincide' : 'Todavía no hay planes'"
                            :actions="puede('planes.crear') && !busqueda && tipo === TODOS && !cargando ? [{ label: 'Crear el primer plan', icon: 'i-lucide-plus', to: '/planes/nuevo' }] : undefined"
                            variant="naked"
                        />
                    </template>
                </UTable>
                <div class="mt-auto flex items-center justify-between border-t border-(--ax-borde) px-3 py-2.5 text-xs text-muted sm:px-4">
                    <span>{{ filas.length }} planes</span>
                    <span>Orden: por nombre</span>
                </div>
            </div>

            <aside
                v-if="elegido"
                class="surface-card hidden h-fit flex-col overflow-hidden rounded-2xl xl:flex"
                aria-label="Plan elegido"
                data-prueba="detalle-plan"
            >
                <RedPlanDetalle
                    :plan="elegido"
                    :router-nombres="nombreRouter"
                    @sincronizar="sincronizarAbierto = true"
                />
            </aside>
        </div>

        <USlideover
            v-if="elegido"
            v-model:open="detalleAbierto"
            :title="elegido.nombre"
            :description="TIPOS_PLAN[elegido.tipo]?.etiqueta"
            class="xl:hidden"
        >
            <template #body>
                <RedPlanDetalle
                    :plan="elegido"
                    :router-nombres="nombreRouter"
                    sin-encabezado
                    @sincronizar="sincronizarAbierto = true"
                />
            </template>
        </USlideover>

        <SincronizarPlanModal
            v-if="elegido && puede('planes.sincronizar')"
            v-model:open="sincronizarAbierto"
            :plan="elegido"
        />

        <RedBarraTelefono v-if="puede('planes.crear')">
            <UButton
                to="/planes/nuevo"
                label="Nuevo plan"
                icon="i-lucide-plus"
                size="lg"
                block
                class="rounded-full"
            />
        </RedBarraTelefono>
    </PanelPagina>
</template>
