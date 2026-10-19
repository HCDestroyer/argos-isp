<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Marca un requisito del checklist legal (`POST /lealtad/sorteos/:id/requisitos/:clave`,
 * `sorteos.marcar_requisito`). Cumplido o «No aplica» llevan evidencia: referencia o texto, o un
 * archivo (PDF, JPEG, PNG o WebP, hasta 5 MB) que se sube antes (`POST .../archivos`, uso `evidencia`)
 * y se cita con `archivo_id`. Solo inserción: vale la última marca.
 */
const props = defineProps<{
    sorteoId: number
    requisito: RequisitoSorteo | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    /** Los requisitos vigentes y, si se subió, el archivo nuevo (la respuesta no trae `archivos`). */
    hecho: [requisitos: RequisitoSorteo[], archivo: ArchivoSorteo | null]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaRequisitoSorteo>({ estado: 'cumplido', valor: '', evidencia: '', nota: '', con_archivo: false })
const archivo = ref<File | null>(null)
const errorArchivo = ref<string | null>(null)
const revisandoArchivo = shallowRef<Promise<void> | null>(null)
/** El archivo de la marca anterior se conserva si no se elige otro. */
const archivoPrevio = computed(() => props.requisito?.archivo_id ?? null)

watch(archivo, async (nuevo) => {
    // Al elegirlo ya cuenta como evidencia (el envío espera la revisión del contenido).
    estado.con_archivo = !!nuevo || archivoPrevio.value !== null
    errorArchivo.value = null
    revisandoArchivo.value = nuevo ? revisar(nuevo) : null
    await revisandoArchivo.value
})

async function revisar(nuevo: File): Promise<void> {
    const error = errorArchivoSorteo(new Uint8Array(await nuevo.arrayBuffer()))
    if (archivo.value === nuevo) {
        errorArchivo.value = error
    }
}
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const visual = computed(() => (props.requisito ? REQUISITOS_SORTEO[props.requisito.clave] : null))
const itemsEstado: RadioGroupItem[] = Object.entries(ESTADOS_REQUISITO).map(([value, e]) => ({ label: e.etiqueta, value }))

watch(abierto, (valor) => {
    if (valor && props.requisito) {
        const r = props.requisito
        Object.assign(estado, {
            estado: r.estado === 'pendiente' ? 'cumplido' : r.estado,
            valor: r.valor ?? '',
            evidencia: r.evidencia ?? '',
            nota: r.nota ?? '',
            con_archivo: (r.archivo_id ?? null) !== null,
        })
        archivo.value = null
        errorArchivo.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaRequisitoSorteo>) {
    if (!props.requisito) {
        return
    }
    await revisandoArchivo.value
    if (errorArchivo.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const datos = evento.data
    let archivoId = archivoPrevio.value
    let subidoAhora: ArchivoSorteo | null = null
    if (archivo.value) {
        const subido = await useSorteos().subirArchivo(props.sorteoId, 'evidencia', archivo.value)
        if (!subido.ok) {
            enviando.value = false
            const enCampo = subido.problema.errors?.find(e => e.field === 'archivo')
            errorArchivo.value = enCampo?.message ?? null
            problema.value = enCampo ? null : subido.problema
            return
        }
        archivoId = subido.data.id
        subidoAhora = subido.data
        archivo.value = null
    }
    const resultado = await useSorteos().marcarRequisito(props.sorteoId, props.requisito.clave, {
        estado: datos.estado,
        valor: datos.valor || null,
        evidencia: datos.evidencia || null,
        archivo_id: archivoId,
        nota: datos.nota || null,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data, subidoAhora)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && e.name in estado)
    if (errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="visual ? visual.etiqueta : 'Requisito'"
        :description="visual ? PASOS_REQUISITO[visual.para] : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="visual"
                id="form-requisito-sorteo"
                ref="formulario"
                :schema="esquemaRequisitoSorteo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-scale"
                    :title="visual.requisito"
                    :description="`Fuente: ${visual.fuente}. ${AVISO_REQUISITOS}`"
                />
                <UFormField
                    label="Estado"
                    name="estado"
                    required
                >
                    <URadioGroup
                        v-model="estado.estado"
                        :items="itemsEstado"
                        orientation="horizontal"
                    />
                </UFormField>
                <UFormField
                    :label="visual.valor ?? 'Valor'"
                    name="valor"
                    help="Número de resolución, de fianza, de recibo…"
                >
                    <UInput
                        v-model="estado.valor"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Evidencia"
                    name="evidencia"
                    :required="estado.estado !== 'pendiente' && !estado.con_archivo"
                    help="Referencia o texto: dónde consta (expediente, edición, recibo). Opcional si adjunta un archivo."
                >
                    <UTextarea
                        v-model="estado.evidencia"
                        :rows="2"
                        autoresize
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Archivo de evidencia"
                    :error="errorArchivo ?? undefined"
                    :help="archivoPrevio && !archivo ? `Se conserva el archivo #${archivoPrevio} de la marca anterior.` : 'PDF, JPEG, PNG o WebP, hasta 5 MB. Queda con su SHA-256 y no se borra.'"
                >
                    <UFileUpload
                        v-model="archivo"
                        :accept="TIPOS_ARCHIVO_SORTEO"
                        label="Elija o arrastre el archivo"
                        description="Resolución, póliza, recibo, publicación…"
                        icon="i-lucide-paperclip"
                        layout="list"
                        class="w-full"
                        data-prueba="requisito-archivo"
                    />
                </UFormField>
                <UFormField
                    label="Nota"
                    name="nota"
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        autoresize
                        class="w-full"
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
                    form="form-requisito-sorteo"
                    label="Guardar marca"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
