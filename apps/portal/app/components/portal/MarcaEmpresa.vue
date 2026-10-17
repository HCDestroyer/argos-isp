<script setup lang="ts">
/**
 * Logo de la empresa que factura (multiempresa): la imagen de `logo_url` (mismo origen del portal,
 * `/api/v1/portal/empresas/:id/logo`) o, sin logo o si no carga, sus iniciales. En la barra
 * superior con una sola empresa sin logo se conserva el ojo de ArgosIsp (`respaldo="argos"`).
 *
 * Decorativo: el nombre de la empresa va siempre en texto al lado.
 */
const props = withDefaults(defineProps<{
    nombre: string
    logoUrl?: string | null
    respaldo?: 'iniciales' | 'argos'
}>(), {
    logoUrl: null,
    respaldo: 'iniciales',
})

const fallo = ref(false)
watch(() => props.logoUrl, () => {
    fallo.value = false
})

const iniciales = computed(() => props.nombre
    .split(/\s+/)
    .filter(parte => /^[\p{L}\p{N}]/u.test(parte))
    .slice(0, 2)
    .map(parte => parte[0]!.toUpperCase())
    .join('') || '·')
</script>

<template>
    <span
        class="inline-flex shrink-0 items-center justify-center overflow-hidden"
        aria-hidden="true"
        data-testid="marca-empresa"
    >
        <img
            v-if="props.logoUrl && !fallo"
            :src="props.logoUrl"
            alt=""
            class="size-full rounded-md object-contain"
            decoding="async"
            @error="fallo = true"
        >
        <LogoArgos
            v-else-if="props.respaldo === 'argos'"
            class="size-full"
        />
        <span
            v-else
            class="flex size-full items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary ring ring-inset ring-primary/25"
        >
            {{ iniciales }}
        </span>
    </span>
</template>
