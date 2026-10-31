<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Recibir una orden de traslado (`POST /inventario/traslados/:id/recibir`, `inventario.recibir_traslado`;
 * `contratos/inventario.md` D.1 y contrato Iris §3.3). Por línea se marca lo que llegó: cantidad
 * recibida, o los equipos que no llegaron; lo faltante vuelve al origen. Tres métodos:
 * - **Firma digital**: quien recibe firma en la pantalla (teléfono o tableta); el PNG y su SHA-256 se
 *   generan aquí.
 * - **Firma en papel**: solo con alcance global (el encargado registra el papel); luego se adjunta la
 *   foto o el escaneo.
 * - **Aceptación simple**: solo si la empresa no exige firma (`traslado_firma_obligatoria = false`).
 * Un 2xx es definitivo; otra recepción responde 409 `traslado_ya_recibido` con la guardada.
 */
const props = defineProps<{
    orden: OrdenTrasladoDetalle
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ recibida: [orden: OrdenTrasladoDetalle] }>()

const usuario = useUsuarioActual()
const alcanceGlobal = computed(() => usuario.value?.alcance_global === true)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaRecepcion>(recepcionDe(props.orden, 'firma_digital'))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/* Si la empresa exige firma: sin leerla no se ofrece la aceptación simple */
const configuracion = shallowRef<ConfiguracionInventario | null>(null)
const problemaConfiguracion = ref<Problem | null>(null)
const leyendoConfiguracion = ref(false)

async function leerConfiguracion() {
    leyendoConfiguracion.value = true
    const resultado = await useConfiguracionInventario().ver()
    leyendoConfiguracion.value = false
    configuracion.value = resultado.ok ? resultado.data : null
    problemaConfiguracion.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, recepcionDe(props.orden, 'firma_digital'))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void leerConfiguracion()
    }
}, { immediate: true })

const itemsMetodo = computed<RadioGroupItem[]>(() => {
    const metodos: MetodoRecepcion[] = ['firma_digital']
    if (alcanceGlobal.value) {
        metodos.push('firma_papel')
    }
    if (configuracion.value && !configuracion.value.traslado_firma_obligatoria) {
        metodos.push('aceptacion_sistema')
    }
    return metodos.map(m => ({ label: METODOS_RECEPCION[m].etiqueta, description: METODOS_RECEPCION[m].descripcion, value: m }))
})

const lineaDe = (id: number) => props.orden.lineas.find(l => l.id === id)

function llego(linea: LineaRecepcion, unidadId: number): boolean {
    return !linea.unidad_ids_faltantes.includes(unidadId)
}

function marcarLlegada(linea: LineaRecepcion, unidadId: number, valor: boolean | 'indeterminate') {
    linea.unidad_ids_faltantes = valor === true ? linea.unidad_ids_faltantes.filter(id => id !== unidadId) : [...linea.unidad_ids_faltantes, unidadId]
}

const faltantes = computed(() => estado.lineas.filter(l => faltanteLinea(l).greaterThan(0)))

async function enviar(evento: FormSubmitEvent<SalidaRecepcion>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoRecepcion(evento.data, props.orden.version, new Date().toISOString())
    const resultado = await useOrdenesTraslado().recibir(props.orden.id, cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('recibida', resultado.data)
        return
    }
    const enviadas = (cuerpo.lineas ?? []).map(l => l.linea_id)
    const todas = estado.lineas.map(l => l.linea_id)
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name ? campoLineaRecepcion(e.name, enviadas, todas) : e.name }))
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}

