<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta directa de un activo fijo (`POST /activos`, `activos.registrar`): inventario inicial o aporte, con
 * su contrapartida (saldos de apertura, capital o utilidades acumuladas). Un activo comprado nace con su
 * compra (línea «activo fijo»). La tasa no pasa del máximo legal de la clase (422 `tasa_sobre_tope`).
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [activo: ActivoFijo]
}>()

const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')
const esquema = esquemaActivo(hoy)
const estado = reactive<EntradaActivo>(activoVacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsClase: SelectItem[] = Object.entries(CLASES_ACTIVO).map(([value, label]) => ({ label, value }))
const itemsContrapartida: SelectItem[] = Object.entries(CONTRAPARTIDAS_ACTIVO).map(([value, label]) => ({ label, value, description: value }))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, activoVacio())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaActivo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useActivos().registrar(cuerpoActivo(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length && errores.every(e => e.name && e.name in estado)) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaCompraLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Alta de activo fijo"
        description="Para el inventario inicial o un aporte. Un activo comprado se registra con su compra."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-activo"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Clase"
                        name="clase"
                        required
                    >
                        <USelect
                            v-model="estado.clase"
                            :items="itemsClase"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha de alta"
                        name="fecha_alta"
                        help="Vacía: hoy. Se deprecia desde el mes siguiente."
                    >
                        <UInput
                            v-model="estado.fecha_alta"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.descripcion"
                            class="w-full"
                            data-prueba="activo-descripcion"
                        />
                    </UFormField>
                    <UFormField
                        label="Serie"
                        name="serie"
                    >
                        <UInput
                            v-model="estado.serie"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Ubicación"
                        name="ubicacion"
                        help="Sitio, nodo o cliente (CPE en comodato)."
                    >
                        <UInput
                            v-model="estado.ubicacion"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Costo"
                        name="costo"
                        required
                        help="Sin el IVA tomado como crédito fiscal."
                    >
                        <UInput
                            v-model="estado.costo"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="activo-costo"
                        />
                    </UFormField>
                    <UFormField
                        label="Valor residual"
                        name="valor_residual"
                    >
                        <UInput
                            v-model="estado.valor_residual"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Depreciación acumulada al alta"
                        name="depreciacion_inicial"
                        help="Si llega ya depreciado (inventario inicial)."
                    >
                        <UInput
                            v-model="estado.depreciacion_inicial"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Tasa anual"
                        name="tasa_anual"
                        help="Vacía: el máximo legal de la clase."
                    >
                        <UInput
                            v-model="estado.tasa_anual"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="activo-tasa"
                        >
                            <template #trailing>
                                <span class="text-xs text-muted">%</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Contrapartida"
                        name="contrapartida"
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.contrapartida"
                            :items="itemsContrapartida"
                            class="w-full"
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
                    form="form-activo"
                    label="Dar de alta"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="guardar-activo"
                />
            </div>
        </template>
    </UModal>
</template>
