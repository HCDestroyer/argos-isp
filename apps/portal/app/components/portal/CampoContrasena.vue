<script setup lang="ts">
/**
 * Campo de contraseña con botón para mostrarla u ocultarla (útil en el teléfono, donde es fácil
 * equivocarse). Va dentro de un `UFormField`; `autocomplete` decide si el teléfono ofrece guardar o
 * sugerir una contraseña (`current-password` al entrar, `new-password` al elegir una).
 */
const modelo = defineModel<string>({ required: true })

withDefaults(defineProps<{
    autocomplete?: 'current-password' | 'new-password'
    testid?: string
}>(), {
    autocomplete: 'current-password',
    testid: undefined,
})

const visible = ref(false)
</script>

<template>
    <UInput
        v-model="modelo"
        :type="visible ? 'text' : 'password'"
        :autocomplete="autocomplete"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        size="xl"
        class="w-full"
        :data-testid="testid"
        :ui="{ trailing: 'pe-1' }"
    >
        <template #trailing>
            <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :aria-pressed="visible"
                @click="visible = !visible"
            />
        </template>
    </UInput>
</template>
