<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un tipo de producto (D.2): código (no cambia al editar), nombre, seguimiento y
 * modalidad por defecto (422 `modalidad_defecto` si no van juntos). Un tipo global solo con alcance
 * global (403). Al editar va la `version` (409).
 */
const props = withDefaults(defineProps<{
    tipo?: TipoProducto | null
}>(), {
    tipo: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [tipo: TipoProducto] }>()

const usuario = useUsuarioActual()
const alcanceGlobal = computed(() => usuario.value?.alcance_global === true)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaTipoProducto>(entradaTipoProducto(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()
let codigoTocado = false

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaTipoProducto(props.tipo))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        codigoTocado = props.tipo !== null
    }
}, { immediate: true })

function tocarCodigo() {
    codigoTocado = true
}

watch(() => estado.nombre, (nombre) => {
    if (!codigoTocado) {
        estado.codigo = codigoDesdeNombre(nombre)
    }
})

watch(() => estado.seguimiento_defecto, (seguimiento) => {
    if (!modalidadCompatible(estado.modalidad_defecto, seguimiento)) {
        estado.modalidad_defecto = seguimiento === 'serie' ? 'comodato' : 'consumible_gasto'
    }
})

const itemsSeguimiento: SelectItem[] = (Object.keys(SEGUIMIENTOS) as Producto['seguimiento'][]).map(s => ({ label: SEGUIMIENTOS[s].etiqueta, value: s, description: SEGUIMIENTOS[s].descripcion, icon: SEGUIMIENTOS[s].icono }))
const itemsModalidad = computed<SelectItem[]>(() => (Object.keys(MODALIDADES) as ModalidadProducto[])
    .filter(m => modalidadCompatible(m, estado.seguimiento_defecto))
    .map(m => ({ label: MODALIDADES[m].etiqueta, value: m, description: MODALIDADES[m].descripcion, icon: MODALIDADES[m].icono })))

async function enviar(evento: FormSubmitEvent<SalidaTipoProducto>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = props.tipo
        ? await useTiposProducto().editar(props.tipo.id, { version: props.tipo.version, nombre: d.nombre, seguimiento_defecto: d.seguimiento_defecto, modalidad_defecto: d.modalidad_defecto })
        : await useTiposProducto().crear({ codigo: d.codigo, nombre: d.nombre, seguimiento_defecto: d.seguimiento_defecto, modalidad_defecto: d.modalidad_defecto, ...(d.global ? { global: true } : {}) }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="tipo ? `Editar ${tipo.nombre}` : 'Nuevo tipo de producto'"
        description="El seguimiento y la modalidad son los que toma un producto nuevo de este tipo."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-tipo-producto"
                ref="formulario"
                :schema="esquemaTipoProducto"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="tipo-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Código"
                        name="codigo"
                        required
                        :help="tipo ? 'El código no cambia.' : 'Minúsculas, dígitos y _.'"
                    >
                        <UInput
                            v-model="estado.codigo"
                            :disabled="tipo !== null"
                            class="w-full font-mono"
                            data-prueba="tipo-codigo"
                            @input="tocarCodigo"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Seguimiento por defecto"
                    name="seguimiento_defecto"
                >
                    <USelect
                        v-model="estado.seguimiento_defecto"
                        :items="itemsSeguimiento"
                        class="w-full"
                        data-prueba="tipo-seguimiento"
                    />
                </UFormField>
                <UFormField
                    label="Modalidad por defecto"
                    name="modalidad_defecto"
                >
                    <USelect
                        v-model="estado.modalidad_defecto"
                        :items="itemsModalidad"
                        class="w-full"
                        data-prueba="tipo-modalidad"
                    />
                </UFormField>
                <UFormField
                    v-if="!tipo && alcanceGlobal"
                    name="global"
                >
                    <UCheckbox
                        v-model="estado.global"
                        label="Tipo global"
                        description="Para todas las empresas de la instalación."
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
                    form="form-tipo-producto"
                    :label="tipo ? 'Guardar cambios' : 'Crear tipo'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="tipo-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
