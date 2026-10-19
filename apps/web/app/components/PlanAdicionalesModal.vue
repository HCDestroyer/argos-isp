<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Edita la lista de adicionales de un plan (`PUT /planes/:id/adicionales`, `planes.editar`, con la
 * `version` del plan; 409 si cambió). El catálogo sale de `GET /adicionales` (`adicionales.ver`):
 * con alcance global, el de todas las empresas. Un adicional desactivado que ya estaba se puede
 * conservar o quitar, pero no agregar.
 */
const props = defineProps<{
    plan: Plan
    actuales: AdicionalPlan[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [lista: AdicionalPlan[]] }>()

const usuario = useUsuarioActual()
const { conSelector: variasEmpresas, nombre: nombreEmpresa } = useEmpresaActiva()
const idFormulario = useId()
const formulario = useTemplateRef('formulario')

const estado = reactive<EntradaAdicionalesPlan>({ adicionales: [] })
const catalogo = shallowRef<Adicional[]>([])
const cargandoCatalogo = ref(false)
const problemaCatalogo = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const items = computed<SelectItem[]>(() => {
    const vistos = new Set<number>()
    const lista: SelectItem[] = []
    for (const a of catalogo.value) {
        vistos.add(a.id)
        lista.push({ label: `${a.nombre} · ${a.codigo}${variasEmpresas.value ? ` · ${nombreEmpresa(a.empresa_id)}` : ''}`, value: a.id })
    }
    for (const a of props.actuales) {
        if (!vistos.has(a.adicional_id)) {
            lista.push({ label: `${a.adicional_nombre} · ${a.adicional_codigo} (desactivado)`, value: a.adicional_id })
        }
    }
    return lista
})

async function cargarCatalogo() {
    cargandoCatalogo.value = true
    problemaCatalogo.value = null
    const resultado = await useAdicionales().activos(usuario.value?.alcance_global ? { empresas: 'todas' } : {})
    cargandoCatalogo.value = false
    catalogo.value = resultado.ok ? resultado.data : []
    problemaCatalogo.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        estado.adicionales = props.actuales.map(a => ({ adicional_id: a.adicional_id, cantidad: a.cantidad }))
        problema.value = null
        void cargarCatalogo()
    }
}, { immediate: true })

function agregar() {
    estado.adicionales.push({ adicional_id: null, cantidad: 1 })
}

function quitar(indice: number) {
    estado.adicionales.splice(indice, 1)
}

async function enviar(evento: FormSubmitEvent<SalidaAdicionalesPlan>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePlanes().definirAdicionales(props.plan.id, props.plan.version, cuerpoAdicionalesPlan(evento.data))
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
        :title="`Adicionales de ${plan.nombre}`"
        description="Aplica desde la próxima alta o cambio de plan; los servicios actuales no cambian."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAdicionalesPlan"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <ProblemaAlerta
                    v-if="problemaCatalogo"
                    :problema="problemaCatalogo"
                    :reintentar="cargarCatalogo"
                    :reintentando="cargandoCatalogo"
                />
                <p
                    v-if="!estado.adicionales.length"
                    class="text-sm text-muted"
                >
                    Sin adicionales: los servicios nuevos con este plan no reciben ninguno.
                </p>
                <ul
                    v-else
                    class="flex flex-col gap-3"
                >
                    <li
                        v-for="(fila, indice) in estado.adicionales"
                        :key="indice"
                        class="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2"
                        :data-prueba="`fila-adicional-plan-${indice}`"
                    >
                        <UFormField
                            :name="`adicionales.${indice}.adicional_id`"
                            :label="indice === 0 ? 'Adicional' : undefined"
                        >
                            <USelect
                                v-model="fila.adicional_id"
                                :items="items"
                                :loading="cargandoCatalogo"
                                placeholder="Elige el adicional"
                                :aria-label="`Adicional ${indice + 1}`"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            :name="`adicionales.${indice}.cantidad`"
                            :label="indice === 0 ? 'Cantidad' : undefined"
                        >
                            <UInputNumber
                                v-model="fila.cantidad"
                                :min="1"
                                :max="50"
                                :aria-label="`Cantidad del adicional ${indice + 1}`"
                                class="w-full"
                            />
                        </UFormField>
                        <UButton
                            icon="i-lucide-trash-2"
                            color="neutral"
                            variant="ghost"
                            :class="indice === 0 ? 'mt-6' : ''"
                            :aria-label="`Quitar el adicional ${indice + 1}`"
                            @click="quitar(indice)"
                        />
                    </li>
                </ul>
                <UFormField name="adicionales">
                    <UButton
                        label="Agregar adicional"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :disabled="estado.adicionales.length >= 100"
                        data-prueba="agregar-fila-adicional"
                        @click="agregar"
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
                    :form="idFormulario"
                    label="Guardar lista"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-adicionales-plan"
                />
            </div>
        </template>
    </UModal>
</template>
