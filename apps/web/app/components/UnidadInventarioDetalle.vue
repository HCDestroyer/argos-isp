<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha de un equipo por serie o MAC (tablero NuevoInventario, A48 `GET /inventario/unidades/:id`):
 * estado con dónde o con quién está, costo y condición, y el historial completo (cambios de estado,
 * kardex, garantías, intentos de recuperación y contactos). Abajo, las acciones que permite su
 * estado y los permisos de quien mira; elegir una cierra el panel y abre su ventana (`accion`), así
 * nunca hay una ventana encima de otra.
 */
const props = defineProps<{
    unidadId: number | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ accion: [accion: AccionEquipo, unidad: UnidadInventarioDetalle] }>()

const { puede, enlace } = usePermisos()
const unidad = shallowRef<UnidadInventarioDetalle | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    if (!props.unidadId) {
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useUnidadesInventario().ver(props.unidadId)
    cargando.value = false
    unidad.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => [abierto.value, props.unidadId], () => {
    if (abierto.value) {
        void cargar()
    }
}, { immediate: true })

defineExpose({ cargar })

const estado = computed(() => (unidad.value ? ESTADOS_EQUIPO[estadoEquipoDe(unidad.value)] : null))
const eventos = computed(() => (unidad.value ? lineaTiempoUnidad(unidad.value) : []))
const acciones = computed(() => (unidad.value ? accionesEquipo(unidad.value, puede) : []))
const garantiaAbierta = computed(() => unidad.value?.garantias.find(g => g.resuelta_en === null) ?? null)

function elegir(accion: AccionEquipo) {
    const actual = unidad.value
    if (!actual) {
        return
    }
    abierto.value = false
    emit('accion', accion, actual)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :ui="{ content: 'sm:max-w-lg', body: 'flex flex-col gap-5' }"
    >
        <template #title>
            <span class="flex items-center gap-3">
                <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                    <UIcon
                        name="i-lucide-barcode"
                        class="size-5"
                    />
                </span>
                <span class="flex min-w-0 flex-col">
                    <span class="truncate">{{ unidad?.producto_nombre ?? 'Equipo' }}</span>
                    <span
                        v-if="unidad"
                        class="truncate font-mono text-xs font-normal text-muted"
                    >{{ identificacionUnidad(unidad) }}</span>
                </span>
            </span>
        </template>
        <template #description>
            <span class="sr-only">Estado, costo e historial del equipo</span>
        </template>
        <template #body>
            <USkeleton
                v-if="cargando && !unidad"
                class="h-40 w-full"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="unidad && estado">
                <div
                    class="flex flex-wrap items-center gap-2"
                    data-prueba="unidad-detalle"
                >
                    <UBadge
                        :label="estado.etiqueta"
                        :icon="estado.icono"
                        :color="estado.color"
                        variant="subtle"
                        class="rounded-full"
                        data-prueba="unidad-estado"
                    />
                    <ULink
                        v-if="unidad.servicio_id"
                        :to="enlace(`/servicios/${unidad.servicio_id}#equipos`)"
                        class="text-sm text-highlighted hover:text-primary"
                    >Servicio #{{ unidad.servicio_id }}</ULink>
                    <span
                        v-else-if="unidad.bodega_nombre"
                        class="text-sm text-highlighted"
                    >{{ unidad.bodega_nombre }}</span>
                    <span
                        v-if="garantiaAbierta?.proveedor_nombre"
                        class="text-sm text-muted"
                    >· {{ garantiaAbierta.proveedor_nombre }}{{ garantiaAbierta.rma ? ` · RMA ${garantiaAbierta.rma}` : '' }}</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-[0.8125rem] text-muted">
                            Costo
                        </p>
                        <p class="text-lg font-bold tabular-nums text-highlighted">
                            {{ formatearQuetzales(unidad.costo) }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-[0.8125rem] text-muted">
                            Condición
                        </p>
                        <p class="text-lg font-bold text-highlighted">
                            {{ CONDICIONES_UNIDAD[unidad.condicion] }}
                        </p>
                    </div>
                </div>
                <section class="flex flex-col gap-3">
                    <h3 class="text-xs font-bold uppercase tracking-wide text-muted">
                        Historial
                    </h3>
                    <ol
                        class="flex flex-col gap-3"
                        data-prueba="unidad-historial"
                    >
                        <li
                            v-for="evento in eventos"
                            :key="evento.clave"
                            class="flex items-start gap-3"
                        >
                            <span
                                class="pastilla-icono pastilla-tono size-8 shrink-0 rounded-lg"
                                :class="evento.tono"
                            >
                                <UIcon
                                    :name="evento.icono"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm font-semibold text-highlighted">{{ evento.titulo }}</span>
                                <span class="text-xs text-muted">{{ formatearFechaCorta(evento.fecha) }}{{ evento.detalle ? ` · ${evento.detalle}` : '' }}</span>
                            </div>
                        </li>
                        <li
                            v-if="!eventos.length"
                            class="text-sm text-muted"
                        >
                            Sin movimientos todavía.
                        </li>
                    </ol>
                </section>
            </template>
        </template>
        <template
            v-if="acciones.length"
            #footer
        >
            <div
                class="flex w-full flex-wrap gap-2"
                data-prueba="unidad-acciones"
            >
                <UButton
                    v-for="(accion, i) in acciones"
                    :key="accion"
                    :label="ACCIONES_EQUIPO[accion].etiqueta"
                    :icon="ACCIONES_EQUIPO[accion].icono"
                    :color="ACCIONES_EQUIPO[accion].color ?? (i === 0 ? 'primary' : 'neutral')"
                    :variant="i === 0 && !ACCIONES_EQUIPO[accion].color ? 'solid' : 'outline'"
                    class="rounded-full"
                    :data-accion-equipo="accion"
                    @click="elegir(accion)"
                />
            </div>
        </template>
    </USlideover>
</template>
