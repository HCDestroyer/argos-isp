<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Importa un extracto bancario (`POST /bancos/extractos`, `bancos.importar_extracto`). El panel
 * lee el CSV en el formato neutral (`leerExtractoCsv`), calcula el sha256 del archivo y muestra las
 * líneas y si cuadran antes de enviar. Errores de la API legibles: 422 `extracto_descuadrado`,
 * 422 `extracto_no_encadena` (pide el motivo para forzarlo) y 409 `extracto_duplicado` con las
 * líneas ya importadas.
 */
const props = withDefaults(defineProps<{
    /** Cuenta propuesta (la del filtro de la lista). */
    cuentaId?: number | null
}>(), {
    cuentaId: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [extracto: Extracto]
}>()

const formulario = useTemplateRef('formulario')
const esquema = esquemaExtracto()
const estado = reactive<EntradaExtracto>({ cuenta_id: null, desde: '', hasta: '', saldo_inicial: '', saldo_final: '', motivo_no_encadena: '' })
const archivo = ref<File | null>(null)
const leido = shallowRef<ExtractoLeido | null>(null)
const huella = ref<string | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** La API dijo que no encadena: se pide el motivo para forzarlo. */
const pideMotivo = ref(false)
let clave = nuevaClaveIdempotencia()

const suma = computed(() => (leido.value ? sumaLineas(leido.value.lineas) : null))
const cuadra = computed(() => (leido.value ? extractoCuadra(leido.value.lineas, estado.saldo_inicial, estado.saldo_final) : false))
const listo = computed(() => Boolean(leido.value?.lineas.length) && !leido.value?.errores.length)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { cuenta_id: props.cuentaId, desde: '', hasta: '', saldo_inicial: '', saldo_final: '', motivo_no_encadena: '' })
        archivo.value = null
        leido.value = null
        huella.value = null
        problema.value = null
        pideMotivo.value = false
        clave = nuevaClaveIdempotencia()
    }
})

watch(archivo, async (nuevo) => {
    leido.value = null
    huella.value = null
    problema.value = null
    pideMotivo.value = false
    if (!nuevo) {
        return
    }
    const contenido = await nuevo.arrayBuffer()
    const lectura = leerExtractoCsv(new TextDecoder('utf-8').decode(contenido))
    leido.value = lectura
    huella.value = await sha256Archivo(contenido)
    estado.desde = lectura.desde ?? ''
    estado.hasta = lectura.hasta ?? ''
    estado.saldo_inicial = lectura.saldoInicial ?? estado.saldo_inicial
    estado.saldo_final = lectura.saldoFinal ?? estado.saldo_final
    // Otro archivo es otro intento: otra clave.
    clave = nuevaClaveIdempotencia()
})