const ayudaError = computed(() => (problema.value ? ERRORES_TRASLADO[codigoProblema(problema.value) ?? ''] ?? null : null))
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Recibir orden N.º ${orden.numero}`"
        :description="rutaOrden(orden)"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-recibir-traslado"
                ref="formulario"
                :schema="esquemaRecepcion"
                :state="estado"
                class="flex flex-col gap-5"
                @submit="enviar"
            >
                <div class="flex flex-col gap-3">
                    <h3 class="text-sm font-semibold text-highlighted">
                        ¿Qué llegó?
                    </h3>
                    <p class="text-xs text-muted">
                        Todo viene marcado como recibido. Corrige solo lo que faltó: vuelve al origen y la orden queda «con diferencias».
                    </p>
                    <div
                        v-for="(linea, i) in estado.lineas"
                        :key="linea.linea_id"
                        class="flex flex-col gap-2 rounded-md border border-default p-3"
                        :data-recibir-linea="lineaDe(linea.linea_id)?.producto_sku"
                    >
                        <div class="flex flex-wrap items-baseline justify-between gap-1">
                            <span class="text-sm font-medium text-highlighted">{{ lineaDe(linea.linea_id)?.producto_nombre }}</span>
                            <span class="text-xs text-muted">Enviado: {{ formatearCantidad(linea.enviado, lineaDe(linea.linea_id)?.unidad) }}</span>
                        </div>
                        <UFormField
                            v-if="linea.seguimiento === 'cantidad'"
                            label="Recibido"
                            :name="`lineas.${i}.cantidad_recibida`"
                        >
                            <UInput
                                v-model="linea.cantidad_recibida"
                                inputmode="decimal"
                                class="w-full sm:w-40"
                                data-prueba="recibir-cantidad"
                            />
                        </UFormField>
                        <UFormField
                            v-else
                            :name="`lineas.${i}.unidad_ids_faltantes`"
                            label="Equipos que llegaron"
                        >
                            <div class="flex flex-col gap-2">
                                <UCheckbox
                                    v-for="u in lineaDe(linea.linea_id)?.unidades ?? []"
                                    :key="u.unidad_id"
                                    :model-value="llego(linea, u.unidad_id)"
                                    :label="identificacionUnidad(u)"
                                    :ui="{ label: 'font-mono text-xs' }"
                                    :data-recibir-unidad="u.serie ?? u.mac"
                                    @update:model-value="v => marcarLlegada(linea, u.unidad_id, v)"
                                />
                            </div>
                        </UFormField>
                        <UBadge
                            v-if="faltanteLinea(linea).greaterThan(0)"
                            :label="`Falta ${formatearCantidad(faltanteLinea(linea).toFixed(3), lineaDe(linea.linea_id)?.unidad)}: vuelve al origen`"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-package-x"
                            class="self-start"
                        />
                    </div>
                </div>

                <ProblemaAlerta
                    v-if="problemaConfiguracion"
                    :problema="problemaConfiguracion"
                    :reintentar="leerConfiguracion"
                    :reintentando="leyendoConfiguracion"
                />
                <UFormField
                    label="¿Cómo se recibe?"
                    name="metodo_recepcion"
                >
                    <URadioGroup
                        v-model="estado.metodo_recepcion"
                        :items="itemsMetodo"
                        variant="card"
                        data-prueba="recibir-metodo"
                    />
                </UFormField>

                <UFormField
                    v-if="estado.metodo_recepcion === 'firma_digital'"
                    label="Firma"
                    name="firma"
                    required
                >
                    <FirmaCanvas
                        v-model="estado.firma"
                        :firmante="orden.usuario_destino_nombre ?? usuario?.nombre ?? null"
                        :disabled="enviando"
                    />
                </UFormField>
                <UAlert
                    v-else-if="estado.metodo_recepcion === 'firma_papel'"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-printer"
                    title="Después de recibir, adjunta la foto o el escaneo del papel firmado."
                    description="Imprime la orden con «Imprimir», que la firme quien recibe y súbela desde el detalle (JPG, PNG, WebP o PDF de hasta 5 MB)."
                />

                <UFormField
                    label="Observaciones"
                    name="observaciones"
                >
                    <UTextarea
                        v-model="estado.observaciones"
                        :rows="2"
                        autoresize
                        class="w-full"
                        placeholder="Una caja llegó golpeada…"
                    />
                </UFormField>

                <UAlert
                    v-if="faltantes.length"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`${faltantes.length} ${faltantes.length === 1 ? 'línea' : 'líneas'} con faltante`"
                    description="Lo que no llegó vuelve al kardex del origen al mismo costo, sin asiento."
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                />
                <p
                    v-if="ayudaError"
                    class="text-xs text-muted"
                    data-prueba="recibir-ayuda-error"
                >
                    {{ ayudaError }}
                </p>
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
                    form="form-recibir-traslado"
                    :label="estado.metodo_recepcion === 'firma_digital' ? 'Recibir y firmar' : 'Recibir'"
                    icon="i-lucide-package-check"
                    :loading="enviando"
                    data-prueba="recibir-confirmar"
                />
            </div>
        </template>
    </USlideover>
</template>
