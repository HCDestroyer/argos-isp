<script setup lang="ts" generic="T">
import type { Problem } from '@argosisp/contracts'
import type { ButtonProps } from '@nuxt/ui'

/**
 * Confirmación de una acción explícita sin motivo (revocar un token, quitar una vinculación). El
 * error de la API se muestra aquí y nada cambia; al terminar emite `hecho` con la respuesta.
 */
const props = withDefaults(defineProps<{
    titulo: string
    /** Qué pasa al confirmar, en una frase. */
    efecto: string
    confirmar: string
    icono?: string
    color?: ButtonProps['color']
    ejecutar: () => Promise<Resultado<T>>
}>(), {
    icono: 'i-lucide-ban',
    color: 'error',
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [resultado: T] }>()

const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        problema.value = null
    }
})

async function confirmarAccion() {
    enviando.value = true
    problema.value = null
    const resultado = await props.ejecutar()
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="titulo"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UAlert
                    :color="color === 'error' ? 'error' : 'neutral'"
                    variant="subtle"
                    :icon="icono"
                    :description="efecto"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    :label="confirmar"
                    :icon="icono"
                    :color="color"
                    :loading="enviando"
                    data-prueba="confirmar-accion"
                    @click="confirmarAccion"
                />
            </div>
        </template>
    </UModal>
</template>
