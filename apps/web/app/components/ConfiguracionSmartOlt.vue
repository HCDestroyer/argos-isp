<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración › Integraciones › SmartOLT (tableros PendSmartoltLista y PendSmartoltMovil): las
 * cuentas (instancias, subdominios) de SmartOLT de la empresa activa y las compartidas, con su
 * estado, sus OLT y la última prueba. «Agregar instancia» abre el formulario en su página; cada fila
 * abre el detalle. Vacía y con error («Reintentar», sin números inventados) como en el tablero.
 */
const emit = defineEmits<{ cambio: [instancias: InstanciaSmartOlt[]] }>()

const { puede, enlace } = usePermisos()
const { eleccion, empresaId, nombre } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)

const instancias = shallowRef<InstanciaSmartOlt[] | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const filtro = ref<'todas' | 'compartidas' | 'falla'>('todas')
const busqueda = ref('')

async function cargar() {
    problema.value = null
    if (enTodas.value || !puede('smartolt.ver')) {
        instancias.value = null
        return
    }
    cargando.value = true
    const r = await useSmartOlt().listar()
    cargando.value = false
    instancias.value = r.ok ? r.data : null
    problema.value = r.ok ? null : r.problema
    if (r.ok) {
        emit('cambio', r.data)
    }
}

const conteos = computed(() => {
    const lista = instancias.value ?? []
    return { todas: lista.length, compartidas: lista.filter(i => i.compartida).length, falla: lista.filter(i => i.prueba_ok === false).length }
})

const filtros = computed(() => [
    { label: 'Todas', value: 'todas', icon: 'i-lucide-server', badge: conteos.value.todas },
    { label: 'Compartidas', value: 'compartidas', icon: 'i-lucide-globe', badge: conteos.value.compartidas },
    { label: 'Con falla', value: 'falla', icon: 'i-lucide-triangle-alert', badge: conteos.value.falla },
])

const visibles = computed(() => {
    const texto = normalizarBusqueda(busqueda.value.trim())
    return (instancias.value ?? [])
        .filter(i => filtro.value === 'todas' || (filtro.value === 'compartidas' ? i.compartida : i.prueba_ok === false))
        .filter(i => !texto || normalizarBusqueda(`${i.nombre} ${i.url}`).includes(texto))
})

function oltsDe(i: InstanciaSmartOlt): string {
    return i.olts_sincronizadas_en || i.olts.length ? String(i.olts.length) : '—'
}

