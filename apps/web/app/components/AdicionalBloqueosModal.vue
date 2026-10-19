<script setup lang="ts">
/**
 * Historial de bloqueos de un adicional (A1, `contratos/adicionales.md`, "Servicio suspendido"):
 * suspender el servicio lo bloquea y reactivarlo lo desbloquea. Nadie lo pone a mano; aquí solo se
 * consulta (`servicios.ver`), del más reciente al más viejo.
 */
const props = defineProps<{
    servicioId: number
    asignacion: AdicionalServicio
}>()

const abierto = defineModel<boolean>('open', { default: false })

const lista = usePaginacionCursor(cursor => useAdicionalesServicio().bloqueos(props.servicioId, props.asignacion.id, cursor))

watch(abierto, (valor) => {
    if (valor) {
        void lista.recargar()
    }
}, { immediate: true })
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Bloqueos de ${asignacion.adicional_nombre}`"
        :description="asignacion.identificador ?? asignacion.adicional_codigo"
    >
        <template #body>
            <div
                class="flex flex-col gap-3"
                data-prueba="historial-bloqueos"
            >
                <p class="text-sm text-muted">
                    El adicional se bloquea solo cuando el servicio se suspende y se desbloquea al reactivarlo.
                </p>
                <ProblemaAlerta
                    v-if="lista.problema.value"
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                />
                <template v-else>
                    <div
                        v-if="lista.cargando.value && !lista.filas.value.length"
                        class="flex flex-col gap-2"
                    >
                        <USkeleton class="h-12 w-full" />
                        <USkeleton class="h-12 w-full" />
                    </div>
                    <UEmpty
                        v-else-if="!lista.filas.value.length"
                        icon="i-lucide-lock-open"
                        title="Nunca se ha bloqueado"
                        description="El servicio no ha estado suspendido desde que tiene este adicional."
                        variant="naked"
                    />
                    <ol
                        v-else
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                    >
                        <li
                            v-for="bloqueo in lista.filas.value"
                            :key="bloqueo.id"
                            class="flex flex-col gap-1 p-3"
                            :data-bloqueo="bloqueo.accion"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <UBadge
                                    :label="ACCIONES_BLOQUEO_ADICIONAL[bloqueo.accion].etiqueta"
                                    :icon="ACCIONES_BLOQUEO_ADICIONAL[bloqueo.accion].icono"
                                    :color="ACCIONES_BLOQUEO_ADICIONAL[bloqueo.accion].color"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span class="text-xs tabular-nums text-muted">{{ formatearFechaHora(bloqueo.created_at) }}</span>
                            </div>
                            <p class="flex flex-wrap items-center gap-1.5 text-sm text-default">
                                Servicio
                                <EstadoServicioBadge :estado="bloqueo.estado_servicio" />
                            </p>
                            <p
                                v-if="bloqueo.motivo"
                                class="text-xs text-muted"
                            >
                                {{ bloqueo.motivo }}
                            </p>
                        </li>
                    </ol>
                    <PaginacionCursor
                        v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                        :pagina="lista.pagina.value"
                        :hay-anterior="lista.hayAnterior.value"
                        :hay-siguiente="lista.haySiguiente.value"
                        :cargando="lista.cargando.value"
                        @anterior="lista.anterior"
                        @siguiente="lista.siguiente"
                    />
                </template>
            </div>
        </template>
    </UModal>
</template>
