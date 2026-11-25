<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Promociones de velocidad (decisiones del PM 18 y 34; tableros PendPromociones y
 * PendPromocionesMovil): pestaña junto a «Planes» en Red › Planes. Tarjeta con Vigentes,
 * Programadas, Terminadas y Canceladas (conteos de la API), buscador y la lista; a la derecha
 * (desde 1280 px) el detalle con sus servicios. En pantallas más angostas cada promoción abre su
 * página (`/planes/promociones/:id`). «Nueva promoción» va a su página (más de 3 campos).
 */
definePageMeta({ permiso: 'promociones_velocidad.ver' })

useHead({ title: 'Promociones de velocidad · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const vigencia = ref<VigenciaPromocion>(esVigenciaPromocion(route.query.vigencia) ? route.query.vigencia : 'vigente')
const busqueda = ref(typeof route.query.q === 'string' ? route.query.q : '')

const promociones = shallowRef<PromocionVelocidad[]>([])
const conteos = ref<PaginaPromocionesVelocidad['conteos'] | null>(null)
const siguiente = ref<string | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
let turno = 0

async function cargar(mas = false) {
    const mio = ++turno
    cargando.value = true
    problema.value = null
    const texto = busqueda.value.trim()
    const resultado = await usePromocionesVelocidad().listar({ vigencia: vigencia.value, ...(texto ? { q: texto } : {}) }, mas ? siguiente.value ?? undefined : undefined)
    if (mio !== turno) {
        return
    }
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        if (!mas) {
            promociones.value = []
            conteos.value = null
        }
        return
    }
    promociones.value = mas ? [...promociones.value, ...resultado.data.data] : resultado.data.data
    conteos.value = resultado.data.conteos
    siguiente.value = resultado.data.nextCursor
}

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void cargar(), 250)
})
watch(vigencia, () => void cargar())
watch([vigencia, busqueda], ([v, q]) => void router.replace({ query: { ...route.query, vigencia: v === 'vigente' ? undefined : v, q: q.trim() || undefined } }))
onMounted(() => void cargar())
onBeforeUnmount(() => clearTimeout(espera))

const pestanas = computed<TabsItem[]>(() => VIGENCIAS_PROMOCION.map(v => ({
    label: PESTANAS_PROMOCION[v].etiqueta,
    value: v,
    icon: PESTANAS_PROMOCION[v].icono,
    ...(conteos.value ? { badge: { label: String(conteos.value[v]), color: 'neutral' as const, variant: 'soft' as const } } : {}),
})))

/* Detalle a la derecha (desde `xl`): la elegida, o la primera de la pestaña. */
const elegidaId = ref<number | null>(Number(route.query.promocion) || null)
const elegida = computed(() => promociones.value.find(p => p.id === elegidaId.value) ?? promociones.value[0] ?? null)
const esAncho = ref(false)
let consultaAncho: MediaQueryList | null = null
const alCambiarAncho = (evento: MediaQueryListEvent) => {
    esAncho.value = evento.matches
}
onMounted(() => {
    consultaAncho = window.matchMedia('(min-width: 1280px)')
    esAncho.value = consultaAncho.matches
    consultaAncho.addEventListener('change', alCambiarAncho)
})
onBeforeUnmount(() => consultaAncho?.removeEventListener('change', alCambiarAncho))

function elegir(_evento: Event, fila: { original: PromocionVelocidad }) {
    if (esAncho.value) {
        elegidaId.value = fila.original.id
        void router.replace({ query: { ...route.query, promocion: String(fila.original.id) } })
        return
    }
    void navigateTo(`/planes/promociones/${fila.original.id}`)
}

/** Asignar, quitar o cancelar cambian conteos y estados: se relee la pestaña. */
function alCambiar(promocion: PromocionVelocidad) {
    promociones.value = promociones.value.map(p => (p.id === promocion.id ? promocion : p))
    void cargar()
}

