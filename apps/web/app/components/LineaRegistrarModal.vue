<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Registra una línea del extracto sin documento (`POST /bancos/extractos/lineas/:id/registrar`,
 * `bancos.conciliar`): un asiento nuevo (origen `banco`) que queda conciliado con la línea. Un
 * cargo va contra 5.3.07 Gastos y comisiones bancarias si no se indica otra; un abono (interés,
 * otro ingreso) necesita su contrapartida.
 */
const props = defineProps<{
    linea: LineaExtracto
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [conciliacion: Conciliacion]
}>()

const formulario = useTemplateRef('formulario')
const esquema = computed(() => esquemaRegistrarLinea(props.linea.monto))
const estado = reactive<EntradaRegistrarLinea>({ cuenta: '', descripcion: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const abono = computed(() => !props.linea.monto.startsWith('-'))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { cuenta: '', descripcion: props.linea.descripcion })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<EntradaRegistrarLinea>) {
    enviando.value = true
    problema.value = null
    const resultado = await useExtractos().registrarLinea(props.linea.id, {
        cuenta: evento.data.cuenta || null,
        descripcion: evento.data.descripcion || null,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar desde el extracto"
        :description="`${formatearFecha(linea.fecha)} · ${linea.descripcion} · ${montoConSigno(linea.monto)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-registrar-linea"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-file-plus"
                    :description="abono
                        ? 'Abono sin documento: se registra Banco / contrapartida con la fecha de la línea y queda conciliado.'
                        : 'Cargo sin documento: se registra contrapartida / Banco (5.3.07 si no indicas otra) con la fecha de la línea y queda conciliado.'"
                />
                <UFormField
                    label="Cuenta contrapartida"
                    name="cuenta"
                    :required="abono"
                    :help="abono ? 'Código de la cuenta: interés u otro ingreso (ej. 4.1.03).' : 'Vacía: 5.3.07 Gastos y comisiones bancarias.'"
                >
                    <UInput
                        v-model="estado.cuenta"
                        :placeholder="abono ? '4.1.03' : '5.3.07'"
                        class="w-full font-mono"
                        data-prueba="registrar-cuenta"
                    />
                </UFormField>
                <UFormField
                    label="Descripción del asiento"
                    name="descripcion"
                >
                    <UInput
                        v-model="estado.descripcion"
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="registrar-error"
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
                    form="form-registrar-linea"
                    label="Registrar y conciliar"
                    icon="i-lucide-file-plus"
                    :loading="enviando"
                    data-prueba="registrar-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
