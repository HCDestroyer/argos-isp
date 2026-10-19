<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormError, FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un sorteo en borrador (`POST /lealtad/sorteos`, `PUT /lealtad/sorteos/:id`,
 * `sorteos.gestionar`): bases (§7.2), fechas, criterios del corte y premios con imagen y tipo. Todo
 * se puede dejar a medias en borrador; al publicar, la API exige las bases completas (422
 * `bases_incompletas`). Desde la publicación nada de esto cambia.
 */
const props = withDefaults(defineProps<{
    /** El sorteo a editar, o `null` para uno nuevo. */
    sorteo?: SorteoDetalle | null
}>(), {
    sorteo: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [sorteo: SorteoDetalle]
}>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaSorteo>(entradaSorteoVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const catalogo = shallowRef<PremioLealtad[]>([])
const problemaCatalogo = ref<Problem | null>(null)

const itemsTipo: SelectItem[] = Object.entries(TIPOS_PREMIO_SORTEO).map(([value, t]) => ({ label: t.etiqueta, value, icon: t.icono }))
const itemsCatalogo = computed<SelectItem[]>(() => catalogo.value
    .filter(p => p.activo && (p.tipo === 'descuento_factura' || p.tipo === 'mes_gratis'))
    .map(p => ({ label: p.nombre, value: p.id })))

const titulares = computed(() => estado.premios.reduce((suma, p) => suma + (Number.isInteger(p.cantidad) ? p.cantidad : 0), 0))

async function cargarCatalogo() {
    problemaCatalogo.value = null
    if (!puede('lealtad.ver')) {
        return
    }
    const resultado = await usePremiosLealtad().listar({ activo: true })
    catalogo.value = resultado.ok ? resultado.data.data : []
    problemaCatalogo.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.sorteo ? entradaDeSorteo(props.sorteo) : entradaSorteoVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarCatalogo()
    }
})

function agregarPremio() {
    estado.premios.push(entradaPremioVacia())
}

function quitarPremio(indice: number) {
    estado.premios.splice(indice, 1)
}

function moverPremio(indice: number, paso: -1 | 1) {
    const destino = indice + paso
    const [premio] = estado.premios.splice(indice, 1)
    if (premio) {
        estado.premios.splice(destino, 0, premio)
    }
}

/** Los campos del 422 de la API con el nombre del formulario (`bases.mecanica` → `mecanica`). */
function erroresDelFormulario(problemaApi: Problem): FormError[] {
    return erroresDeFormulario(problemaApi).map(e => ({ ...e, name: e.name?.replace(/^(bases|criterios)\./, '') }))
}

