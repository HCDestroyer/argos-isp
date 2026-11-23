<script setup lang="ts">
/**
 * Panel de detalle a la derecha de una lista (tableros OperComprobantes, OperPromesas, OperFacturas,
 * OperBitacora, OperUsuarios): tarjeta isla con encabezado fijo (icono en pastilla, título,
 * subtítulo y una insignia), cuerpo que se desplaza dentro y pie fijo con las acciones.
 */
withDefaults(defineProps<{
    titulo?: string
    subtitulo?: string
    icono?: string
    /** Tono de la pastilla del icono (`tono-marca`, `tono-exito`, `tono-aviso`, `tono-error`). */
    tono?: string
    /** Título en monoespaciada (número de factura, código de servicio). */
    tituloMono?: boolean
}>(), {
    titulo: undefined,
    subtitulo: undefined,
    icono: undefined,
    tono: 'tono-marca',
    tituloMono: false,
})
</script>

<template>
    <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem]">
        <header
            v-if="titulo || $slots.encabezado"
            class="flex items-start gap-3 border-b border-(--ax-borde) p-4"
        >
            <slot name="encabezado">
                <span
                    v-if="icono"
                    class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                    :class="tono"
                >
                    <UIcon
                        :name="icono"
                        class="size-5"
                    />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                    <h2
                        class="truncate text-lg font-bold text-highlighted"
                        :class="tituloMono ? 'font-mono' : ''"
                    >
                        {{ titulo }}
                    </h2>
                    <p
                        v-if="subtitulo"
                        class="truncate text-[0.8125rem] text-muted"
                    >
                        {{ subtitulo }}
                    </p>
                </div>
                <slot name="insignia" />
            </slot>
        </header>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
            <slot />
        </div>
        <footer
            v-if="$slots.pie"
            class="flex flex-wrap items-center gap-2 border-t border-(--ax-borde) p-4"
        >
            <slot name="pie" />
        </footer>
    </section>
</template>
