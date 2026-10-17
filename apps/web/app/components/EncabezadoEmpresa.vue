<script setup lang="ts">
/**
 * Encabezado de una sección agrupada por empresa (ficha del cliente, cobro): logo o iniciales,
 * nombre comercial y NIT de la empresa. Sin empresa conocida, lo dice.
 */
const props = withDefaults(defineProps<{
    empresaId: number | null
    /** Texto a la derecha (p. ej. el pendiente de esa empresa). */
    detalle?: string
    nivel?: 'h3' | 'h4'
}>(), {
    detalle: undefined,
    nivel: 'h3',
})

const { empresas, empresaId: activa } = useEmpresaActiva()
const empresa = computed(() => empresas.value.find(e => e.id === props.empresaId) ?? null)
/**
 * Sin empresa conocida: con una empresa elegida en el selector, es de otra (sus servicios no se
 * listan en esta empresa); con "Todas", no se pudo saber.
 */
const nombre = computed(() => empresa.value?.nombre_comercial
    ?? (props.empresaId !== null ? `Empresa ${props.empresaId}` : activa.value !== null ? 'Otras empresas' : 'Empresa sin identificar'))
</script>

<template>
    <div
        class="flex flex-wrap items-center justify-between gap-2"
        :data-empresa="empresaId ?? 'ninguna'"
    >
        <div class="flex min-w-0 items-center gap-2">
            <UAvatar
                :src="urlLogoEmpresa(empresa?.logo_url)"
                :alt="nombre"
                size="xs"
            />
            <component
                :is="nivel"
                class="truncate text-sm font-semibold text-highlighted"
            >
                {{ nombre }}
            </component>
            <span
                v-if="empresa?.nit"
                class="font-mono text-xs text-muted"
            >NIT {{ empresa.nit }}</span>
        </div>
        <span
            v-if="detalle"
            class="text-sm tabular-nums text-muted"
        >{{ detalle }}</span>
    </div>
</template>
