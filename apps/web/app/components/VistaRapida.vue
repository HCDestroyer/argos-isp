<script setup lang="ts">
/**
 * Vista rápida maestro-detalle (sistema visual Argos, tablero NuevoClientes): tarjeta flotante a la
 * derecha que no le quita espacio a la lista (sin velo ni bloqueo: la lista sigue usable) y se
 * cierra con Esc o con la ×. Cabecera con avatar, título, subtítulo y estado; cuerpo libre (métricas
 * en `.metrica-rapida`, pares etiqueta/valor con `DatoFicha`); pie con las acciones. Los
 * formularios largos siguen en su propia página.
 */
withDefaults(defineProps<{
    titulo: string
    subtitulo?: string
    /** Nombre para el avatar de iniciales; sin él, el icono. */
    avatar?: string
    icono?: string
    cargando?: boolean
}>(), {
    subtitulo: undefined,
    avatar: undefined,
    icono: 'i-lucide-panel-right',
    cargando: false,
})

const abierto = defineModel<boolean>('open', { default: false })
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="titulo"
        :description="subtitulo ?? 'Vista rápida'"
        :overlay="false"
        :modal="false"
        inset
        :ui="{
            content: 'max-w-sm rounded-[1.375rem] bg-(--ax-tarjeta) ring ring-(--ax-borde) shadow-(--ax-sombra-flotante) sm:max-w-[21.25rem]',
            header: 'items-start border-0 px-5 pt-5 pb-0',
            title: 'flex flex-col',
            description: 'mt-0',
            close: 'top-4 end-4',
            body: 'flex flex-col gap-4 px-5 py-4',
            footer: 'flex-col items-stretch gap-2 border-0 px-5 pt-0 pb-5',
        }"
        data-prueba="vista-rapida"
    >
        <!-- Título y descripción en los slots de Nuxt UI: el diálogo conserva su nombre accesible. -->
        <template #title>
            <span class="mb-4 block text-xs font-bold tracking-[0.06em] text-muted uppercase">Vista rápida</span>
            <span class="flex min-w-0 items-center gap-3">
                <AvatarIniciales
                    v-if="avatar"
                    :nombre="avatar"
                    size="3xl"
                />
                <span
                    v-else
                    class="pastilla-icono tono-marca pastilla-tono size-14"
                >
                    <UIcon
                        :name="icono"
                        class="size-6"
                    />
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                    <span class="truncate text-lg font-bold text-highlighted">{{ titulo }}</span>
                    <span
                        v-if="subtitulo"
                        class="truncate text-[0.8125rem] font-normal text-muted"
                    >{{ subtitulo }}</span>
                </span>
            </span>
        </template>
        <template #description>
            <span
                v-if="$slots.estado"
                class="mt-4 flex flex-wrap gap-1.5"
            >
                <slot name="estado" />
            </span>
            <span
                v-else
                class="sr-only"
            >Vista rápida</span>
        </template>

        <template #body>
            <div
                v-if="cargando"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-20 w-full" />
                <USkeleton class="h-40 w-full" />
            </div>
            <slot v-else />
        </template>

        <template
            v-if="$slots.acciones"
            #footer
        >
            <slot name="acciones" />
        </template>
    </USlideover>
</template>
