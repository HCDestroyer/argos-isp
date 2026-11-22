<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

/**
 * Elección del router en el alta de un servicio (tablero NuevoAltaCliente, paso «Servicio»):
 * sugeridos arriba (los de la zona del cliente y los últimos usados; con 4 routers o menos, todos)
 * y un buscador con lista desplegable que sirve igual con 2 o con 50 routers. En el teléfono la
 * lista se abre en una hoja a pantalla completa con su buscador.
 *
 * Cada opción muestra nombre, zona (o host), tipo de conexión, si está en línea y las IP libres de
 * sus redes IPv4 (`GET /routers/:id/redes-ipv4`, con `redes.ver`; mientras A1 no las dé en la
 * lista de routers, `.claude/integration/a4.md`). Un router sin IP libres (o, sin PPPoE, sin redes
 * IPv4) se ve deshabilitado con el motivo escrito. Lo que no se pudo leer no se inventa: sin
 * ocupación, la opción no dice cuántas quedan ni se deshabilita.
 */
const props = withDefaults(defineProps<{
    routers: RouterNas[]
    zonas?: Zona[]
    /** Zona del cliente: sus routers salen primero como sugeridos. */
    zonaClienteId?: number | null
}>(), {
    zonas: () => [],
    zonaClienteId: null,
})

const modelo = defineModel<number>({ required: true })

const { puede } = usePermisos()

const CLAVE_RECIENTES = 'argos:alta:routers-recientes'

interface Ocupacion {
    redes: number
    libres: number
    total: number
}

/** IP libres por router (suma de sus redes IPv4); sin leer, no hay entrada. */
const ocupacion = shallowRef(new Map<number, Ocupacion>())

async function cargarOcupacion(lista: RouterNas[]) {
    if (!puede('redes.ver') || !lista.length) {
        return
    }
    const api = useRouters()
    const resultados = await Promise.all(lista.map(async r => [r.id, await api.redesIpv4(r.id)] as const))
    const mapa = new Map<number, Ocupacion>()
    for (const [id, resultado] of resultados) {
        if (resultado.ok) {
            mapa.set(id, {
                redes: resultado.data.length,
                libres: resultado.data.reduce((suma, red) => suma + red.ocupacion.libres, 0),
                total: resultado.data.reduce((suma, red) => suma + red.ocupacion.total, 0),
            })
        }
    }
    ocupacion.value = mapa
}

watch(() => props.routers, lista => void cargarOcupacion(lista), { immediate: true })

/** Por qué no se puede elegir; `null` si se puede (o si no se pudo leer su ocupación). */
function motivoBloqueo(router: RouterNas): string | null {
    const o = ocupacion.value.get(router.id)
    if (!o) {
        return null
    }
    if (o.redes === 0) {
        return router.tipo_conexion === 'pppoe' ? null : 'Sin redes IPv4: regístralas en la ficha del router'
    }
    return o.libres === 0 ? 'Sin IP libres: sus redes IPv4 están llenas' : null
}

function textoLibres(router: RouterNas): string | null {
    const o = ocupacion.value.get(router.id)
    if (!o || o.redes === 0) {
        return null
    }
    return o.libres === 0 ? 'Sin IP libres' : `${o.libres} de ${o.total} libres`
}

/** Pocas IP libres (menos del 10 %): en ámbar. */
function pocasLibres(router: RouterNas): boolean {
    const o = ocupacion.value.get(router.id)
    return Boolean(o && o.libres > 0 && o.libres * 10 < o.total)
}

function zonaDe(router: RouterNas): string | null {
    return props.zonas.find(z => z.id === router.zona_id)?.nombre ?? null
}

function estadoConexion(router: RouterNas): { texto: string, punto: string } {
    if (router.en_linea === true) {
        return { texto: 'En línea', punto: 'bg-success' }
    }
    if (router.en_linea === false) {
        return { texto: 'Sin conexión', punto: 'bg-error' }
    }
    return { texto: 'Sin dato de conexión', punto: 'bg-(--ui-text-dimmed)' }
}

function detalle(router: RouterNas): string {
    const radius = esSinRadius(router) ? `sin RADIUS${tieneCredencialesApi(router) ? '' : ' (sin credenciales de la API)'}` : null
    return [zonaDe(router) ?? router.host, TIPOS_CONEXION[router.tipo_conexion].corta, radius, estadoConexion(router).texto].filter(Boolean).join(' · ')
}

function esDeLaZona(router: RouterNas): boolean {
    return props.zonaClienteId !== null && router.zona_id === props.zonaClienteId
}

/** Habilitados primero (en el orden de la API); los que no se pueden elegir, al final. */
const ordenados = computed(() => [...props.routers].sort((a, b) => Number(Boolean(motivoBloqueo(a))) - Number(Boolean(motivoBloqueo(b)))))

