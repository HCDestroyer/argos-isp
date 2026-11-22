<script setup lang="ts">
/**
 * Botón de ayuda `?` junto a un concepto (promesa de pago, vencimiento, puntos, comprobante): al
 * tocarlo abre una explicación corta tomada del manual (`utils/ayudas.ts`). Popover y no tooltip:
 * en el teléfono no hay "pasar el puntero". Cursor `help`, 44 px de área táctil y `aria-label`.
 */
const props = defineProps<{
    clave: ClaveAyuda
}>()

const ayuda = computed(() => AYUDAS[props.clave])
</script>

<template>
    <UPopover :content="{ side: 'top', align: 'center' }">
        <UButton
            icon="i-lucide-circle-help"
            color="neutral"
            variant="ghost"
            size="xs"
            class="-my-2 rounded-full text-muted"
            data-cursor="help"
            :aria-label="ayuda.titulo"
            :data-testid="`ayuda-${props.clave}`"
        />
        <template #content>
            <div class="flex max-w-72 flex-col gap-1 p-3">
                <p class="text-sm font-semibold text-highlighted">
                    {{ ayuda.titulo }}
                </p>
                <p class="text-sm text-muted">
                    {{ ayuda.texto }}
                </p>
            </div>
        </template>
    </UPopover>
</template>
