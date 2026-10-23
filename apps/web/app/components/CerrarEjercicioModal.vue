<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Cierra el ejercicio anual de la empresa activa (`POST /libro/ejercicios/cerrar`,
 * `libro.cerrar_ejercicio`). Si el año tiene declaración ISR anual revisada o presentada, el ISR y lo
 * acreditado salen de ella: no se piden y se muestran (con `isr` en el cuerpo la API responde 422
 * `isr_de_declaracion`; sin revisar, 422 `declaracion_sin_revisar`; desactualizada, 409
 * `declaracion_desactualizada`). Sin declaración, el ISR se escribe a mano (0.00 si no hay).
 */
const props = defineProps<{
    empresaId: number
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [cierre: CierreAnual] }>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const anioActual = Number(hoy.slice(0, 4))
const anio = ref(anioActual - 1)
const itemsAnio: SelectItem[] = [1, 2, 3].map(n => ({ label: String(anioActual - n), value: anioActual - n }))
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const vacio = (): EntradaIsrManual => ({ monto: '', acreditado_trimestral: '', acreditado_iso: '', nota: '' })
const manual = reactive<EntradaIsrManual>(vacio())
const confirmo = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/* La declaración ISR anual del año (su última versión), si la hay. */
const declaracion = shallowRef<Declaracion | null>(null)
const buscando = ref(false)
const problemaDeclaracion = ref<Problem | null>(null)
/** `declaracion`: el ISR sale de la declaración; `manual`: se escribe; `sin_revisar`: hay que revisarla antes. */
const modo = computed<'declaracion' | 'manual' | 'sin_revisar'>(() => {
    if (!declaracion.value) {
        return 'manual'
    }
    return declaracion.value.estado === 'revisada' || declaracion.value.estado === 'presentada' ? 'declaracion' : 'sin_revisar'
})

async function buscarDeclaracion() {
    declaracion.value = null
    problemaDeclaracion.value = null
    if (!puede('declaraciones.ver')) {
        return
    }
    buscando.value = true
    const pedido = anio.value
    const resultado = await useDeclaraciones().listar({ impuesto: ['isr_anual'], periodo: String(pedido), limit: 20 })
    if (pedido !== anio.value) {
        return
    }
    buscando.value = false
    declaracion.value = resultado.ok ? versionVigente(resultado.data.data.filter(d => d.empresa_id === props.empresaId)) : null
    problemaDeclaracion.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        anio.value = anioActual - 1
        Object.assign(manual, vacio())
        confirmo.value = false
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
        void buscarDeclaracion()
    }
})

watch(anio, () => {
    problema.value = null
    clave = nuevaClaveIdempotencia()
    void buscarDeclaracion()
})

async function cerrar(cuerpo: CuerpoCerrarEjercicio) {
    enviando.value = true
    problema.value = null
    const resultado = await useEjercicios().cerrar(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.replace(/^isr\./, '') }))
    if (resultado.problema.status === 422 && codigoProblema(resultado.problema) === 'validacion' && errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaDeclaracionLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
    // Otra persona revisó o calculó la declaración entretanto: se vuelve a leer.
    if (['isr_de_declaracion', 'declaracion_sin_revisar', 'declaracion_desactualizada'].includes(codigoProblema(resultado.problema) ?? '')) {
        void buscarDeclaracion()
    }
}

function conManual(evento: FormSubmitEvent<NonNullable<CuerpoCerrarEjercicio['isr']>>) {
    void cerrar({ empresa_id: props.empresaId, anio: anio.value, isr: evento.data })
}