interface OpcionRouter {
    label: string
    disabled: boolean
    value: number
    buscar: string
    router: RouterNas
    motivo: string | null
}

const opciones = computed<OpcionRouter[]>(() => ordenados.value.map((router) => {
    const motivo = motivoBloqueo(router)
    return {
        label: router.nombre,
        value: router.id,
        buscar: [router.nombre, zonaDe(router), router.host, TIPOS_CONEXION[router.tipo_conexion].etiqueta].filter(Boolean).join(' '),
        disabled: Boolean(motivo),
        router,
        motivo,
    }
}))

const elegido = computed(() => props.routers.find(r => r.id === modelo.value) ?? null)

/*
| Sugeridos: los de la zona del cliente, luego los últimos usados en este navegador; con 4 routers
| o menos, todos (quien tiene pocos sigue eligiendo de un toque).
*/
const recientes = ref<number[]>([])

onMounted(() => {
    try {
        const crudo = JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? '[]') as unknown
        recientes.value = Array.isArray(crudo) ? crudo.filter((id): id is number => typeof id === 'number') : []
    }
    catch {
        recientes.value = []
    }
})

watch(modelo, (id) => {
    if (!id) {
        return
    }
    recientes.value = [id, ...recientes.value.filter(r => r !== id)].slice(0, 5)
    try {
        localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(recientes.value))
    }
    catch {
        // Sin almacenamiento (ventana privada): los sugeridos salen solo por zona.
    }
})

const sugeridos = computed(() => {
    const elegibles = ordenados.value.filter(r => !motivoBloqueo(r))
    if (elegibles.length <= 4) {
        return elegibles
    }
    const lista: RouterNas[] = []
    const agregar = (router: RouterNas | undefined) => {
        if (router && !lista.includes(router) && lista.length < 3) {
            lista.push(router)
        }
    }
    elegibles.filter(esDeLaZona).forEach(agregar)
    recientes.value.forEach(id => agregar(elegibles.find(r => r.id === id)))
    return lista
})

/* Teléfono: hoja a pantalla completa con su buscador. */
function opcionDe(item: CommandPaletteItem): OpcionRouter | undefined {
    return opciones.value.find(o => o.value === item.routerId)
}

const hojaAbierta = ref(false)

const grupos = computed<CommandPaletteGroup[]>(() => [{
    id: 'routers',
    items: opciones.value.map(opcion => ({
        label: opcion.label,
        suffix: opcion.buscar,
        disabled: opcion.disabled,
        routerId: opcion.value,
        onSelect: () => {
            modelo.value = opcion.value
            hojaAbierta.value = false
        },
    })),
}])
</script>

