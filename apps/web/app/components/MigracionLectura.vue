<script setup lang="ts">
/**
 * Cuerpo de un indicador de "Migración de router": el número (slot) solo con la lectura `ok`;
 * si no, el motivo (cargando, sin permiso, error con "Reintentar" o lista demasiado grande).
 */
defineProps<{
    lectura: LecturaMigracion<unknown>
}>()

const emit = defineEmits<{
    reintentar: []
}>()
</script>

<template>
    <slot v-if="lectura.estado === 'ok'" />
    <USkeleton
        v-else-if="lectura.estado === 'cargando'"
        class="h-8 w-20"
    />
    <p
        v-else-if="lectura.estado === 'sin_permiso'"
        class="text-sm text-muted"
    >
        Sin permiso {{ lectura.permiso }}.
    </p>
    <p
        v-else-if="lectura.estado === 'incompleta'"
        class="text-sm text-muted"
    >
        Demasiadas filas para contarlas aquí (más de {{ MAXIMO_PAGINAS * 200 }}); falta un resumen en la API.
    </p>
    <ProblemaAlerta
        v-else
        :problema="lectura.problema"
        :reintentar="() => emit('reintentar')"
    />
</template>
