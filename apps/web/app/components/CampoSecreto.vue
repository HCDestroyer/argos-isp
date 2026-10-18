<script setup lang="ts">
/**
 * Un secreto que la API nunca devuelve (`***`): se muestra vacío con "Guardado" y solo se puede
 * reemplazar o borrar. Sin tocarlo, el campo no viaja y la API lo conserva.
 */
const props = withDefaults(defineProps<{
    /** Lo que dijo la API: `***` hay uno guardado, `null` no hay. */
    guardado: '***' | null
    etiqueta: string
    nombre: string
    disabled?: boolean
    placeholder?: string
}>(), {
    disabled: false,
    placeholder: undefined,
})

const secreto = defineModel<Secreto>({ required: true })

const hay = computed(() => props.guardado === '***')
</script>

<template>
    <UFormField
        :name="nombre"
        :label="etiqueta"
    >
        <template #hint>
            <UBadge
                v-if="secreto.accion === 'borrar'"
                label="Se borrará al guardar"
                icon="i-lucide-trash-2"
                color="warning"
                variant="subtle"
                size="sm"
            />
            <UBadge
                v-else-if="hay && secreto.accion === 'conservar'"
                label="Guardado"
                icon="i-lucide-lock"
                color="neutral"
                variant="subtle"
                size="sm"
            />
            <span
                v-else-if="!hay && secreto.accion === 'conservar'"
                class="text-xs text-muted"
            >Sin guardar</span>
        </template>

        <div class="flex flex-col gap-2 sm:flex-row">
            <UInput
                v-if="secreto.accion === 'reemplazar'"
                v-model="secreto.valor"
                type="password"
                autocomplete="new-password"
                :placeholder="placeholder ?? 'Valor nuevo'"
                class="w-full"
                :data-prueba="`secreto-${nombre}`"
            />
            <div
                v-else
                class="flex h-8 w-full items-center rounded-md px-2.5 font-mono text-sm text-muted ring ring-default"
                aria-hidden="true"
            >
                {{ hay && secreto.accion === 'conservar' ? '••••••••' : '—' }}
            </div>
            <!-- Sin permiso o con la empresa heredando la global, el secreto solo se ve. -->
            <div
                v-if="!disabled"
                class="flex shrink-0 gap-2"
            >
                <UButton
                    v-if="secreto.accion !== 'reemplazar'"
                    :label="hay ? 'Reemplazar' : 'Escribir'"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :aria-label="`${hay ? 'Reemplazar' : 'Escribir'} ${etiqueta.toLowerCase()}`"
                    @click="secreto = { accion: 'reemplazar', valor: '' }"
                />
                <UButton
                    v-if="hay && secreto.accion === 'conservar'"
                    label="Borrar"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Borrar ${etiqueta.toLowerCase()}`"
                    @click="secreto = { accion: 'borrar', valor: '' }"
                />
                <UButton
                    v-if="secreto.accion !== 'conservar'"
                    label="Deshacer"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Deshacer el cambio de ${etiqueta.toLowerCase()}`"
                    @click="secreto = { accion: 'conservar', valor: '' }"
                />
            </div>
        </div>
    </UFormField>
</template>
