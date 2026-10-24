<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Telegram del cliente en su ficha (A6, `clientes.vincular_telegram` / `clientes.desvincular_telegram`):
 * vincular con el chat id que el cliente obtiene al escribirle al bot (`/start`), o quitarlo. Con
 * el chat vinculado, los avisos con canal Telegram le llegan ahí.
 */
const props = defineProps<{
    cliente: Cliente
}>()

const emit = defineEmits<{ cambiado: [cliente: Cliente] }>()

const { puede } = usePermisos()
const toast = useToast()

/** Espejo del validador: entero con signo de hasta 20 dígitos, como texto. */
const esquema = z.object({
    chat_id: z.string().trim().regex(/^-?\d{1,20}$/, 'Solo números (puede empezar con −), hasta 20 dígitos'),
})
const estado = reactive<z.input<typeof esquema>>({ chat_id: '' })
const formulario = useTemplateRef('formulario')
const abierto = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

function abrir() {
    estado.chat_id = ''
    problema.value = null
    clave = nuevaClaveIdempotencia()
    abierto.value = true
}

async function vincular(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useClientes().vincularTelegram(props.cliente.id, evento.data.chat_id, clave)
    enviando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    toast.add({ title: 'Telegram vinculado', description: props.cliente.nombre, color: 'success', icon: 'i-lucide-send' })
    emit('cambiado', resultado.data)
}

const quitarAbierto = ref(false)

function desvincular(): Promise<Resultado<Cliente>> {
    return useClientes().desvincularTelegram(props.cliente.id, nuevaClaveIdempotencia())
}

function alDesvincular(cliente: Cliente) {
    toast.add({ title: 'Telegram desvinculado', description: cliente.nombre, color: 'success', icon: 'i-lucide-circle-check' })
    emit('cambiado', cliente)
}
</script>

<template>
    <div
        class="flex flex-wrap items-center gap-2"
        data-prueba="cliente-telegram"
    >
        <UBadge
            :label="cliente.telegram_chat_id ? 'Vinculado' : 'Sin vincular'"
            :icon="cliente.telegram_chat_id ? 'i-lucide-send' : 'i-lucide-unlink'"
            :color="cliente.telegram_chat_id ? 'success' : 'neutral'"
            variant="subtle"
            size="sm"
        />
        <UButton
            v-if="!cliente.telegram_chat_id && puede('clientes.vincular_telegram')"
            label="Vincular"
            color="neutral"
            variant="link"
            size="xs"
            data-prueba="vincular-telegram"
            @click="abrir"
        />
        <UButton
            v-if="cliente.telegram_chat_id && puede('clientes.desvincular_telegram')"
            label="Quitar"
            color="neutral"
            variant="link"
            size="xs"
            data-prueba="desvincular-telegram"
            @click="quitarAbierto = true"
        />

        <UModal
            v-model:open="abierto"
            title="Vincular Telegram"
            description="Pide al cliente que le escriba /start al bot de la empresa: el bot le responde con su chat id."
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    id="form-telegram"
                    ref="formulario"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="vincular"
                >
                    <UFormField
                        label="Chat id"
                        name="chat_id"
                        required
                    >
                        <UInput
                            v-model="estado.chat_id"
                            inputmode="numeric"
                            placeholder="123456789"
                            class="w-full font-mono"
                            data-prueba="telegram-chat-id"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
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
                        type="submit"
                        form="form-telegram"
                        label="Vincular"
                        icon="i-lucide-send"
                        :loading="enviando"
                        data-prueba="telegram-vincular"
                    />
                </div>
            </template>
        </UModal>
        <ConfirmacionModal
            v-model:open="quitarAbierto"
            titulo="Quitar Telegram"
            :efecto="`${cliente.nombre} deja de recibir avisos por Telegram; los que tengan ese canal irán por correo.`"
            confirmar="Quitar"
            icono="i-lucide-unlink"
            :ejecutar="desvincular"
            @hecho="alDesvincular"
        />
    </div>
</template>
