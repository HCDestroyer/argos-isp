<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { CheckboxGroupItem, FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Crear (`POST /anuncios`, en borrador) o editar (`PUT /anuncios/:id` con `version`, solo lo que
 * cambió) un anuncio, con la vista previa del portal al lado. Las fechas se escriben en hora de
 * Guatemala. La imagen se sube aparte (`AnuncioImagenModal`); aquí solo su texto alternativo.
 */
const props = withDefaults(defineProps<{
    /** Anuncio a editar; sin él, alta. */
    anuncio?: Anuncio | null
    /** URL de objeto de la imagen actual, para la vista previa. */
    imagenUrl?: string | null
}>(), {
    anuncio: null,
    imagenUrl: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [anuncio: Anuncio, nuevo: boolean] }>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaAnuncio>(entradaAnuncio(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaAnuncio(props.anuncio))
        problema.value = null
    }
}, { immediate: true })

const itemsAudiencia: SelectItem[] = (Object.keys(AUDIENCIAS_ANUNCIO) as AudienciaAnuncio[])
    .map(a => ({ label: AUDIENCIAS_ANUNCIO[a].etiqueta, value: a }))
const itemsLugares: CheckboxGroupItem[] = (Object.keys(LUGARES_ANUNCIO) as LugarAnuncio[])
    .map(l => ({ label: LUGARES_ANUNCIO[l].etiqueta, value: l }))

const vista = computed(() => ({
    titulo: estado.titulo.trim(),
    texto: estado.texto.trim(),
    boton: estado.boton_texto.trim() && estado.boton_url.trim() ? { texto: estado.boton_texto.trim(), url: estado.boton_url.trim() } : null,
    imagen: props.imagenUrl && props.anuncio?.imagen
        ? { url: props.imagenUrl, alt: estado.imagen_alt || props.anuncio.imagen.alt || '', ancho: props.anuncio.imagen.ancho, alto: props.anuncio.imagen.alto }
        : null,
}))

async function enviar(evento: FormSubmitEvent<SalidaAnuncio>) {
    enviando.value = true
    problema.value = null
    if (props.anuncio) {
        const cambios = cambiosAnuncio(props.anuncio, evento.data)
        if (Object.keys(cambios).length === 1) {
            enviando.value = false
            abierto.value = false
            return
        }
    }
    const resultado = props.anuncio
        ? await useAnuncios().editar(props.anuncio.id, cambiosAnuncio(props.anuncio, evento.data))
        : await useAnuncios().crear(cuerpoAnuncio(evento.data))
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data, props.anuncio === null)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = problemaAnuncioLegible(resultado.problema)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="anuncio ? `Editar «${anuncio.titulo}»` : 'Nuevo anuncio'"
        :description="anuncio ? `Versión ${anuncio.version}` : 'Se crea en borrador: no se ve en el portal hasta publicarlo.'"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-4xl' }"
    >
        <template #body>
            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <UForm
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaAnuncio"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="enviar"
                >
                    <UFormField
                        label="Título"
                        name="titulo"
                        required
                        :hint="`${estado.titulo.length}/80`"
                    >
                        <UInput
                            v-model="estado.titulo"
                            :maxlength="80"
                            placeholder="Duplica tu velocidad este mes"
                            class="w-full"
                            data-prueba="anuncio-titulo"
                        />
                    </UFormField>
                    <UFormField
                        label="Texto"
                        name="texto"
                        help="Texto plano: se respetan los saltos de línea, sin formato."
                        :hint="`${estado.texto.length}/500`"
                    >
                        <UTextarea
                            v-model="estado.texto"
                            :maxlength="500"
                            :rows="4"
                            autoresize
                            class="w-full"
                            data-prueba="anuncio-texto"
                        />
                    </UFormField>

                    <div class="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <UFormField
                            label="Texto del botón"
                            name="boton_texto"
                            :hint="`${estado.boton_texto.length}/40`"
                        >
                            <UInput
                                v-model="estado.boton_texto"
                                :maxlength="40"
                                placeholder="Ver planes"
                                class="w-full"
                                data-prueba="anuncio-boton-texto"
                            />
                        </UFormField>
                        <UFormField
                            label="Dirección del botón"
                            name="boton_url"
                            help="https://… o una ruta del portal como /cuenta."
                        >
                            <UInput
                                v-model="estado.boton_url"
                                inputmode="url"
                                placeholder="/cuenta"
                                class="w-full"
                                data-prueba="anuncio-boton-url"
                            />
                        </UFormField>
                    </div>

                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Desde (hora de Guatemala)"
                            name="inicio"
                            help="Vacío: desde que se publica."
                        >
                            <UInput
                                v-model="estado.inicio"
                                type="datetime-local"
                                class="w-full"
                                data-prueba="anuncio-inicio"
                            />
                        </UFormField>
                        <UFormField
                            label="Hasta (hora de Guatemala)"
                            name="fin"
                            help="Vacío: sin vencimiento."
                        >
                            <UInput
                                v-model="estado.fin"
                                type="datetime-local"
                                class="w-full"
                                data-prueba="anuncio-fin"
                            />
                        </UFormField>
                    </div>

                    <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                        <UFormField
                            label="Audiencia"
                            name="audiencia"
                            :help="AUDIENCIAS_ANUNCIO[estado.audiencia].descripcion"
                        >
                            <USelect
                                v-model="estado.audiencia"
                                :items="itemsAudiencia"
                                class="w-full"
                                data-prueba="anuncio-audiencia"
                            />
                        </UFormField>
                        <UFormField
                            label="Orden"
                            name="orden"
                            help="Mayor, primero."
                        >
                            <UInputNumber
                                v-model="estado.orden"
                                :min="-1000"
                                :max="1000"
                                class="w-full"
                                data-prueba="anuncio-orden"
                            />
                        </UFormField>
                    </div>

                    <UFormField
                        label="Dónde se ve"
                        name="lugares"
                        required
                    >
                        <UCheckboxGroup
                            v-model="estado.lugares"
                            :items="itemsLugares"
                            orientation="horizontal"
                            data-prueba="anuncio-lugares"
                        />
                    </UFormField>

                    <UFormField
                        v-if="anuncio?.imagen"
                        label="Texto alternativo de la imagen"
                        name="imagen_alt"
                        help="Describe la imagen para quien no la ve."
                        :hint="`${estado.imagen_alt.length}/200`"
                    >
                        <UInput
                            v-model="estado.imagen_alt"
                            :maxlength="200"
                            class="w-full"
                        />
                    </UFormField>

                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>

                <AnuncioVistaPrevia
                    :titulo="vista.titulo"
                    :texto="vista.texto"
                    :boton="vista.boton"
                    :imagen="vista.imagen"
                    :lugares="estado.lugares.length ? estado.lugares : ['portal_inicio']"
                    class="lg:sticky lg:top-0 lg:self-start"
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
                    type="submit"
                    :form="idFormulario"
                    :label="anuncio ? 'Guardar' : 'Crear borrador'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-anuncio"
                />
            </div>
        </template>
    </USlideover>
</template>
