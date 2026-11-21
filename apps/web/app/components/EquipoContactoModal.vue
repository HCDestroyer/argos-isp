<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Registrar un contacto con el cliente para recuperar el equipo (A48,
 * `POST /inventario/unidades/:id/contactos-recuperacion`, `inventario.registrar_contacto_recuperacion`).
 * Cuenta como alternativa a los intentos de técnicos distintos para declararlo no recuperado.
 */
const props = defineProps<{
    unidad: Pick<UnidadInventario, 'id' | 'serie' | 'mac'> | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [] }>()

const esquema = z.object({
    medio: z.enum(['llamada', 'whatsapp', 'correo', 'visita', 'oficina', 'otro']),
    nota: z.string().trim().min(3, 'Escribe qué pasó (mínimo 3 caracteres)').max(500),
})

const idFormulario = useId()
const estado = reactive<z.input<typeof esquema>>({ medio: 'llamada', nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const medios: SelectItem[] = Object.entries(MEDIOS_CONTACTO).map(([value, m]) => ({ value, label: m.etiqueta, icon: m.icono }))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { medio: 'llamada', nota: '' })
        problema.value = null
    }
})

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    if (!props.unidad) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useUnidadesInventario().registrarContacto(props.unidad.id, evento.data)
    enviando.value = false
    if (!r.ok) {
        problema.value = r.problema
        return
    }
    abierto.value = false
    emit('hecho')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar contacto con el cliente"
        :description="unidad ? `Para recuperar ${identificacionUnidad(unidad)}` : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Cómo lo contactaste"
                    name="medio"
                    required
                >
                    <USelect
                        v-model="estado.medio"
                        :items="medios"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Qué pasó"
                    name="nota"
                    required
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        placeholder="Ej.: dice que lo trae el viernes a la oficina"
                        class="w-full"
                        data-prueba="contacto-nota"
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
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Registrar contacto"
                    icon="i-lucide-phone"
                    :loading="enviando"
                    data-prueba="contacto-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
