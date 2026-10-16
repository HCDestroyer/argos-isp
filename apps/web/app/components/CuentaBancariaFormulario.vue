<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta o edición de una cuenta bancaria propia en un `USlideover`. Sin `cuenta` crea
 * (`POST /cuentas-bancarias`); con `cuenta` edita con su `version` (`PUT`, 409 si alguien más la
 * cambió). Desactivar es `activa: false`: las cuentas no se borran (tienen subcuenta en el libro).
 */
const props = withDefaults(defineProps<{
    cuenta?: CuentaBancaria | null
    bancos: Banco[]
}>(), {
    cuenta: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardada: [cuenta: CuentaBancaria, nueva: boolean]
    recargar: []
}>()

interface EstadoFormulario {
    banco_id: number | undefined
    numero: string
    alias: string
    moneda: SalidaCuentaBancaria['moneda']
    activa: boolean
}

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EstadoFormulario>({ banco_id: undefined, numero: '', alias: '', moneda: 'GTQ', activa: true })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const editando = computed(() => props.cuenta !== null)
const conflicto = computed(() => problema.value?.status === 409 && editando.value && !problema.value.type?.endsWith('duplicada'))

const itemsBanco = computed(() => props.bancos.map(b => ({ label: b.nombre, value: b.id })))
const itemsMoneda: SelectItem[] = Object.entries(MONEDAS_CUENTA).map(([valor, etiqueta]) => ({ label: etiqueta, value: valor }))

function reiniciar() {
    estado.banco_id = props.cuenta?.banco_id
    estado.numero = props.cuenta?.numero ?? ''
    estado.alias = props.cuenta?.alias ?? ''
    estado.moneda = props.cuenta?.moneda ?? 'GTQ'
    estado.activa = props.cuenta?.activa ?? true
    problema.value = null
    formulario.value?.clear()
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar()
    }
}, { immediate: true })
watch(() => props.cuenta, () => {
    if (abierto.value) {
        reiniciar()
    }
})

async function guardar(evento: FormSubmitEvent<SalidaCuentaBancaria>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const resultado = props.cuenta
        ? await useCuentasBancarias().editar(props.cuenta.id, { ...datos, version: props.cuenta.version })
        : await useCuentasBancarias().crear(datos)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        if (resultado.problema.status === 409 && resultado.problema.type?.endsWith('duplicada')) {
            formulario.value?.setErrors([{ name: 'numero', message: resultado.problema.detail ?? 'Ese número ya está registrado en este banco' }])
        }
        return
    }
    abierto.value = false
    emit('guardada', resultado.data, !props.cuenta)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="editando ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'"
        description="Cuenta propia donde entran depósitos, transferencias, ACH y remesas."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaCuentaBancaria"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="guardar"
            >
                <UFormField
                    label="Banco"
                    name="banco_id"
                    required
                >
                    <USelectMenu
                        v-model="estado.banco_id"
                        :items="itemsBanco"
                        value-key="value"
                        placeholder="Elegir banco…"
                        icon="i-lucide-landmark"
                        :search-input="{ placeholder: 'Buscar banco…' }"
                        class="w-full"
                        aria-label="Banco"
                    />
                </UFormField>
                <UFormField
                    label="Alias"
                    name="alias"
                    required
                    description="Cómo la verá el cajero, p. ej. «Monetaria» o «Ahorro cobros»"
                >
                    <UInput
                        v-model="estado.alias"
                        autocomplete="off"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Número de cuenta"
                    name="numero"
                    required
                >
                    <UInput
                        v-model="estado.numero"
                        autocomplete="off"
                        placeholder="3-123-45678-9"
                        class="w-full font-mono"
                    />
                </UFormField>
                <UFormField
                    label="Moneda"
                    name="moneda"
                    required
                    help="Las cuentas en dólares no reciben pagos (no hay tipo de cambio)."
                >
                    <USelect
                        v-model="estado.moneda"
                        :items="itemsMoneda"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    name="activa"
                    :help="estado.activa ? undefined : 'Inactiva: deja de aparecer en el cobro y en el portal; sus pagos anteriores se conservan.'"
                >
                    <USwitch
                        v-model="estado.activa"
                        label="Activa (recibe pagos)"
                    />
                </UFormField>
                <p
                    v-if="cuenta"
                    class="text-xs text-muted"
                >
                    Subcuenta contable {{ cuenta.cuenta_codigo }} · versión {{ cuenta.version }}
                </p>

                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió esta cuenta"
                    description="Recarga para ver la versión actual y vuelve a aplicar tus cambios."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('recargar') }]"
                    data-prueba="conflicto-version"
                />
                <ProblemaAlerta
                    v-else-if="problema && problema.status !== 422 && problema.status !== 409"
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
                    :label="editando ? 'Guardar cambios' : 'Crear cuenta'"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </USlideover>
</template>