const SOLO_SIN_DETALLE = { class: { th: 'hidden lg:table-cell xl:hidden 2xl:table-cell', td: 'hidden lg:table-cell xl:hidden 2xl:table-cell' } }

const columnas: TableColumn<PromocionVelocidad>[] = [
    { id: 'promocion', header: 'Promoción', meta: { class: { td: 'whitespace-normal max-w-60' } } },
    { id: 'velocidad', header: 'Velocidad' },
    // De 1280 a 1535 px el periodo y el precio se leen en el detalle de la derecha (no caben con él).
    { id: 'periodo', header: 'Periodo y horario', meta: SOLO_SIN_DETALLE },
    { id: 'precio', header: 'Precio', meta: SOLO_SIN_DETALLE },
    { id: 'servicios', header: 'Servicios' },
    { id: 'estado', header: 'Estado' },
]
</script>

<template>
    <PanelPagina
        id="promociones-velocidad"
        titulo="Promociones de velocidad"
        icono="i-lucide-zap"
        descripcion="Más velocidad por días o en horas fijas, sin cortar la sesión"
    >
        <template #acciones>
            <UButton
                v-if="puede('promociones_velocidad.crear')"
                to="/planes/promociones/nueva"
                label="Nueva promoción"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand hidden rounded-full px-5 sm:inline-flex"
                data-prueba="nueva-promocion"
            />
        </template>

        <PlanesSecciones actual="promociones" />

        <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
                <div class="flex flex-col gap-3 p-3 sm:p-4 2xl:flex-row 2xl:items-center">
                    <RedPestanas
                        v-model="vigencia"
                        :items="pestanas"
                        etiqueta="Promociones por vigencia"
                        data-prueba="pestanas-promociones"
                    />
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Buscar promoción…"
                        aria-label="Buscar promoción"
                        class="w-full sm:w-72 2xl:ms-auto 2xl:w-60"
                        :ui="{ base: 'rounded-full' }"
                    />
                </div>

                <div
                    v-if="problema"
                    class="p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        :problema="problema"
                        :reintentar="() => cargar()"
                        :reintentando="cargando"
                    />
                </div>
                <template v-else>
                    <!-- Teléfono (tablero PendPromocionesMovil): tarjetas que abren el detalle. -->
                    <ul
                        class="flex flex-col gap-2 px-3 pb-3 sm:hidden"
                        data-prueba="lista-promociones-movil"
                    >
                        <li
                            v-for="p in promociones"
                            :key="p.id"
                        >
                            <ULink
                                :to="`/planes/promociones/${p.id}`"
                                class="flex flex-col gap-1.5 rounded-2xl border border-(--ax-borde) p-3"
                            >
                                <span class="flex items-center gap-2">
                                    <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                        <UIcon
                                            name="i-lucide-zap"
                                            class="size-4"
                                        />
                                    </span>
                                    <span class="min-w-0 flex-1 truncate font-semibold text-highlighted">{{ p.nombre }}</span>
                                    <span class="font-bold text-highlighted">{{ velocidadCortaPromocion(p) }}</span>
                                </span>
                                <span class="text-xs text-muted">{{ periodoPromocion(p) }} · {{ horarioPromocion(p) }}</span>
                                <span class="flex items-center justify-between gap-2">
                                    <UBadge
                                        :label="estadoPromocion(p).etiqueta"
                                        :icon="estadoPromocion(p).icono"
                                        :color="estadoPromocion(p).color"
                                        variant="subtle"
                                        size="sm"
                                        class="rounded-full"
                                    />
                                    <span class="text-xs text-muted">{{ p.servicios === 1 ? '1 servicio' : `${p.servicios} servicios` }} · {{ precioPromocion(p) }}</span>
                                </span>
                            </ULink>
                        </li>
                        <li
                            v-if="!cargando && !promociones.length"
                            class="py-6 text-center text-sm text-muted"
                        >
                            {{ busqueda ? 'Ninguna promoción coincide.' : `No hay promociones ${PESTANAS_PROMOCION[vigencia].etiqueta.toLowerCase()}.` }}
                        </li>
                    </ul>

                    <UTable
                        :data="promociones"
                        :columns="columnas"
                        :loading="cargando"
                        class="hidden sm:block"
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3', tr: 'cursor-pointer' }"
                        data-prueba="tabla-promociones"
                        @select="elegir"
                    >
                        <template #promocion-cell="{ row }">
                            <div
                                class="flex min-w-0 items-center gap-3"
                                :class="esAncho && elegida?.id === row.original.id ? '-ms-1 border-s-2 border-primary ps-2' : ''"
                            >
                                <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-xl">
                                    <UIcon
                                        name="i-lucide-zap"
                                        class="size-4"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <span class="truncate font-semibold text-highlighted">{{ row.original.nombre }}</span>
                                    <span class="truncate text-xs text-muted">{{ row.original.descripcion ?? '' }}</span>
                                </div>
                            </div>
                        </template>
                        <template #velocidad-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="font-semibold text-highlighted">{{ velocidadCortaPromocion(row.original) }}</span>
                                <span class="text-xs text-muted">{{ cuandoPromocion(row.original) }}</span>
                            </div>
                        </template>
                        <template #periodo-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm text-highlighted">{{ periodoPromocion(row.original) }}</span>
                                <span class="text-xs text-muted">{{ horarioPromocion(row.original) }}</span>
                            </div>
                        </template>
                        <template #precio-cell="{ row }">
                            <span class="text-sm whitespace-nowrap">{{ precioPromocion(row.original) }}</span>
                        </template>
                        <template #servicios-cell="{ row }">
                            <span class="text-sm whitespace-nowrap"><strong class="text-highlighted">{{ row.original.servicios }}</strong> <span class="text-muted">serv.</span></span>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="estadoPromocion(row.original).etiqueta"
                                :icon="estadoPromocion(row.original).icono"
                                :color="estadoPromocion(row.original).color"
                                variant="subtle"
                                class="rounded-full"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-zap"
                                :title="busqueda ? 'Ninguna promoción coincide' : `No hay promociones ${PESTANAS_PROMOCION[vigencia].etiqueta.toLowerCase()}`"
                                :actions="puede('promociones_velocidad.crear') && !busqueda && vigencia === 'vigente' && !cargando ? [{ label: 'Crear una promoción', icon: 'i-lucide-plus', to: '/planes/promociones/nueva' }] : undefined"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <div
                        v-if="siguiente"
                        class="flex justify-center p-2"
                    >
                        <UButton
                            label="Cargar más"
                            color="neutral"
                            variant="ghost"
                            :loading="cargando"
                            @click="cargar(true)"
                        />
                    </div>
                </template>
                <p class="mt-auto flex items-center gap-1.5 border-t border-(--ax-borde) px-3 py-2.5 text-xs text-muted sm:px-4">
                    <UIcon
                        name="i-lucide-info"
                        class="size-3.5 shrink-0"
                    />
                    Las horas son de Guatemala. Una promoción nunca baja la velocidad ni el precio del plan.
                </p>
            </div>

            <aside
                v-if="elegida && esAncho"
                class="surface-card flex h-fit min-w-0 flex-col overflow-clip rounded-2xl"
                aria-label="Promoción elegida"
            >
                <PromocionDetalle
                    :promocion="elegida"
                    @cambiada="alCambiar"
                />
            </aside>
        </div>

        <RedBarraTelefono v-if="puede('promociones_velocidad.crear')">
            <UButton
                to="/planes/promociones/nueva"
                label="Nueva promoción"
                icon="i-lucide-plus"
                size="lg"
                block
                class="rounded-full"
            />
        </RedBarraTelefono>
    </PanelPagina>
</template>