async function enviar(evento: FormSubmitEvent<SalidaSorteo>) {
    enviando.value = true
    problema.value = null
    const resultado = props.sorteo
        ? await useSorteos().editar(props.sorteo.id, cuerpoEdicionSorteo(props.sorteo, evento.data))
        : await useSorteos().crear(cuerpoSorteo(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDelFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    else {
        problema.value = resultado.problema
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="sorteo ? 'Editar sorteo' : 'Nuevo sorteo'"
        description="En borrador todo se puede cambiar; al publicar las bases se congelan con su hash."
        :dismissible="!enviando"
        :ui="{
            content: 'max-w-2xl',
        }"
    >
        <template #body>
            <UForm
                id="form-sorteo"
                ref="formulario"
                :schema="esquemaSorteo"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <fieldset class="flex flex-col gap-4">
                    <legend class="mb-2 text-sm font-semibold text-highlighted">
                        Sorteo
                    </legend>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="sorteo-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                    >
                        <UTextarea
                            v-model="estado.descripcion"
                            :rows="2"
                            autoresize
                            class="w-full"
                        />
                    </UFormField>
                </fieldset>

                <fieldset class="flex flex-col gap-4">
                    <legend class="mb-2 text-sm font-semibold text-highlighted">
                        Bases
                    </legend>
                    <UFormField
                        label="Mecánica y forma del sorteo"
                        name="mecanica"
                    >
                        <UTextarea
                            v-model="estado.mecanica"
                            :rows="3"
                            autoresize
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Regla de participación"
                        name="regla_participacion"
                        help="Cómo se ganan boletos. Es lo que ve el cliente en el portal."
                    >
                        <UTextarea
                            v-model="estado.regla_participacion"
                            :rows="2"
                            autoresize
                            class="w-full"
                        />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Plazo para reclamar (días)"
                            name="plazo_reclamo_dias"
                        >
                            <UInputNumber
                                v-model="estado.plazo_reclamo_dias"
                                :min="0"
                                :max="3650"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Resolución de la Gobernación"
                            name="resolucion_gobernacion"
                            help="Si ya existe."
                        >
                            <UInput
                                v-model="estado.resolucion_gobernacion"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Premios no reclamados"
                        name="no_reclamados"
                        help="Qué pasa al vencer el plazo (por ejemplo, pasa al primer suplente)."
                    >
                        <UTextarea
                            v-model="estado.no_reclamados"
                            :rows="2"
                            autoresize
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Publicación de resultados"
                        name="publicacion_resultados"
                        help="Forma y medio, inmediatamente después del sorteo."
                    >
                        <UTextarea
                            v-model="estado.publicacion_resultados"
                            :rows="2"
                            autoresize
                            class="w-full"
                            data-prueba="sorteo-publicacion"
                        />
                    </UFormField>
                </fieldset>

                <fieldset class="flex flex-col gap-4">
                    <legend class="mb-2 text-sm font-semibold text-highlighted">
                        Fechas y lugar
                    </legend>
                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            label="Participan desde"
                            name="inscripcion_desde"
                        >
                            <UInput
                                v-model="estado.inscripcion_desde"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Corte"
                            name="corte_en"
                            help="Hora de Guatemala."
                        >
                            <UInput
                                v-model="estado.corte_en"
                                type="datetime-local"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Sorteo"
                            name="fecha_sorteo"
                            help="Hora de Guatemala."
                        >
                            <UInput
                                v-model="estado.fecha_sorteo"
                                type="datetime-local"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Lugar"
                        name="lugar"
                    >
                        <UInput
                            v-model="estado.lugar"
                            class="w-full"
                        />
                    </UFormField>
                </fieldset>

                <fieldset class="flex flex-col gap-4">
                    <legend class="mb-2 text-sm font-semibold text-highlighted">
                        Participación
                    </legend>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Boletos por servicio"
                            name="boletos_por_servicio"
                            help="Por cada servicio activo sin facturas vencidas al corte."
                        >
                            <UInputNumber
                                v-model="estado.boletos_por_servicio"
                                :min="0"
                                :max="100"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Suplentes"
                            name="suplentes"
                            :help="`Además de los ${titulares} titulares (uno por premio).`"
                        >
                            <UInputNumber
                                v-model="estado.suplentes"
                                :min="0"
                                :max="20"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField name="admite_canje">
                        <USwitch
                            v-model="estado.admite_canje"
                            label="Admite boletos canjeados con puntos"
                        />
                    </UFormField>
                </fieldset>

                <fieldset class="flex flex-col gap-3">
                    <legend class="mb-2 text-sm font-semibold text-highlighted">
                        Premios
                    </legend>
                    <ProblemaAlerta
                        v-if="problemaCatalogo"
                        :problema="problemaCatalogo"
                        :reintentar="cargarCatalogo"
                    />
                    <div
                        v-for="(premio, indice) in estado.premios"
                        :key="indice"
                        class="flex flex-col gap-3 rounded-lg border border-default p-3"
                        :data-premio-formulario="indice + 1"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-sm font-medium text-highlighted">Premio {{ indice + 1 }}</span>
                            <div class="flex gap-1">
                                <UButton
                                    icon="i-lucide-arrow-up"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :disabled="indice === 0"
                                    :aria-label="`Subir el premio ${indice + 1}`"
                                    @click="moverPremio(indice, -1)"
                                />
                                <UButton
                                    icon="i-lucide-arrow-down"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    :disabled="indice === estado.premios.length - 1"
                                    :aria-label="`Bajar el premio ${indice + 1}`"
                                    @click="moverPremio(indice, 1)"
                                />
                                <UButton
                                    icon="i-lucide-trash-2"
                                    color="error"
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="`Quitar el premio ${indice + 1}`"
                                    @click="quitarPremio(indice)"
                                />
                            </div>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
                            <div class="grid gap-3 sm:grid-cols-2">
                                <UFormField
                                    label="Nombre"
                                    :name="`premios.${indice}.nombre`"
                                    required
                                    class="sm:col-span-2"
                                >
                                    <UInput
                                        v-model="premio.nombre"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Tipo"
                                    :name="`premios.${indice}.tipo`"
                                    required
                                >
                                    <USelect
                                        v-model="premio.tipo"
                                        :items="itemsTipo"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Valor (libre competencia)"
                                    :name="`premios.${indice}.valor`"
                                    required
                                >
                                    <UInput
                                        v-model="premio.valor"
                                        inputmode="decimal"
                                        placeholder="0.00"
                                        class="w-full"
                                    >
                                        <template #leading>
                                            <span class="text-sm text-muted">Q</span>
                                        </template>
                                    </UInput>
                                </UFormField>
                                <UFormField
                                    label="Cantidad"
                                    :name="`premios.${indice}.cantidad`"
                                >
                                    <UInputNumber
                                        v-model="premio.cantidad"
                                        :min="1"
                                        :max="100"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    v-if="premio.tipo === 'servicio'"
                                    label="Del catálogo de lealtad"
                                    :name="`premios.${indice}.premio_id`"
                                    required
                                >
                                    <USelect
                                        :model-value="premio.premio_id ?? undefined"
                                        :items="itemsCatalogo"
                                        placeholder="Descuento o mes gratis"
                                        class="w-full"
                                        @update:model-value="premio.premio_id = typeof $event === 'number' ? $event : null"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Imagen"
                                    :name="`premios.${indice}.imagen_url`"
                                    help="Dirección de la imagen: https o una ruta que empiece con /."
                                    class="sm:col-span-2"
                                >
                                    <UInput
                                        v-model="premio.imagen_url"
                                        placeholder="/sorteos/premio.svg"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField :name="`premios.${indice}.retiene_isr`">
                                    <USwitch
                                        v-model="premio.retiene_isr"
                                        label="Lleva ISR"
                                        :description="premio.tipo === 'efectivo' ? 'Se retiene de lo que se paga.' : 'En especie lo asume la empresa.'"
                                    />
                                </UFormField>
                                <UFormField
                                    v-if="premio.retiene_isr"
                                    label="ISR (%)"
                                    :name="`premios.${indice}.isr_pct`"
                                >
                                    <UInput
                                        v-model="premio.isr_pct"
                                        inputmode="decimal"
                                        class="w-full"
                                    />
                                </UFormField>
                            </div>
                            <div class="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-default bg-elevated sm:size-28">
                                <img
                                    v-if="premio.imagen_url"
                                    :src="premio.imagen_url"
                                    :alt="premio.nombre || `Premio ${indice + 1}`"
                                    class="size-full object-cover"
                                >
                                <UIcon
                                    v-else
                                    :name="TIPOS_PREMIO_SORTEO[premio.tipo].icono"
                                    class="size-8 text-dimmed"
                                />
                            </div>
                        </div>
                    </div>
                    <UButton
                        label="Agregar premio"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        data-prueba="agregar-premio"
                        @click="agregarPremio"
                    />
                </fieldset>
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
                    form="form-sorteo"
                    :label="sorteo ? 'Guardar cambios' : 'Crear borrador'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-sorteo"
                />
            </div>
        </template>
    </USlideover>
</template>
