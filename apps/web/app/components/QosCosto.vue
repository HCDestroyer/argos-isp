<script setup lang="ts">
/**
 * Costo de QoS de un router (`contratos/qos.md` §3.4): hojas del árbol contra el límite, con su estado
 * en icono + texto + color, y las reglas de mangle y tipos de cola extra.
 */
const props = defineProps<{
    uso: Pick<UsoPerfilQos, 'hojas' | 'limite_hojas' | 'planes_qos' | 'clases' | 'reglas_mangle' | 'tipos_cola'>
    /** Solo la barra y las hojas (listas). */
    corto?: boolean
}>()

const porcentaje = computed(() => (props.uso.limite_hojas > 0 ? Math.round((props.uso.hojas / props.uso.limite_hojas) * 100) : 0))
const estado = computed(() => estadoOcupacion(porcentaje.value))
</script>

<template>
    <div
        class="flex min-w-40 flex-col gap-1"
        data-prueba="qos-costo"
    >
        <UProgress
            :model-value="Math.min(100, porcentaje)"
            :color="estado.color"
            size="sm"
            :aria-label="`Hojas de QoS: ${uso.hojas} de ${uso.limite_hojas}`"
        />
        <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
                class="flex items-center gap-1 font-medium tabular-nums"
                :class="{ 'text-success': estado.color === 'success', 'text-warning': estado.color === 'warning', 'text-error': estado.color === 'error' }"
            >
                <UIcon
                    :name="estado.icono"
                    class="size-3.5 shrink-0"
                />
                {{ uso.hojas.toLocaleString('es-GT') }} / {{ uso.limite_hojas.toLocaleString('es-GT') }} hojas
            </span>
            <span
                v-if="!corto"
                class="text-muted tabular-nums"
            >{{ uso.planes_qos }} {{ uso.planes_qos === 1 ? 'plan' : 'planes' }} con QoS × 4 × {{ uso.clases }} clases · {{ uso.reglas_mangle.toLocaleString('es-GT') }} reglas de mangle por familia · {{ uso.tipos_cola }} tipos de cola</span>
        </p>
    </div>
</template>
