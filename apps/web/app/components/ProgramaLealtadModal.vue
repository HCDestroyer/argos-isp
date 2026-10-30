<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta y edición del programa de lealtad de la empresa (`POST`/`PUT /lealtad/programas`,
 * `lealtad.configurar`). Se crea inactivo; con diferimiento (NIIF 15) la API exige las cuentas
 * 2.1.10, 4.1.05 y 4.1.06 (422 `cuentas_lealtad_faltantes`), que se muestra aquí.
 */
const props = withDefaults(defineProps<{
    programa?: ProgramaLealtad | null
}>(), {
    programa: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [programa: ProgramaLealtad]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPrograma>(entradaProgramaVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const pasivo = computed(() => valorPasivoPunto(estado.valor_punto, estado.canje_esperado_pct))
const sinPlazo = computed(() => terminosSinPlazo(estado.terminos, estado.vence))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.programa ? entradaDePrograma(props.programa) : entradaProgramaVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaPrograma>) {
    enviando.value = true
    problema.value = null
    const resultado = props.programa
        ? await useProgramasLealtad().editar(props.programa.id, cuerpoEdicionPrograma(props.programa, evento.data))
        : await useProgramasLealtad().crear(cuerpoPrograma(evento.data), clave)
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
        :title="programa ? `Editar ${programa.nombre}` : 'Nuevo programa de lealtad'"
        description="Un programa por empresa. Los puntos son enteros y valen en quetzales según el valor del punto."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-programa-lealtad"
                ref="formulario"
                :schema="esquemaPrograma"
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
                            class="w-full"
                            data-prueba="programa-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Valor del punto"
                        name="valor_punto"
                        required
                        help="Lo que vale un punto al canjearlo."
                    >
                        <UInput
                            v-model="estado.valor_punto"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="programa-valor-punto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Canje esperado"
                        name="canje_esperado_pct"
                        required
                        :help="pasivo ? `Pasivo por punto: Q ${pasivo.toFixed(6)}` : 'Porcentaje de puntos que se espera canjear.'"
                    >
                        <UInput
                            v-model="estado.canje_esperado_pct"
                            inputmode="decimal"
                            class="w-full"
                        >
                            <template #trailing>
                                <span class="text-sm text-muted">%</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        name="diferimiento"
                        class="sm:col-span-2"
                        help="NIIF 15: los puntos son un pasivo (2.1.10) y cada movimiento lleva su asiento. Sin diferimiento son solo un indicador."
                    >
                        <USwitch
                            v-model="estado.diferimiento"
                            label="Diferir el ingreso de los puntos"
                        />
                    </UFormField>
                    <UFormField
                        name="vence"
                        help="Los términos deben decir el plazo (inv. F.4)."
                    >
                        <USwitch
                            v-model="estado.vence"
                            label="Los puntos vencen"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.vence"
                        label="Vencen a los"
                        name="vencimiento_meses"
                        required
                    >
                        <UInputNumber
                            v-model="estado.vencimiento_meses"
                            :min="1"
                            :max="120"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Avisar con días de anticipación"
                        name="aviso_vencimiento_dias"
                    >
                        <UInputNumber
                            v-model="estado.aviso_vencimiento_dias"
                            :min="0"
                            :max="365"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Mínimo para canjear"
                        name="minimo_canje"
                        help="En puntos."
                    >
                        <UInputNumber
                            v-model="estado.minimo_canje"
                            :min="0"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Vigente desde"
                        name="vigente_desde"
                        help="Vacío: hoy. Nada es retroactivo."
                    >
                        <UInput
                            v-model="estado.vigente_desde"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Vigente hasta"
                        name="vigente_hasta"
                        help="Vacío: sin fin."
                    >
                        <UInput
                            v-model="estado.vigente_hasta"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <div
                        v-if="programa"
                        class="flex flex-col gap-3 sm:col-span-2"
                        data-prueba="programa-portal"
                    >
                        <USwitch
                            v-model="estado.visible_portal"
                            label="Mostrar los puntos en el portal del cliente"
                            description="El cliente ve su saldo, movimientos y los premios del catálogo."
                            data-prueba="programa-visible-portal"
                        />
                        <UFormField name="canje_portal">
                            <USwitch
                                v-model="estado.canje_portal"
                                :disabled="!estado.visible_portal"
                                label="Permitir canjear desde el portal"
                                description="Solo los premios marcados «en el portal»."
                                data-prueba="programa-canje-portal"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Términos"
                        name="terminos"
                        class="sm:col-span-2"
                        help="Se publican en el portal del cliente."
                    >
                        <UTextarea
                            v-model="estado.terminos"
                            :rows="4"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UAlert
                    v-if="sinPlazo"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    description="Los términos no mencionan cuándo vencen los puntos: la ley pide decir el plazo."
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="programa-error"
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
                    form="form-programa-lealtad"
                    :label="programa ? 'Guardar' : 'Crear programa'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="programa-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
