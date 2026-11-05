<script setup lang="ts">
/**
 * De dónde viene una promesa (contrato Iris 0.6.0 §7.3 y §7.4): su tipo (promesa o reconexión
 * temporal), el canal (`ia`, `operador`…), si la pidió Iris (`sistema_origen`) y el comprobante
 * que la respalda. El motivo de una cancelada lo muestra `EvaluacionPromesa` (su `cierre`).
 */
const props = defineProps<{
    promesa: Promesa
}>()

const { enlace } = usePermisos()

const tipo = computed(() => TIPOS_PROMESA[tipoPromesa(props.promesa)])
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-1"
        data-prueba="promesa-origen"
    >
        <div class="flex flex-wrap items-center gap-1">
            <UBadge
                :label="tipo.etiqueta"
                :icon="tipo.icono"
                :color="tipo.color"
                variant="outline"
                size="sm"
                data-prueba="tipo-promesa"
            />
            <UBadge
                v-if="promesa.sistema_origen === 'iris'"
                label="Iris"
                icon="i-lucide-messages-square"
                color="info"
                variant="subtle"
                size="sm"
                data-prueba="promesa-iris"
            />
            <span class="text-xs text-muted">{{ CANALES_PROMESA[promesa.canal] }} <span class="font-mono">({{ promesa.canal }})</span></span>
        </div>
        <ULink
            v-if="promesa.comprobante_id"
            :to="enlace(`/comprobantes/${promesa.comprobante_id}`)"
            class="text-xs text-muted hover:text-primary"
            data-prueba="promesa-comprobante"
        >Comprobante #{{ promesa.comprobante_id }}</ULink>
    </div>
</template>
