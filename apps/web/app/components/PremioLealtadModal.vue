<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Alta y edición de un premio del catálogo de lealtad (A3, `lealtad.configurar`): tipo, costo en
 * puntos y los datos de su tipo (descuento, mejora de plan con su plan y días, bien con su costo,
 * boletos de un sorteo), existencias, si se ofrece en el portal y si está activo. El tipo no cambia
 * al editar. Los planes se eligen con `planes.ver` y los sorteos con `sorteos.ver`.
 */
const props = withDefaults(defineProps<{
    programa: ProgramaLealtad
    premio?: PremioLealtad | null
}>(), {
    premio: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [premio: PremioLealtad] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPremio>(entradaPremio(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const planes = shallowRef<SelectItem[] | null>(null)
const sorteos = shallowRef<SelectItem[] | null>(null)
let clave = nuevaClaveIdempotencia()

async function cargarOpciones() {
    const [listaPlanes, listaSorteos] = await Promise.all([
        puede('planes.ver') ? usePlanes().listar({ activo: true }) : null,
        puede('sorteos.ver') ? useSorteos().listar() : null,
    ])
    planes.value = listaPlanes?.ok ? listaPlanes.data.data.map(p => ({ label: p.nombre, value: p.id })) : null
    sorteos.value = listaSorteos?.ok ? listaSorteos.data.data.map(s => ({ label: s.nombre, value: s.id })) : null
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaPremio(props.premio))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarOpciones()
    }
}, { immediate: true })

const itemsTipo: SelectItem[] = (Object.keys(TIPOS_PREMIO) as TipoPremio[]).map(t => ({ label: TIPOS_PREMIO[t].etiqueta, value: t, icon: TIPOS_PREMIO[t].icono, description: TIPOS_PREMIO[t].descripcion }))
const itemsDescuento: SelectItem[] = [
    { label: 'Monto fijo (Q)', value: 'monto' },
    { label: 'Porcentaje de la factura', value: 'porcentaje' },
]

function numeroONulo(valor: unknown): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

async function enviar(evento: FormSubmitEvent<SalidaPremio>) {
    enviando.value = true
    problema.value = null
    const resultado = props.premio
        ? await usePremiosLealtad().editar(props.premio.id, cambiosPremio(props.premio, evento.data))
        : await usePremiosLealtad().crear(cuerpoPremio(props.programa.id, evento.data), clave)
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
        :title="premio ? `Editar ${premio.nombre}` : 'Nuevo premio'"
        :description="`Catálogo de ${programa.nombre}. Un punto vale ${formatearQuetzales(programa.valor_punto)}.`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-premio"
                ref="formulario"
                :schema="esquemaPremio"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Tipo"
                    name="tipo"
                    :help="premio ? 'El tipo no cambia después de crear el premio.' : undefined"
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        :disabled="premio !== null"
                        class="w-full"
                        data-prueba="premio-tipo"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Q25 de descuento"
                            class="w-full"
                            data-prueba="premio-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Costo en puntos"
                        name="costo_puntos"
                        :help="typeof estado.costo_puntos === 'number' ? `Equivale a ${formatearQuetzales(new Decimal(programa.valor_punto).times(estado.costo_puntos))}` : undefined"
                        required
                    >
                        <UInputNumber
                            v-model="estado.costo_puntos"
                            :min="1"
                            :format-options="{ useGrouping: false }"
                            class="w-full"
                            data-prueba="premio-costo"
                        />
                    </UFormField>
                    <UFormField
                        label="Existencias"
                        name="existencias"
                        help="Vacío = sin límite."
                    >
                        <UInputNumber
                            :model-value="estado.existencias ?? undefined"
                            :min="0"
                            placeholder="Sin límite"
                            class="w-full"
                            @update:model-value="v => estado.existencias = numeroONulo(v)"
                        />
                    </UFormField>
                </div>

                <div
                    v-if="estado.tipo === 'descuento_factura'"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Descuento"
                        name="descuento_tipo"
                    >
                        <USelect
                            v-model="estado.descuento_tipo"
                            :items="itemsDescuento"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        :label="estado.descuento_tipo === 'porcentaje' ? 'Porcentaje' : 'Monto'"
                        name="descuento_valor"
                        required
                    >
                        <UInput
                            v-model="estado.descuento_valor"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="premio-descuento"
                        >
                            <template
                                v-if="estado.descuento_tipo === 'monto'"
                                #leading
                            >
                                <span class="text-sm text-muted">Q</span>
                            </template>
                            <template
                                v-else
                                #trailing
                            >
                                <span class="text-sm text-muted">%</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        v-if="estado.descuento_tipo === 'porcentaje'"
                        label="Tope"
                        name="tope"
                        help="Vacío = sin tope."
                    >
                        <UInput
                            v-model="estado.tope"
                            inputmode="decimal"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                </div>

                <div
                    v-if="estado.tipo === 'mejora_plan'"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Plan"
                        name="plan_destino_id"
                        :help="planes ? undefined : 'Sin la lista de planes: escribe el id.'"
                        required
                    >
                        <USelect
                            v-if="planes"
                            :model-value="estado.plan_destino_id ?? undefined"
                            :items="planes"
                            placeholder="Elige el plan"
                            class="w-full"
                            data-prueba="premio-plan"
                            @update:model-value="v => estado.plan_destino_id = numeroONulo(v)"
                        />
                        <UInputNumber
                            v-else
                            :model-value="estado.plan_destino_id ?? undefined"
                            :min="1"
                            class="w-full"
                            @update:model-value="v => estado.plan_destino_id = numeroONulo(v)"
                        />
                    </UFormField>
                    <UFormField
                        label="Días"
                        name="dias"
                        required
                    >
                        <UInputNumber
                            :model-value="estado.dias ?? undefined"
                            :min="1"
                            :max="366"
                            class="w-full"
                            data-prueba="premio-dias"
                            @update:model-value="v => estado.dias = numeroONulo(v)"
                        />
                    </UFormField>
                </div>

                <UFormField
                    v-if="estado.tipo === 'bien'"
                    label="Costo unitario"
                    name="costo_unitario"
                    help="Lo que cuesta a la empresa (para el libro)."
                >
                    <UInput
                        v-model="estado.costo_unitario"
                        inputmode="decimal"
                        class="w-full"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>

                <div
                    v-if="estado.tipo === 'boletos'"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Sorteo"
                        name="sorteo_id"
                        help="Debe admitir canjes y no haber cerrado el corte."
                        required
                    >
                        <USelect
                            v-if="sorteos"
                            :model-value="estado.sorteo_id ?? undefined"
                            :items="sorteos"
                            placeholder="Elige el sorteo"
                            class="w-full"
                            @update:model-value="v => estado.sorteo_id = numeroONulo(v)"
                        />
                        <UInputNumber
                            v-else
                            :model-value="estado.sorteo_id ?? undefined"
                            :min="1"
                            class="w-full"
                            @update:model-value="v => estado.sorteo_id = numeroONulo(v)"
                        />
                    </UFormField>
                    <UFormField
                        label="Boletos por canje"
                        name="boletos"
                        required
                    >
                        <UInputNumber
                            :model-value="estado.boletos ?? undefined"
                            :min="1"
                            :max="1000"
                            class="w-full"
                            @update:model-value="v => estado.boletos = numeroONulo(v)"
                        />
                    </UFormField>
                </div>

                <USwitch
                    v-model="estado.en_portal"
                    label="Ofrecer en el portal del cliente"
                    :description="programa.canje_portal ? 'El cliente lo puede canjear él mismo.' : 'El programa todavía no permite canjear en el portal.'"
                />
                <USwitch
                    v-model="estado.activo"
                    label="Activo"
                    description="Inactivo: no se puede canjear; los canjes hechos no cambian."
                />
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
                    form="form-premio"
                    :label="premio ? 'Guardar cambios' : 'Crear premio'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="premio-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