watch(empresaId, cargar)
onMounted(cargar)
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-3"
        data-prueba="smartolt-lista"
    >
        <div class="flex flex-wrap items-center gap-3">
            <span class="pastilla-icono pastilla-tono tono-marca">
                <UIcon
                    name="i-lucide-server"
                    class="size-5"
                />
            </span>
            <div class="min-w-0 flex-1">
                <h2 class="text-base font-bold text-highlighted">
                    SmartOLT
                </h2>
                <p class="text-sm text-muted">
                    Las cuentas de SmartOLT que usa Argos para autorizar ONU y ver su estado
                </p>
            </div>
            <UButton
                v-if="puede('smartolt.crear_instancia') && !enTodas && instancias?.length"
                to="/configuracion/integraciones/smartolt/nueva"
                label="Agregar instancia"
                icon="i-lucide-plus"
                class="glow-brand"
                data-prueba="agregar-instancia"
            />
        </div>

        <UAlert
            v-if="enTodas"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Las cuentas de SmartOLT se ven por empresa (más las compartidas): elige una en el selector de empresa de arriba."
            data-prueba="smartolt-elige-empresa"
        />
        <div
            v-else-if="problema"
            class="flex flex-col items-center gap-3 px-4 py-10 text-center"
            data-prueba="smartolt-error"
        >
            <span class="pastilla-icono pastilla-tono tono-error size-16 rounded-2xl">
                <UIcon
                    name="i-lucide-triangle-alert"
                    class="size-8"
                />
            </span>
            <p class="text-lg font-bold text-highlighted">
                No se pudo leer la lista de instancias
            </p>
            <p class="max-w-md text-sm text-muted">
                Argos no pudo traer los datos. No mostramos números ni estados hasta poder leerlos. Tus instancias no se tocaron.
            </p>
            <p class="text-xs text-muted">
                {{ problema.detail ?? problema.title }}
            </p>
            <UButton
                label="Reintentar"
                icon="i-lucide-refresh-cw"
                :loading="cargando"
                data-prueba="smartolt-reintentar"
                @click="cargar"
            />
        </div>
        <USkeleton
            v-else-if="!instancias"
            class="h-48 w-full"
        />
        <div
            v-else-if="!instancias.length"
            class="flex flex-col items-center gap-3 px-4 py-10 text-center"
            data-prueba="smartolt-vacia"
        >
            <span class="pastilla-icono pastilla-tono tono-marca size-16 rounded-2xl">
                <UIcon
                    name="i-lucide-server"
                    class="size-8"
                />
            </span>
            <p class="text-lg font-bold text-highlighted">
                Todavía no hay cuentas de SmartOLT
            </p>
            <p class="max-w-md text-sm text-muted">
                Agrega la cuenta (subdominio y token) de tu SmartOLT para autorizar ONU y ver su estado desde Argos. Puedes agregar varias si tienes más de una.
            </p>
            <UButton
                v-if="puede('smartolt.crear_instancia')"
                to="/configuracion/integraciones/smartolt/nueva"
                label="Agregar instancia"
                icon="i-lucide-plus"
                class="glow-brand"
                data-prueba="agregar-instancia"
            />
            <p class="text-sm text-muted">
                ¿Solo necesitas Wi-Fi y PPPoE de la ONU? Eso va por el
                <ULink
                    :to="enlace('/configuracion/integraciones?ver=acs')"
                    class="font-semibold text-primary"
                >ACS</ULink>, aparte.
            </p>
        </div>
        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <RedPestanas
                    v-model="filtro"
                    :items="filtros"
                    etiqueta="Filtrar instancias"
                    data-prueba="smartolt-filtros"
                />
                <UInput
                    v-if="instancias.length > 6"
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Buscar instancia…"
                    class="ms-auto w-full sm:w-72"
                    data-prueba="smartolt-buscar"
                />
            </div>
            <UAlert
                color="info"
                variant="subtle"
                icon="i-lucide-info"
                data-prueba="smartolt-aviso"
            >
                <template #description>
                    Cada instancia es una cuenta de SmartOLT (un subdominio). Una puede ser <b>compartida</b> entre empresas y solo la administra quien tiene acceso a todas. Wi-Fi y PPPoE de la ONU no se configuran aquí: eso lo hace el <b>ACS</b>.
                </template>
            </UAlert>
            <div class="flex flex-col overflow-hidden rounded-xl border border-(--ax-borde)">
                <div class="hidden grid-cols-[2.5rem_minmax(0,1.25fr)_minmax(0,1.1fr)_9rem_4.5rem_7.5rem_1.25rem] gap-3 bg-(--ax-cabecera-tabla) px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid">
                    <span />
                    <span>Instancia</span>
                    <span>Empresas</span>
                    <span>Estado</span>
                    <span>OLT</span>
                    <span>Última prueba</span>
                    <span />
                </div>
                <ULink
                    v-for="i in visibles"
                    :key="i.id"
                    :to="`/configuracion/integraciones/smartolt/${i.id}`"
                    class="grid grid-cols-[2.5rem_minmax(0,1fr)_1.25rem] items-center gap-x-3 gap-y-1 border-t border-(--ax-borde) px-4 py-3 first:border-t-0 hover:bg-(--ax-fila-hover) lg:grid-cols-[2.5rem_minmax(0,1.25fr)_minmax(0,1.1fr)_9rem_4.5rem_7.5rem_1.25rem]"
                    :data-instancia="i.id"
                >
                    <span
                        class="pastilla-icono pastilla-tono"
                        :class="i.prueba_ok === false ? 'tono-error' : i.prueba_ok ? 'tono-exito' : 'tono-neutro'"
                    >
                        <UIcon
                            name="i-lucide-server"
                            class="size-4.5"
                        />
                    </span>
                    <div class="min-w-0">
                        <p class="truncate font-semibold text-highlighted">
                            {{ i.nombre }}
                        </p>
                        <p class="truncate font-mono text-xs text-muted">
                            {{ hostDe(i.url) }}
                        </p>
                    </div>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-4 text-dimmed lg:order-last"
                    />
                    <div class="col-start-2 min-w-0 lg:col-start-auto">
                        <UBadge
                            v-if="i.compartida"
                            label="Compartida"
                            icon="i-lucide-globe"
                            color="info"
                            variant="subtle"
                            size="sm"
                        />
                        <span
                            v-else
                            class="truncate text-sm"
                        >{{ nombre(i.empresa_id) }}</span>
                    </div>
                    <div class="col-start-2 flex flex-wrap items-center gap-x-2 lg:col-start-auto lg:flex-col lg:items-start">
                        <UBadge
                            :label="estadoInstancia(i).etiqueta"
                            :icon="estadoInstancia(i).icono"
                            :color="estadoInstancia(i).color"
                            variant="subtle"
                            size="sm"
                            :data-prueba="`estado-instancia-${i.id}`"
                        />
                        <span
                            v-if="!i.activo"
                            class="inline-flex items-center gap-1 text-xs text-muted"
                        ><UIcon
                            name="i-lucide-power"
                            class="size-3"
                        />Apagada</span>
                    </div>
                    <span class="col-start-2 text-sm lg:col-start-auto"><b class="tabular-nums">{{ oltsDe(i) }}</b> <span class="text-muted">OLT</span></span>
                    <span class="col-start-2 text-sm text-muted lg:col-start-auto">{{ i.probado_en ? formatearFechaHora(i.probado_en) : 'Nunca' }}</span>
                </ULink>
                <p
                    v-if="!visibles.length"
                    class="px-4 py-6 text-center text-sm text-muted"
                >
                    Ninguna instancia con ese filtro.
                </p>
            </div>
        </template>
    </section>
</template>