function conDeclaracion() {
    void cerrar({ empresa_id: props.empresaId, anio: anio.value })
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Cerrar ejercicio"
        description="Provisiona el ISR, cancela ingresos y gastos contra resultados, traslada el resultado, registra la reserva legal y cierra diciembre, con fecha 31 de diciembre."
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField
                    label="Año"
                    required
                >
                    <USelect
                        v-model="anio"
                        :items="itemsAnio"
                        class="w-full sm:w-40"
                        data-prueba="cerrar-anio"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problemaDeclaracion"
                    :problema="problemaDeclaracion"
                    :reintentar="buscarDeclaracion"
                    :reintentando="buscando"
                />
                <USkeleton
                    v-else-if="buscando"
                    class="h-24 w-full"
                />
                <template v-else-if="modo === 'declaracion' && declaracion">
                    <UAlert
                        color="info"
                        variant="subtle"
                        icon="i-lucide-file-check"
                        :title="`El ISR sale de la declaración ISR anual ${anio} (versión ${declaracion.version})`"
                        description="No se escribe a mano: el cierre provisiona estos montos de la versión revisada."
                        data-prueba="cerrar-isr-declaracion"
                    />
                    <dl class="grid grid-cols-3 gap-3 text-sm">
                        <DatoFicha
                            etiqueta="ISR del año"
                            :valor="formatearQuetzales(totalDe(declaracion, 'isr'))"
                        />
                        <DatoFicha
                            etiqueta="Pagos trimestrales"
                            :valor="formatearQuetzales(totalDe(declaracion, 'trimestral_acreditado'))"
                        />
                        <DatoFicha
                            etiqueta="ISO acreditado"
                            :valor="formatearQuetzales(totalDe(declaracion, 'iso_acreditado'))"
                        />
                    </dl>
                    <ULink
                        v-if="puede('declaraciones.ver')"
                        :to="`/declaraciones/${declaracion.id}`"
                        class="self-start text-sm text-primary underline underline-offset-2"
                    >
                        Ver la declaración
                    </ULink>
                </template>
                <UAlert
                    v-else-if="modo === 'sin_revisar' && declaracion"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-file-pen-line"
                    :title="`La declaración ISR anual ${anio} no está revisada`"
                    :description="`Su última versión (${declaracion.version}) está en ${ESTADOS_DECLARACION[declaracion.estado].etiqueta.toLowerCase()}: el cierre toma el ISR de ella, así que primero hay que revisarla.`"
                    :actions="puede('declaraciones.ver') ? [{ label: 'Abrir la declaración', color: 'warning', variant: 'outline', to: `/declaraciones/${declaracion.id}` }] : undefined"
                    data-prueba="cerrar-declaracion-sin-revisar"
                />
                <UForm
                    v-else
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaIsrManual"
                    :state="manual"
                    class="flex flex-col gap-4"
                    data-prueba="cerrar-isr-manual"
                    @submit="conManual"
                >
                    <p class="text-sm text-muted">
                        {{ anio }} no tiene declaración ISR anual en ArgosIsp: escriba el ISR del ejercicio (0.00 si no hay) y lo que se acredita.
                    </p>
                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            label="ISR del ejercicio"
                            name="monto"
                            required
                        >
                            <UInput
                                v-model="manual.monto"
                                inputmode="decimal"
                                placeholder="0.00"
                                class="w-full"
                                data-prueba="cerrar-isr-monto"
                            />
                        </UFormField>
                        <UFormField
                            label="Pagos trimestrales"
                            name="acreditado_trimestral"
                            hint="1.1.07"
                        >
                            <UInput
                                v-model="manual.acreditado_trimestral"
                                inputmode="decimal"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="ISO acreditado"
                            name="acreditado_iso"
                            hint="1.1.08"
                        >
                            <UInput
                                v-model="manual.acreditado_iso"
                                inputmode="decimal"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Nota"
                        name="nota"
                        help="De dónde sale el monto (formulario, cálculo del contador…)."
                    >
                        <UTextarea
                            v-model="manual.nota"
                            :rows="2"
                            class="w-full"
                        />
                    </UFormField>
                </UForm>

                <UCheckbox
                    v-model="confirmo"
                    :label="`Entiendo que el cierre de ${anio} registra sus asientos con fecha 31/12 y cierra diciembre`"
                    data-prueba="cerrar-confirmo"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="cerrar-problema"
                />
            </div>
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
                    v-if="modo === 'manual'"
                    type="submit"
                    :form="idFormulario"
                    :label="`Cerrar ${anio}`"
                    icon="i-lucide-lock"
                    :disabled="!confirmo || buscando || problemaDeclaracion !== null || !puede('libro.cerrar_ejercicio')"
                    :loading="enviando"
                    data-prueba="cerrar-confirmar"
                />
                <UButton
                    v-else
                    :label="`Cerrar ${anio}`"
                    icon="i-lucide-lock"
                    :disabled="!confirmo || modo !== 'declaracion' || buscando || !puede('libro.cerrar_ejercicio')"
                    :loading="enviando"
                    data-prueba="cerrar-confirmar"
                    @click="conDeclaracion"
                />
            </div>
        </template>
    </UModal>
</template>
