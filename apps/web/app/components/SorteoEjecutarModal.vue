<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Ejecuta el sorteo en el acto (`POST /lealtad/sorteos/:id/ejecutar`, `sorteos.ejecutar`) con el
 * `valor_publico`: un dato que nadie controla y se conoce en ese momento (lo lee el notario o el
 * delegado), tomado de la fuente que declaran las bases (`bases.fuente_valor_publico`), y la
 * `valor_publico_evidencia`: cómo se obtuvo ese valor en el acto (ambos obligatorios). La API revela la
 * semilla, verifica el compromiso y elige; el panel no elige nada.
 * Si falta un requisito del checklist, el 422 `requisito_pendiente` dice cuál.
 */
const props = defineProps<{
    sorteo: Pick<SorteoDetalle, 'id' | 'nombre' | 'participantes' | 'boletos' | 'lista_hash' | 'compromiso' | 'requisitos' | 'bases'>
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [sorteo: SorteoDetalle]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaEjecutarSorteo>({ valor_publico: '', valor_publico_evidencia: '', asistentes: [] })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const faltantes = computed(() => requisitosFaltantes(props.sorteo.requisitos, 'ejecutar'))
const fuente = computed(() => (typeof props.sorteo.bases.fuente_valor_publico === 'string' ? props.sorteo.bases.fuente_valor_publico : null))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { valor_publico: '', valor_publico_evidencia: '', asistentes: [] })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

function agregarAsistente() {
    estado.asistentes.push({ nombre: '', rol: '' })
}

function quitarAsistente(indice: number) {
    estado.asistentes.splice(indice, 1)
}

async function enviar(evento: FormSubmitEvent<EntradaEjecutarSorteo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useSorteos().ejecutar(props.sorteo.id, {
        valor_publico: evento.data.valor_publico,
        valor_publico_evidencia: evento.data.valor_publico_evidencia,
        asistentes: evento.data.asistentes.map(a => ({ nombre: a.nombre, rol: a.rol || null })),
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'valor_publico' || e.name === 'valor_publico_evidencia')
    if (errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaSorteoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Ejecutar el sorteo"
        :description="sorteo.nombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-ejecutar-sorteo"
                ref="formulario"
                :schema="esquemaEjecutarSorteo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="El resultado ya no depende de nadie"
                    :description="`La semilla quedó comprometida al publicar las bases y la lista (${sorteo.participantes} participantes, ${sorteo.boletos} boletos) al cerrar el corte. Con el valor público del acto, la API calcula titulares y suplentes con argos-sorteo-v1; cualquiera puede repetir el cálculo.`"
                />
                <UAlert
                    v-if="faltantes.length"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-list-checks"
                    title="Checklist incompleto"
                    :description="`Falta marcar: ${faltantes.map(c => REQUISITOS_SORTEO[c].etiqueta).join(', ')}. La API no ejecuta sin ellos.`"
                    data-prueba="ejecutar-faltantes"
                />
                <div
                    class="rounded-lg border border-default p-3 text-sm"
                    data-prueba="ejecutar-fuente"
                >
                    <p class="text-muted">
                        Fuente del valor público (bases)
                    </p>
                    <p class="text-highlighted">
                        {{ fuente ?? 'Las bases no declaran la fuente' }}
                    </p>
                </div>
                <UFormField
                    label="Valor público del acto"
                    name="valor_publico"
                    required
                    help="Lo lee el notario o el delegado en el acto, de la fuente de las bases. Se publica tal cual."
                >
                    <UInput
                        v-model="estado.valor_publico"
                        class="w-full"
                        autocomplete="off"
                        data-prueba="valor-publico"
                    />
                </UFormField>
                <UFormField
                    label="Cómo se obtuvo el valor"
                    name="valor_publico_evidencia"
                    required
                    help="Quién lo leyó, dónde y a qué hora (p. ej. en el sitio de la Lotería, mostrado en pantalla)."
                >
                    <UTextarea
                        v-model="estado.valor_publico_evidencia"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="valor-publico-evidencia"
                    />
                </UFormField>
                <fieldset class="flex flex-col gap-2">
                    <legend class="mb-1 text-sm font-medium text-highlighted">
                        Asistentes
                    </legend>
                    <div
                        v-for="(asistente, indice) in estado.asistentes"
                        :key="indice"
                        class="flex items-start gap-2"
                    >
                        <UFormField
                            :name="`asistentes.${indice}.nombre`"
                            class="flex-1"
                        >
                            <UInput
                                v-model="asistente.nombre"
                                placeholder="Nombre"
                                :aria-label="`Nombre del asistente ${indice + 1}`"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            :name="`asistentes.${indice}.rol`"
                            class="w-28 sm:w-40"
                        >
                            <UInput
                                v-model="asistente.rol"
                                placeholder="Rol"
                                :aria-label="`Rol del asistente ${indice + 1}`"
                                class="w-full"
                            />
                        </UFormField>
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="ghost"
                            :aria-label="`Quitar al asistente ${indice + 1}`"
                            @click="quitarAsistente(indice)"
                        />
                    </div>
                    <UButton
                        label="Agregar asistente"
                        icon="i-lucide-user-plus"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="self-start"
                        @click="agregarAsistente"
                    />
                </fieldset>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="ejecutar-problema"
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
                    form="form-ejecutar-sorteo"
                    label="Ejecutar sorteo"
                    icon="i-lucide-trophy"
                    :loading="enviando"
                    data-prueba="confirmar-ejecutar"
                />
            </div>
        </template>
    </UModal>
</template>
