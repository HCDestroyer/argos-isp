<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import type * as z from 'zod'

/**
 * Alta y edición de un campo personalizado del cliente (A1, `campos_personalizados.crear` y
 * `.editar`). La clave se sugiere desde la etiqueta y, como el tipo, no cambia después de crear el
 * campo (los valores guardados seguirían el tipo viejo). Las opciones solo con "Lista de opciones".
 * Al editar va la `version` leída: si otra persona lo cambió, 409 y se recarga.
 */
const props = withDefaults(defineProps<{
    campo?: CampoPersonalizado | null
    /** Orden sugerido para un campo nuevo (al final del catálogo). */
    ordenSugerido?: number
}>(), {
    campo: null,
    ordenSugerido: 0,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [campo: CampoPersonalizado] }>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EstadoCampoPersonalizado>(inicial())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** La clave sigue a la etiqueta hasta que el operador la escribe a mano. */
const claveManual = ref(false)

function inicial(): EstadoCampoPersonalizado {
    const campo = props.campo
    return campo
        ? { clave: campo.clave, etiqueta: campo.etiqueta, tipo: campo.tipo, opciones: [...campo.opciones], requerido: campo.requerido, orden: campo.orden }
        : { clave: '', etiqueta: '', tipo: 'texto', opciones: [], requerido: false, orden: props.ordenSugerido }
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, inicial())
        claveManual.value = props.campo !== null
        problema.value = null
    }
}, { immediate: true })

watch(() => estado.etiqueta, (etiqueta) => {
    if (!claveManual.value) {
        estado.clave = claveDesdeEtiqueta(etiqueta)
    }
})

watch(() => estado.tipo, (tipo) => {
    if (tipo !== 'opcion') {
        estado.opciones = []
    }
})

const itemsTipo: SelectItem[] = OPCIONES_TIPO_CAMPO.map(opcion => ({
    ...opcion,
    icon: TIPOS_CAMPO_PERSONALIZADO[opcion.value].icono,
    description: TIPOS_CAMPO_PERSONALIZADO[opcion.value].descripcion,
}))

function cambios(campo: CampoPersonalizado, datos: z.output<typeof esquemaCampoPersonalizado>): EditarCampoPersonalizado {
    const cuerpo: EditarCampoPersonalizado = { version: campo.version }
    if (datos.etiqueta !== campo.etiqueta) {
        cuerpo.etiqueta = datos.etiqueta
    }
    if (campo.tipo === 'opcion' && datos.opciones.join('\n') !== campo.opciones.join('\n')) {
        cuerpo.opciones = datos.opciones
    }
    if (datos.requerido !== campo.requerido) {
        cuerpo.requerido = datos.requerido
    }
    if (datos.orden !== campo.orden) {
        cuerpo.orden = datos.orden
    }
    return cuerpo
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquemaCampoPersonalizado>>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const resultado = props.campo
        ? await useCamposPersonalizados().editar(props.campo.id, cambios(props.campo, datos))
        : await useCamposPersonalizados().crear({
                clave: datos.clave,
                etiqueta: datos.etiqueta,
                tipo: datos.tipo,
                requerido: datos.requerido,
                orden: datos.orden,
                ...(datos.tipo === 'opcion' ? { opciones: datos.opciones } : {}),
            })
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
    <USlideover
        v-model:open="abierto"
        :title="campo ? `Editar ${campo.etiqueta}` : 'Nuevo campo personalizado'"
        description="Un dato extra que se pide en la ficha de cada cliente."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-lg' }"
    >
        <template #body>
            <UForm
                id="form-campo-personalizado"
                ref="formulario"
                :schema="esquemaCampoPersonalizado"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Etiqueta"
                    name="etiqueta"
                    help="Lo que ve el operador en la ficha y el formulario del cliente."
                    required
                >
                    <UInput
                        v-model="estado.etiqueta"
                        placeholder="Referencia de la casa"
                        class="w-full"
                        data-prueba="campo-etiqueta"
                    />
                </UFormField>
                <UFormField
                    label="Clave"
                    name="clave"
                    :help="campo ? 'La clave no cambia después de crear el campo.' : 'Nombre interno del dato; no cambia después.'"
                    required
                >
                    <UInput
                        v-model="estado.clave"
                        :disabled="campo !== null"
                        placeholder="referencia_casa"
                        class="w-full font-mono"
                        data-prueba="campo-clave"
                        @update:model-value="claveManual = true"
                    />
                </UFormField>
                <UFormField
                    label="Tipo"
                    name="tipo"
                    :help="campo ? 'El tipo no cambia después de crear el campo.' : undefined"
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        :disabled="campo !== null"
                        class="w-full"
                        data-prueba="campo-tipo"
                    />
                </UFormField>
                <UFormField
                    v-if="estado.tipo === 'opcion'"
                    label="Opciones"
                    name="opciones"
                    :help="campo ? 'Quitar una opción no borra el valor de los clientes que la tienen: se les pide otra al guardar su ficha.' : 'Escribe cada opción y pulsa Enter.'"
                    required
                >
                    <UInputTags
                        v-model="estado.opciones"
                        placeholder="Agregar opción"
                        :max-length="80"
                        class="w-full"
                        data-prueba="campo-opciones"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Orden"
                        name="orden"
                        help="Menor primero en la ficha."
                        required
                    >
                        <UInputNumber
                            v-model="estado.orden"
                            :min="0"
                            :max="10000"
                            :format-options="{ useGrouping: false }"
                            class="w-full"
                            data-prueba="campo-orden"
                        />
                    </UFormField>
                    <UFormField
                        name="requerido"
                        class="sm:pt-6"
                    >
                        <USwitch
                            v-model="estado.requerido"
                            label="Obligatorio"
                            description="Se exige al crear un cliente y al guardar sus datos."
                            data-prueba="campo-requerido"
                        />
                    </UFormField>
                </div>
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
                    form="form-campo-personalizado"
                    :label="campo ? 'Guardar cambios' : 'Crear campo'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="campo-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