async function enviar(evento: FormSubmitEvent<SalidaExtracto>) {
    if (!leido.value || !listo.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useExtractos().importar(cuerpoExtracto(evento.data, leido.value.lineas, archivo.value?.name ?? null, huella.value), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.type === 'urn:argosisp:problema:extracto_no_encadena') {
        pideMotivo.value = true
        // Con el motivo es otra petición (otro cuerpo): otra clave.
        clave = nuevaClaveIdempotencia()
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name))
    formulario.value?.setErrors(errores)
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Importar extracto"
        description="CSV con encabezado fecha, descripcion, referencia, monto, saldo (monto con signo: + entra a la cuenta). Solo se insertan líneas; las repetidas se rechazan."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-extracto"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Cuenta del extracto"
                    name="cuenta_id"
                    required
                >
                    <CuentaBancoSelect v-model="estado.cuenta_id" />
                </UFormField>

                <UFormField
                    label="Archivo"
                    :help="huella ? `sha256 ${huella.slice(0, 16)}…` : 'CSV o Excel del banco con fecha, descripción y monto de cada movimiento.'"
                >
                    <UFileUpload
                        v-model="archivo"
                        accept=".csv,text/csv,text/plain"
                        label="Elige o arrastra el CSV del extracto"
                        icon="i-lucide-file-spreadsheet"
                        layout="list"
                        class="w-full"
                        data-prueba="extracto-archivo"
                    />
                </UFormField>

                <UAlert
                    v-if="leido?.errores.length"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-file-warning"
                    title="El archivo tiene filas que no se pueden leer"
                    data-prueba="extracto-errores-lectura"
                >
                    <template #description>
                        <ul class="list-disc pl-5">
                            <li
                                v-for="error in leido.errores.slice(0, 10)"
                                :key="`${error.fila}-${error.mensaje}`"
                            >
                                {{ error.fila ? `Fila ${error.fila}: ` : '' }}{{ error.mensaje }}
                            </li>
                        </ul>
                    </template>
                </UAlert>

                <div
                    v-if="leido && leido.lineas.length"
                    class="flex flex-col gap-2"
                    data-prueba="extracto-vista-previa"
                >
                    <div class="flex flex-wrap items-center gap-3 rounded-lg bg-elevated px-3 py-2 text-sm">
                        <span>{{ leido.lineas.length }} {{ leido.lineas.length === 1 ? 'línea' : 'líneas' }}</span>
                        <span class="text-muted">Σ <strong class="tabular-nums text-default">{{ suma ? montoConSigno(suma.toFixed(2)) : '—' }}</strong></span>
                        <UBadge
                            :label="cuadra ? 'Cuadra con los saldos' : 'No cuadra con los saldos'"
                            :color="cuadra ? 'success' : 'warning'"
                            :icon="cuadra ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                            variant="subtle"
                            size="sm"
                            class="sm:ml-auto"
                            data-prueba="extracto-cuadra"
                        />
                    </div>
                    <ul class="flex max-h-40 flex-col divide-y divide-default overflow-y-auto rounded-lg border border-default text-xs">
                        <li
                            v-for="(linea, indice) in leido.lineas.slice(0, 50)"
                            :key="indice"
                            class="flex items-center justify-between gap-3 px-3 py-1.5"
                        >
                            <span class="min-w-0 truncate">{{ formatearFecha(linea.fecha) }} · {{ linea.descripcion }}<template v-if="linea.referencia"> · {{ linea.referencia }}</template></span>
                            <span
                                class="shrink-0 tabular-nums"
                                :class="linea.monto.startsWith('-') ? 'text-error' : 'text-success'"
                            >{{ montoConSigno(linea.monto) }}</span>
                        </li>
                    </ul>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Desde"
                        name="desde"
                        required
                    >
                        <UInput
                            v-model="estado.desde"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Hasta"
                        name="hasta"
                        required
                    >
                        <UInput
                            v-model="estado.hasta"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Saldo inicial"
                        name="saldo_inicial"
                        required
                        help="Debe ser el saldo final del extracto anterior."
                    >
                        <UInput
                            v-model="estado.saldo_inicial"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="extracto-saldo-inicial"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Saldo final"
                        name="saldo_final"
                        required
                    >
                        <UInput
                            v-model="estado.saldo_final"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="extracto-saldo-final"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        v-if="pideMotivo"
                        label="Motivo para importarlo aunque no encadene"
                        name="motivo_no_encadena"
                        required
                        class="sm:col-span-2"
                        help="Queda guardado en el extracto y en la bitácora."
                    >
                        <UTextarea
                            v-model="estado.motivo_no_encadena"
                            :rows="2"
                            placeholder="Ej.: el banco corrigió el saldo del mes anterior"
                            class="w-full"
                            data-prueba="extracto-motivo"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="extracto-error"
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
                    form="form-extracto"
                    :label="pideMotivo ? 'Importar con motivo' : 'Importar extracto'"
                    icon="i-lucide-upload"
                    :loading="enviando"
                    :disabled="!listo"
                    data-prueba="extracto-importar"
                />
            </div>
        </template>
    </UModal>
</template>
