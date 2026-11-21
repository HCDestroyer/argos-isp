<script setup lang="ts">
/**
 * Vista rápida maestro-detalle (sistema visual Argos): panel lateral con el resumen de una fila
 * sin salir de la lista. Cabecera con avatar, título, subtítulo y estado; cuerpo libre (métricas
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
        :ui="{ content: 'max-w-md', body: 'flex flex-col gap-5', footer: 'justify-end gap-2' }"
    >
        <template #header>
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <AvatarIniciales
                    v-if="avatar"
                    :nombre="avatar"
                    size="xl"
                />
                <span
                    v-else
                    class="pastilla-icono tono-marca pastilla-tono size-11"
                >
                    <UIcon
                        :name="icono"
                        class="size-5"
                    />
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2 class="truncate text-base font-bold text-highlighted">
                        {{ titulo }}
                    </h2>
                    <p
                        v-if="subtitulo"
                        class="truncate text-sm text-muted"
                    >
                        {{ subtitulo }}
                    </p>
                    <div
                        v-if="$slots.estado"
                        class="mt-1 flex flex-wrap gap-1.5"
                    >
                        <slot name="estado" />
                    </div>
                </div>
                <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    aria-label="Cerrar vista rápida"
                    class="self-start"
                    @click="abierto = false"
                />
            </div>
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
