<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * «Pegar clave pública» (`POST /routers/:id/conexion/clave`, `routers.conexion_clave`): cuando el
 * router no pudo registrarse solo (sin internet o RouterOS sin `:serialize`), el script muestra su
 * clave pública WireGuard y aquí se pega.
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [conexion: ConexionRouter]
}>()

const toast = useToast()

/** Espejo de `conexionClaveValidator`: 32 bytes en base64 (44 caracteres). */
const esquema = z.object({
    public_key: z.string().trim().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/, 'Pega la clave completa: 44 caracteres que terminan en =, como la muestra el router al final del script'),
})

const formulario = useTemplateRef('formulario')
const estado = reactive({ public_key: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        estado.public_key = ''
        problema.value = null
    }
})

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useRouters().pegarClave(props.router.id, evento.data.public_key)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: 'Clave guardada', description: 'En menos de un minuto el router debería verse «Conectado».', color: 'success', icon: 'i-lucide-circle-check' })
        emit('guardado', resultado.data)
        return
    }
    const errores = codigoProblema(resultado.problema) ? [] : erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Pegar clave pública · ${router.nombre}`"
        description="Si el script terminó con «FALTA un paso», copia la clave pública que mostró el router y pégala aquí."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-clave-wg"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Clave pública WireGuard"
                    name="public_key"
                    required
                    help="No es secreta: es la de la interfaz wg-argos del router (/interface wireguard print)."
                >
                    <UInput
                        v-model="estado.public_key"
                        placeholder="kH3sZ0pR1m9bQyU5wT8xVv2cLgN4dJf6aE7iO0rS1tA="
                        autocomplete="off"
                        class="w-full font-mono"
                        data-prueba="clave-publica"
                    />
                </UFormField>
                <ProblemaPools
                    v-if="problema"
                    :problema="problema"
                    :rechazos="ERRORES_SCRIPT"
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
                    form="form-clave-wg"
                    label="Guardar clave"
                    icon="i-lucide-clipboard-paste"
                    :loading="enviando"
                    data-prueba="clave-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
