<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de una regla de conciliación (`POST`/`PUT /bancos/reglas`, `bancos.conciliar`).
 * La edición manda la `version` leída: si otra persona la cambió, la API responde 409.
 */
const props = withDefaults(defineProps<{
    regla?: ReglaConciliacion | null
}>(), {
    regla: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [regla: ReglaConciliacion]
}>()

const formulario = useTemplateRef('formulario')
const esquema = esquemaRegla()
const estado = reactive<EntradaRegla>(entradaReglaVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsCondicion: SelectItem[] = Object.entries(CONDICIONES_REGLA).map(([value, label]) => ({ label, value }))
const itemsAccion: SelectItem[] = Object.entries(ACCIONES_REGLA).map(([value, a]) => ({ label: a.etiqueta, value, description: a.descripcion }))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.regla ? entradaDeRegla(props.regla) : entradaReglaVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaRegla>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoRegla(evento.data)
    const resultado = props.regla
        ? await useReglasConciliacion().editar(props.regla.id, { ...cuerpo, version: props.regla.version }, clave)
        : await useReglasConciliacion().crear(cuerpo, clave)
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
        :title="regla ? `Editar regla · ${regla.nombre}` : 'Nueva regla de conciliación'"
        description="Al aplicar reglas a un extracto, cada línea sin conciliar toma la primera regla que coincide (menor prioridad primero)."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-regla"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Comisiones del banco"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Condición"
                        name="tipo_condicion"
                        required
                    >
                        <USelect
                            v-model="estado.tipo_condicion"
                            :items="itemsCondicion"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Patrón"
                        name="patron"
                        required
                        :help="estado.tipo_condicion === 'contiene' ? 'Sin distinguir mayúsculas.' : 'Expresión regular sobre la descripción.'"
                    >
                        <UInput
                            v-model="estado.patron"
                            :placeholder="estado.tipo_condicion === 'contiene' ? 'comision' : '^CREDITO TRANSF'"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto desde"
                        name="monto_min"
                        help="Con signo: − sale de la cuenta."
                    >
                        <UInput
                            v-model="estado.monto_min"
                            inputmode="decimal"
                            placeholder="-100.00"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto hasta"
                        name="monto_max"
                    >
                        <UInput
                            v-model="estado.monto_max"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Solo en la cuenta"
                        name="cuenta_id"
                        class="sm:col-span-2"
                    >
                        <CuentaBancoSelect
                            v-model="estado.cuenta_id"
                            con-todas
                        />
                    </UFormField>
                    <UFormField
                        label="Acción"
                        name="accion"
                        required
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.accion"
                            :items="itemsAccion"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.accion === 'contrapartida'"
                        label="Cuenta contrapartida"
                        name="contrapartida"
                        required
                    >
                        <UInput
                            v-model="estado.contrapartida"
                            placeholder="5.3.07"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Prioridad"
                        name="prioridad"
                        help="0 a 1000; la menor se prueba primero."
                    >
                        <UInputNumber
                            v-model="estado.prioridad"
                            :min="0"
                            :max="1000"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Estado"
                        name="activa"
                    >
                        <USwitch
                            v-model="estado.activa"
                            :label="estado.activa ? 'Activa' : 'Inactiva'"
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
                    form="form-regla"
                    :label="regla ? 'Guardar' : 'Crear regla'"
                    icon="i-lucide-save"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
