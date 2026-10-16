<script setup lang="ts">
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Datos de contacto y canal preferido. Nombre y NIT se muestran pero no se editan aquí (los cambia
 * la oficina). Guarda con la `version` leída; un 409 pide recargar.
 */
const props = defineProps<{
    contacto: ContactoPortal
}>()

const emit = defineEmits<{
    actualizado: [contacto: ContactoPortal]
}>()

const { editar } = useContacto()
const toast = useToast()

// Espejo de `editarContactoValidator` (apps/api/app/portal/validators.ts). Vacío = sin dato.
const telefono = z.string().trim().max(30)
    .refine(valor => valor === '' || /^\+?[\d\s()-]{7,30}$/.test(valor), 'Escribe solo números, espacios o guiones')
const esquema = z.object({
    email: z.string().trim().max(200).refine(valor => valor === '' || z.email().safeParse(valor).success, 'Correo no válido'),
    telefono,
    movil: telefono,
    canal_preferido: z.enum(['correo', 'telegram', 'whatsapp']),
})
type Datos = z.output<typeof esquema>

const estado = reactive<Datos>({ email: '', telefono: '', movil: '', canal_preferido: 'correo' })
const guardando = ref(false)
const error = ref<string | null>(null)

function cargar(contacto: ContactoPortal) {
    estado.email = contacto.email ?? ''
    estado.telefono = contacto.telefono ?? ''
    estado.movil = contacto.movil ?? ''
    estado.canal_preferido = contacto.canal_preferido
}

watch(() => props.contacto, cargar, { immediate: true })

const canales = computed<RadioGroupItem[]>(() => CANALES_PREFERIDOS.map(canal => ({
    ...canal,
    disabled: canal.value === 'telegram' && !props.contacto.telegram_vinculado,
    description: canal.value === 'telegram' && !props.contacto.telegram_vinculado
        ? 'Vincula Telegram con nuestro bot (muy pronto)'
        : undefined,
})))

const vacioANull = (valor: string) => valor === '' ? null : valor

async function guardar(evento: FormSubmitEvent<Datos>) {
    guardando.value = true
    error.value = null
    const resultado = await editar({
        version: props.contacto.version,
        email: vacioANull(evento.data.email),
        telefono: vacioANull(evento.data.telefono),
        movil: vacioANull(evento.data.movil),
        canal_preferido: evento.data.canal_preferido,
    })
    guardando.value = false
    if (!resultado.ok) {
        error.value = resultado.problema.status === 409
            ? 'Tus datos cambiaron mientras los editabas. Recarga la página e intenta de nuevo.'
            : mensajeProblema(resultado.problema)
        return
    }
    toast.add({ title: 'Datos guardados', icon: 'i-lucide-check', color: 'success' })
    emit('actualizado', resultado.data)
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="rounded-lg border border-default p-3 text-sm">
            <p class="font-medium text-highlighted">
                {{ contacto.nombre }}
            </p>
            <p
                v-if="contacto.nit_cui"
                class="text-muted"
            >
                NIT/CUI {{ contacto.nit_cui }}
            </p>
            <p class="mt-1 text-xs text-dimmed">
                Para cambiar tu nombre o NIT comunícate con nosotros.
            </p>
        </div>

        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
        />

        <UForm
            :schema="esquema"
            :state="estado"
            class="flex flex-col gap-4"
            @submit="guardar"
        >
            <UFormField
                label="Correo"
                name="email"
                help="Aquí te enviamos avisos de cobro y códigos de acceso."
            >
                <UInput
                    v-model="estado.email"
                    type="email"
                    autocomplete="email"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="Teléfono"
                name="telefono"
            >
                <UInput
                    v-model="estado.telefono"
                    type="tel"
                    autocomplete="tel"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="Celular"
                name="movil"
            >
                <UInput
                    v-model="estado.movil"
                    type="tel"
                    autocomplete="tel"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="¿Por dónde prefieres recibir avisos?"
                name="canal_preferido"
            >
                <URadioGroup
                    v-model="estado.canal_preferido"
                    :items="canales"
                />
            </UFormField>
            <UButton
                type="submit"
                label="Guardar cambios"
                icon="i-lucide-save"
                size="lg"
                block
                :loading="guardando"
            />
        </UForm>
    </div>
</template>
