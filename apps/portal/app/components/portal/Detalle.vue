<script setup lang="ts">
/**
 * Drawer de detalle (factura, pago, comprobante): se abre sobre la lista sin salir de ella, a la
 * derecha en escritorio y desde abajo en el teléfono. Los datos van como pares etiqueta/valor
 * (`datos`) y lo demás (DTE, acciones) en el slot por defecto y en `pie`.
 */
const props = withDefaults(defineProps<{
    titulo: string
    descripcion?: string
    icono: string
    tono?: TonoPastilla
    datos?: { etiqueta: string, valor: string, mono?: boolean, copiable?: boolean }[]
}>(), {
    descripcion: undefined,
    tono: 'primary',
    datos: () => [],
})

const open = defineModel<boolean>('open', { default: false })

const telefono = useEsTelefono()
</script>

<template>
    <USlideover
        v-model:open="open"
        :title="props.titulo"
        :description="props.descripcion"
        :side="telefono ? 'bottom' : 'right'"
        :ui="{ content: telefono ? 'max-h-[88dvh] rounded-t-(--ax-radio-modal) pb-[env(safe-area-inset-bottom)]' : 'max-w-md' }"
    >
        <template #title>
            <PortalTituloModal
                :texto="props.titulo"
                :icono="props.icono"
                :tono="props.tono"
            />
        </template>
        <template #body>
            <div
                class="flex flex-col gap-5"
                data-testid="detalle"
            >
                <dl
                    v-if="props.datos.length > 0"
                    class="ax-lista divide-y divide-(--ax-borde)"
                >
                    <div
                        v-for="dato in props.datos"
                        :key="dato.etiqueta"
                        class="flex items-start justify-between gap-4 px-4 py-3"
                    >
                        <dt class="text-sm text-muted">
                            {{ dato.etiqueta }}
                        </dt>
                        <dd
                            class="text-end text-sm break-all text-highlighted"
                            :class="dato.mono ? 'font-mono' : 'font-medium tabular-nums'"
                            :data-cursor="dato.copiable ? 'copy' : undefined"
                        >
                            {{ dato.valor }}
                        </dd>
                    </div>
                </dl>
                <slot />
            </div>
        </template>
        <template
            v-if="$slots.pie"
            #footer
        >
            <div class="flex w-full flex-wrap justify-end gap-2">
                <slot name="pie" />
            </div>
        </template>
    </USlideover>
</template>
