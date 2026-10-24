<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Historial de un equipo por serie o MAC (A3, `GET /inventario/unidades/:id`): estado, ubicación,
 * costo y cada movimiento. Con `inventario.marcar_reparada`, una unidad en reparación vuelve a
 * disponible (con motivo).
 */
const props = defineProps<{
    unidadId: number | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ cambiada: [unidad: UnidadInventario] }>()

const { puede, enlace } = usePermisos()
const unidad = shallowRef<UnidadInventarioHistorial | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const reparadaAbierto = ref(false)

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

function marcarReparada(motivo: string): Promise<Resultado<UnidadInventario>> {
    return useUnidadesInventario().marcarReparada(props.unidadId ?? 0, motivo)
}

function alReparar(cambiada: UnidadInventario) {
    emit('cambiada', cambiada)
    void cargar()
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="unidad ? identificacionUnidad(unidad) : 'Equipo'"
        :description="unidad ? `${unidad.producto_nombre} · ${unidad.producto_sku}` : undefined"
        :ui="{ content: 'sm:max-w-lg' }"
    >
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
            <div
                v-else-if="unidad"
                class="flex flex-col gap-5"
                data-prueba="unidad-detalle"
            >
                <dl class="grid grid-cols-2 gap-4">
                    <DatoFicha etiqueta="Estado">
                        <UBadge
                            :label="ESTADOS_UNIDAD[unidad.estado].etiqueta"
                            :icon="ESTADOS_UNIDAD[unidad.estado].icono"
                            :color="ESTADOS_UNIDAD[unidad.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Condición"
                        :valor="CONDICIONES_UNIDAD[unidad.condicion]"
                    />
                    <DatoFicha
                        etiqueta="Costo"
                        :valor="formatearQuetzales(unidad.costo)"
                    />
                    <DatoFicha etiqueta="Dónde está">
                        <ULink
                            v-if="unidad.servicio_id"
                            :to="enlace(`/servicios/${unidad.servicio_id}`)"
                            class="text-primary"
                        >Servicio #{{ unidad.servicio_id }}</ULink>
                        <span v-else>{{ unidad.bodega_nombre ?? '—' }}</span>
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Serie"
                        :valor="unidad.serie"
                        mono
                    />
                    <DatoFicha
                        etiqueta="MAC"
                        :valor="unidad.mac"
                        mono
                    />
                </dl>
                <UButton
                    v-if="unidad.estado === 'en_reparacion' && puede('inventario.marcar_reparada')"
                    label="Marcar reparada"
                    icon="i-lucide-wrench"
                    color="success"
                    variant="outline"
                    class="self-start"
                    data-prueba="unidad-reparada"
                    @click="reparadaAbierto = true"
                />
                <section class="flex flex-col gap-2">
                    <h3 class="text-sm font-medium text-highlighted">
                        Historial
                    </h3>
                    <ol
                        class="flex flex-col gap-2"
                        data-prueba="unidad-historial"
                    >
                        <li
                            v-for="m in unidad.historial"
                            :key="m.id"
                            class="flex flex-col gap-0.5 rounded-md border border-default p-2.5 text-sm"
                        >
                            <span class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-medium text-highlighted">{{ TIPOS_MOVIMIENTO_INVENTARIO[m.tipo] }}</span>
                                <span class="text-xs text-muted tabular-nums">{{ formatearFecha(m.fecha) }}</span>
                            </span>
                            <span class="text-xs text-muted">{{ m.bodega_nombre }} · {{ formatearQuetzales(m.costo_total) }}<template v-if="m.servicio_id">
                                · servicio #{{ m.servicio_id }}
                            </template></span>
                            <span
                                v-if="m.motivo"
                                class="text-xs text-muted"
                            >{{ m.motivo }}</span>
                        </li>
                    </ol>
                </section>
            </div>
            <AccionMotivoModal
                v-model:open="reparadaAbierto"
                titulo="Marcar reparada"
                efecto="El equipo vuelve a disponible en su bodega; se puede prestar otra vez."
                confirmar="Marcar reparada"
                icono="i-lucide-wrench"
                color="success"
                placeholder="Ej.: se cambió el adaptador de corriente"
                :ejecutar="motivo => marcarReparada(motivo)"
                @hecho="alReparar"
            />
        </template>
    </USlideover>
</template>
