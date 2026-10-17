<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Subir o quitar el logo de una empresa (`empresas.cambiar_logo`). Vista previa local antes de
 * subir y los mismos límites que la API (PNG o SVG, hasta 512 KB); el SVG lo sanea la API. Con
 * 409 (otra persona cambió la empresa) o 422 se muestra el error y nada cambia.
 */
const props = defineProps<{
    empresa: EmpresaGrupo
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardada: [empresa: EmpresaGrupo] }>()

const archivo = ref<File | null>(null)
const vistaPrevia = ref<string | null>(null)
const errorLocal = ref<string | null>(null)
const problema = ref<Problem | null>(null)
const enviando = ref(false)

const actual = computed(() => urlLogoEmpresa(props.empresa.logo_url))

function limpiarVista() {
    if (vistaPrevia.value) {
        URL.revokeObjectURL(vistaPrevia.value)
    }
    vistaPrevia.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        archivo.value = null
        errorLocal.value = null
        problema.value = null
    }
    else {
        limpiarVista()
    }
})

watch(archivo, (nuevo) => {
    limpiarVista()
    problema.value = null
    errorLocal.value = nuevo ? errorLogo(nuevo) : null
    if (nuevo && !errorLocal.value) {
        vistaPrevia.value = URL.createObjectURL(nuevo)
    }
})

onBeforeUnmount(limpiarVista)

async function enviar(quitar: boolean) {
    if (!quitar && (!archivo.value || errorLocal.value)) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useEmpresas().cambiarLogo(props.empresa.id, props.empresa.version, quitar ? null : archivo.value)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardada', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Logo de ${empresa.nombre_comercial}`"
        description="PNG o SVG de hasta 512 KB. Sale en el portal, los avisos y los correos de esta empresa."
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <div class="flex items-center gap-4">
                    <div class="surface-card flex size-20 shrink-0 items-center justify-center overflow-hidden p-2">
                        <img
                            v-if="vistaPrevia || actual"
                            :src="vistaPrevia ?? actual"
                            :alt="vistaPrevia ? 'Vista previa del logo nuevo' : `Logo actual de ${empresa.nombre_comercial}`"
                            class="max-h-full max-w-full object-contain"
                            data-prueba="logo-vista"
                        >
                        <UIcon
                            v-else
                            name="i-lucide-image-off"
                            class="size-6 text-dimmed"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        <template v-if="vistaPrevia">
                            Vista previa: así se verá después de subirlo.
                        </template>
                        <template v-else-if="empresa.logo_url">
                            Logo actual ({{ empresa.logo_tipo === 'image/svg+xml' ? 'SVG' : 'PNG' }}).
                        </template>
                        <template v-else>
                            Sin logo: se usa el nombre comercial.
                        </template>
                    </p>
                </div>

                <UFormField
                    label="Archivo"
                    :error="errorLocal ?? undefined"
                >
                    <UFileUpload
                        v-model="archivo"
                        accept="image/png,image/svg+xml"
                        label="Elige o arrastra el logo"
                        description="PNG o SVG, hasta 512 KB"
                        icon="i-lucide-image-up"
                        class="w-full"
                        data-prueba="logo-archivo"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>

        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <UButton
                    v-if="empresa.logo_url"
                    label="Quitar logo"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    :loading="enviando"
                    class="justify-center"
                    @click="enviar(true)"
                />
                <span v-else />
                <UButton
                    label="Subir logo"
                    icon="i-lucide-upload"
                    :disabled="!archivo || Boolean(errorLocal)"
                    :loading="enviando"
                    class="justify-center"
                    data-prueba="logo-subir"
                    @click="enviar(false)"
                />
            </div>
        </template>
    </UModal>
</template>
