<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Editor de una plantilla de notificación por evento y canal (A6): asunto (correo; en Telegram va
 * como primera línea), cuerpo Mustache en texto plano y activa. La API valida la sintaxis Mustache
 * (422 junto al campo) y la `version` (409). Las variables del evento (catálogo de la API, con su
 * ejemplo) se insertan donde está el cursor. "Vista previa" pide a la API el texto con los datos de
 * ejemplo, sin guardar (`POST /notificaciones/plantillas/vista-previa`), y avisa de las variables
 * que el evento no trae.
 */
const props = defineProps<{
    plantilla: PlantillaNotificacion
    /** Evento del catálogo (`GET /notificaciones/eventos`); `null` si no se pudo leer. */
    evento: EventoNotificacion | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [plantilla: PlantillaNotificacion] }>()

/** Espejo de `editarPlantillaValidator` (A6): asunto ≤ 300 (vacío = sin asunto), cuerpo 1–4000. */
const esquema = z.object({
    asunto: z.string().max(300, 'Máximo 300 caracteres'),
    cuerpo: z.string().min(1, 'Escribe el texto del aviso').max(4000, 'Máximo 4000 caracteres'),
    activa: z.boolean(),
})
type Entrada = z.input<typeof esquema>

const formulario = useTemplateRef('formulario')
const textarea = useTemplateRef<{ textareaRef?: HTMLTextAreaElement | null }>('textarea')
const estado = reactive<Entrada>({ asunto: '', cuerpo: '', activa: true })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const previa = shallowRef<VistaPreviaPlantilla | null>(null)
const cargandoPrevia = ref(false)
const problemaPrevia = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { asunto: props.plantilla.asunto ?? '', cuerpo: props.plantilla.cuerpo, activa: props.plantilla.activa })
        problema.value = null
        previa.value = null
        problemaPrevia.value = null
    }
}, { immediate: true })

const grupos = computed(() => props.evento?.variables ?? [])

/** La vista previa deja de valer en cuanto cambia el texto. */
watch(() => [estado.asunto, estado.cuerpo], () => {
    previa.value = null
})

