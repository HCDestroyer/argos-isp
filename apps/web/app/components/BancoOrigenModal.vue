<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Agregar un banco al catálogo de bancos de origen o editarlo (A3, decisión 23 del PM). Afecta a
 * todas las empresas: los pagos y comprobantes que ya lo usan no cambian. 409 `banco_duplicado`
 * en el campo del nombre; 409 de versión con «Recargar».
 */
const props = defineProps<{
    /** `null` = agregar. */
    banco: BancoOrigen | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [banco: BancoOrigen, nuevo: boolean], recargar: [] }>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<DatosFormBancoOrigen>({ nombre: '', activo: true })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        estado.nombre = props.banco?.nombre ?? ''
        estado.activo = props.banco?.activo ?? true
        problema.value = null
    }
})

async function enviar(evento: FormSubmitEvent<DatosFormBancoOrigen>) {
    enviando.value = true
    problema.value = null
    const r = props.banco
        ? await useBancosOrigen().editar(props.banco, { nombre: evento.data.nombre, activo: evento.data.activo })
        : await useBancosOrigen().crear({ nombre: evento.data.nombre })
    enviando.value = false
    if (!r.ok) {
        if (codigoProblema(r.problema) === 'banco_duplicado') {
            formulario.value?.setErrors([{ name: 'nombre', message: 'Ya hay un banco con ese nombre en el catálogo' }])
            return
        }
        problema.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    abierto.value = false
    emit('hecho', r.data, props.banco === null)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                :texto="banco ? 'Editar banco' : 'Agregar banco'"
                :icono="banco ? ICONOS.editar : 'i-lucide-plus'"
            />
        </template>
        <template #description>
            El catálogo es uno para todas las empresas.
        </template>
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaBancoOrigen"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        autofocus
                        placeholder="Ej.: Banco Nexa"
                        class="w-full"
                        data-prueba="banco-nombre"
                    />
                </UFormField>
                <USwitch
                    v-if="banco"
                    v-model="estado.activo"
                    label="Sale en las listas"
                    description="Apagado: ninguna empresa lo ve al cobrar. Los pagos que ya lo usan no cambian."
                />
                <ProblemaAlerta
                    v-if="problema && problema.status === 409"
                    :problema="problema"
                    etiqueta-reintentar="Recargar"
                    :reintentar="() => { abierto = false; emit('recargar') }"
                />
                <ProblemaAlerta
                    v-else-if="problema"
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
                    variant="outline"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="banco ? 'Guardar' : 'Agregar banco'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="banco-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