<template>
    <div
        class="flex flex-col gap-2"
        data-prueba="selector-router"
    >
        <div
            v-if="sugeridos.length"
            class="flex flex-wrap items-center gap-2"
            data-prueba="routers-sugeridos"
        >
            <span class="text-xs text-muted">{{ routers.length <= 4 ? 'Routers' : 'Sugeridos' }}</span>
            <UButton
                v-for="router in sugeridos"
                :key="router.id"
                :color="router.id === modelo ? 'primary' : 'neutral'"
                :variant="router.id === modelo ? 'soft' : 'outline'"
                size="sm"
                class="rounded-full"
                :aria-pressed="router.id === modelo"
                :data-router-id="router.id"
                @click="modelo = router.id"
            >
                <span
                    class="size-2 shrink-0 rounded-full"
                    :class="estadoConexion(router).punto"
                    aria-hidden="true"
                />
                {{ router.nombre }}
                <span
                    v-if="esDeLaZona(router)"
                    class="font-normal text-primary"
                >· zona del cliente</span>
            </UButton>
        </div>

        <!-- Escritorio: lista desplegable con buscador. -->
        <USelectMenu
            v-model="modelo"
            :items="opciones"
            value-key="value"
            :filter-fields="['buscar']"
            :search-input="{ placeholder: 'Buscar por nombre, zona o tipo', icon: 'i-lucide-search' }"
            placeholder="Elige el router"
            size="xl"
            class="hidden w-full sm:flex"
            :ui="{ content: 'min-w-(--reka-select-trigger-width) max-h-[26rem]', item: 'items-center py-2', itemLabel: 'whitespace-normal' }"
            aria-label="Router"
            data-prueba="selector-router-menu"
        >
            <template #default>
                <span
                    v-if="elegido"
                    class="flex min-w-0 items-center gap-3 text-start"
                >
                    <span class="relative shrink-0">
                        <span class="pastilla-icono pastilla-tono tono-marca size-8 rounded-lg">
                            <UIcon
                                name="i-lucide-router"
                                class="size-4"
                            />
                        </span>
                        <span
                            class="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-(--ax-tarjeta)"
                            :class="estadoConexion(elegido).punto"
                        />
                    </span>
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate text-sm font-semibold text-highlighted">{{ elegido.nombre }}</span>
                        <span class="truncate text-xs text-muted">{{ detalle(elegido) }}{{ textoLibres(elegido) ? ` · ${textoLibres(elegido)}` : '' }}</span>
                    </span>
                </span>
                <span
                    v-else
                    class="text-dimmed"
                >Elige el router ({{ routers.length }})</span>
            </template>
            <template #item-leading="{ item }">
                <span class="relative shrink-0">
                    <span class="pastilla-icono size-8 rounded-lg bg-(--ax-panel) text-muted">
                        <UIcon
                            name="i-lucide-router"
                            class="size-4"
                        />
                    </span>
                    <span
                        class="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-(--ax-tarjeta)"
                        :class="estadoConexion(item.router).punto"
                        :title="estadoConexion(item.router).texto"
                    />
                </span>
            </template>
            <template #item-label="{ item }">
                <span
                    class="flex min-w-0 flex-col"
                    :data-router-id="item.value"
                >
                    <span class="flex items-center gap-1.5">
                        <span class="font-semibold text-highlighted">{{ item.label }}</span>
                        <UBadge
                            v-if="esDeLaZona(item.router)"
                            label="zona del cliente"
                            color="primary"
                            variant="subtle"
                            size="sm"
                            class="rounded-full"
                        />
                    </span>
                    <span class="truncate text-xs text-muted">{{ detalle(item.router) }}</span>
                    <span
                        v-if="item.motivo"
                        class="text-xs text-error"
                    >{{ item.motivo }}</span>
                </span>
            </template>
            <template #item-trailing="{ item }">
                <span
                    v-if="textoLibres(item.router)"
                    class="whitespace-nowrap text-xs tabular-nums"
                    :class="item.motivo ? 'font-semibold text-error' : pocasLibres(item.router) ? 'font-semibold text-warning' : 'text-muted'"
                >{{ textoLibres(item.router) }}</span>
            </template>
            <template #empty="{ searchTerm }">
                Ningún router coincide con «{{ searchTerm }}».
            </template>
        </USelectMenu>

        <!-- Teléfono: el mismo buscador en una hoja a pantalla completa. -->
        <UButton
            color="neutral"
            variant="outline"
            size="xl"
            block
            trailing-icon="i-lucide-chevron-down"
            class="justify-between sm:hidden"
            :aria-label="elegido ? `Router: ${elegido.nombre}. Cambiar` : 'Elegir router'"
            data-prueba="selector-router-hoja"
            @click="hojaAbierta = true"
        >
            <span
                v-if="elegido"
                class="flex min-w-0 flex-col text-start"
            >
                <span class="truncate text-sm font-semibold text-highlighted">{{ elegido.nombre }}</span>
                <span class="truncate text-xs font-normal text-muted">{{ TIPOS_CONEXION[elegido.tipo_conexion].corta }}{{ textoLibres(elegido) ? ` · ${textoLibres(elegido)}` : '' }}</span>
            </span>
            <span
                v-else
                class="text-dimmed"
            >Elige el router ({{ routers.length }})</span>
        </UButton>
        <UModal
            v-model:open="hojaAbierta"
            fullscreen
            title="Elegir router"
            :description="`${routers.length} routers`"
        >
            <template #body>
                <UCommandPalette
                    :groups="grupos"
                    :fuse="{ fuseOptions: { keys: ['label', 'suffix'] } }"
                    placeholder="Buscar por nombre, zona o tipo"
                    class="h-full"
                    :ui="{ itemTrailing: 'hidden', itemLabelSuffix: 'hidden' }"
                >
                    <template #item-leading="{ item }">
                        <span
                            v-if="opcionDe(item)"
                            class="size-2.5 shrink-0 rounded-full"
                            :class="estadoConexion(opcionDe(item)!.router).punto"
                        />
                    </template>
                    <template #item-label="{ item }">
                        <span
                            v-if="opcionDe(item)"
                            class="flex min-w-0 flex-1 items-center gap-2"
                            :data-router-id="item.routerId"
                        >
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="font-semibold text-highlighted">{{ item.label }}</span>
                                <span class="truncate text-xs text-muted">{{ detalle(opcionDe(item)!.router) }}</span>
                                <span
                                    v-if="opcionDe(item)!.motivo"
                                    class="text-xs text-error"
                                >{{ opcionDe(item)!.motivo }}</span>
                            </span>
                            <span
                                v-if="textoLibres(opcionDe(item)!.router)"
                                class="whitespace-nowrap text-xs tabular-nums"
                                :class="opcionDe(item)!.motivo ? 'text-error' : 'text-muted'"
                            >{{ textoLibres(opcionDe(item)!.router) }}</span>
                        </span>
                    </template>
                </UCommandPalette>
            </template>
        </UModal>
    </div>
</template>