async function verPrevia() {
    cargandoPrevia.value = true
    problemaPrevia.value = null
    const resultado = await usePlantillasNotificacion().vistaPrevia({
        evento: props.plantilla.evento,
        canal: props.plantilla.canal,
        asunto: estado.asunto.trim() === '' ? null : estado.asunto,
        cuerpo: estado.cuerpo,
    })
    cargandoPrevia.value = false
    if (resultado.ok) {
        previa.value = resultado.data
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problemaPrevia.value = resultado.problema
}

/** Inserta `{{variable}}` en el cuerpo, donde está el cursor (o al final). */
function insertar(variable: string) {
    const etiqueta = `{{${variable}}}`
    const elemento = textarea.value?.textareaRef ?? null
    const inicio = elemento?.selectionStart ?? estado.cuerpo.length
    const fin = elemento?.selectionEnd ?? estado.cuerpo.length
    estado.cuerpo = estado.cuerpo.slice(0, inicio) + etiqueta + estado.cuerpo.slice(fin)
    nextTick(() => {
        elemento?.focus()
        elemento?.setSelectionRange(inicio + etiqueta.length, inicio + etiqueta.length)
    })
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePlantillasNotificacion().editar(props.plantilla.id, {
        version: props.plantilla.version,
        asunto: evento.data.asunto.trim() === '' ? null : evento.data.asunto,
        cuerpo: evento.data.cuerpo,
        activa: evento.data.activa,
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
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="evento?.nombre ?? plantilla.evento"
        :description="`${CANALES_AVISO[plantilla.canal].etiqueta} · ${plantilla.evento}`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-plantilla-notificacion"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-5"
                @submit="enviar"
            >
                <USwitch
                    v-model="estado.activa"
                    label="Activa"
                    description="Apagada, este evento no se avisa por este canal."
                    data-prueba="aviso-activa"
                />
                <UFormField
                    label="Asunto"
                    name="asunto"
                    :help="plantilla.canal === 'correo' ? 'Admite variables.' : 'En Telegram va como primera línea; vacío = sin ella.'"
                >
                    <UInput
                        v-model="estado.asunto"
                        class="w-full"
                        data-prueba="aviso-asunto"
                    />
                </UFormField>
                <UFormField
                    label="Mensaje"
                    name="cuerpo"
                    help="Texto plano con variables {{…}}; para condicionar: {{#estado.es_suspendido}}…{{/estado.es_suspendido}}."
                    required
                >
                    <UTextarea
                        ref="textarea"
                        v-model="estado.cuerpo"
                        :rows="10"
                        autoresize
                        :maxrows="20"
                        class="w-full font-mono"
                        data-prueba="aviso-cuerpo"
                    />
                </UFormField>

                <section
                    class="flex flex-col gap-3"
                    data-prueba="aviso-vista-previa"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-medium text-highlighted">
                            Vista previa
                        </h3>
                        <UButton
                            label="Ver vista previa"
                            icon="i-lucide-eye"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :loading="cargandoPrevia"
                            data-prueba="aviso-ver-previa"
                            @click="verPrevia"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaPrevia && !problemaPrevia.errors?.length"
                        :problema="problemaPrevia"
                        :reintentar="verPrevia"
                        :reintentando="cargandoPrevia"
                    />
                    <template v-else-if="previa">
                        <p class="text-xs text-muted">
                            Con los datos de ejemplo del evento; no se guarda nada. Así lo recibe el destinatario:
                        </p>
                        <p
                            v-if="plantilla.canal === 'correo' && previa.asunto"
                            class="text-sm"
                            data-prueba="previa-asunto"
                        >
                            <span class="text-muted">Asunto:</span> <span class="font-medium text-highlighted">{{ previa.asunto }}</span>
                        </p>
                        <div
                            class="rounded-md border border-default bg-elevated/50 p-3 text-sm whitespace-pre-wrap text-default"
                            data-prueba="previa-mensaje"
                        >
                            {{ previa.mensaje }}
                        </div>
                        <UAlert
                            v-if="previa.variables_desconocidas.length"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            title="Variables que este evento no trae (salen vacías)"
                            :description="previa.variables_desconocidas.join(', ')"
                            data-prueba="previa-desconocidas"
                        />
                    </template>
                    <p
                        v-else
                        class="text-xs text-muted"
                    >
                        Muestra el texto con datos de ejemplo antes de guardar.
                    </p>
                </section>

                <section
                    v-if="grupos.length"
                    class="flex flex-col gap-3"
                    data-prueba="aviso-variables"
                >
                    <h3 class="text-sm font-medium text-highlighted">
                        Variables de este evento
                    </h3>
                    <p class="text-xs text-muted">
                        Toca una para insertarla donde está el cursor. Los montos con <code>_q</code> ya vienen en quetzales y las fechas en hora de Guatemala.
                    </p>
                    <div
                        v-for="grupo in grupos"
                        :key="grupo.grupo"
                        class="flex flex-col gap-1.5"
                    >
                        <span class="text-xs font-medium text-muted">{{ grupo.etiqueta }}</span>
                        <div class="flex flex-wrap gap-1">
                            <UTooltip
                                v-for="variable in grupo.variables"
                                :key="variable.nombre"
                                :text="`Ejemplo: ${variable.ejemplo || '(vacío)'}`"
                            >
                                <UButton
                                    :label="variable.nombre"
                                    color="neutral"
                                    variant="soft"
                                    size="xs"
                                    class="font-mono"
                                    :aria-label="`Insertar ${variable.nombre}`"
                                    @click="insertar(variable.nombre)"
                                />
                            </UTooltip>
                        </div>
                    </div>
                </section>
                <UAlert
                    v-else
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    :description="evento ? 'Este evento no trae variables.' : 'No se pudo leer el catálogo de eventos: las variables no están a la vista. La vista previa y el guardado siguen funcionando.'"
                />

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="aviso-error"
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
                    form="form-plantilla-notificacion"
                    label="Guardar"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="aviso-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
