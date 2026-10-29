<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { Form, FormError, FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Subir el comprobante de un depósito, transferencia, ACH o remesa (tarea 5), en `/corte` (cliente
 * por IP) y en `/cuenta` (`servicioId` con la sesión del portal).
 *
 * Las cuentas de destino son las de `GET /portal/empresa` de la empresa del servicio (`empresaId` en
 * `/cuenta`; en `/corte`, la de la IP), las mismas de "Ver datos de depósito": nunca de otra empresa;
 * el banco de origen, del catálogo `GET /portal/bancos`, solo en transferencia y ACH. El archivo
 * (foto o PDF, 5 MB) se elige de la galería o se toma con la cámara del teléfono, con vista previa.
 *
 * La decisión es del backend (`RegistrarComprobante` de A3): queda en revisión y no reactiva nada
 * por sí solo. Cada 422 se muestra en su campo con el texto de la API; el 409 de referencia
 * repetida, en el campo referencia.
 *
 * `Idempotency-Key`: la misma clave en los reintentos de un envío que no llegó (sin conexión); una
 * nueva cuando la API respondió.
 */
const props = withDefaults(defineProps<{
    servicioId?: number
    /** Empresa del servicio (`/cuenta`); sin ella, la que decide la API (la de la IP en `/corte`). */
    empresaId?: number
}>(), {
    servicioId: undefined,
    empresaId: undefined,
})

const emit = defineEmits<{
    enviado: [comprobante: ComprobantePortal]
}>()

const open = defineModel<boolean>('open', { default: false })

const { empresa, problema: problemaEmpresa, cargando: cargandoEmpresa, recargar: recargarEmpresa } = useEmpresa({ empresaId: () => props.empresaId })
const { bancos: leerBancos, subir } = useSubirComprobante()

const formulario = useTemplateRef<Form<DatosComprobante>>('formulario')
const hoy = ref(hoyGuatemala())
const esquema = computed(() => esquemaComprobante(hoy.value))

const estado = reactive<FormularioComprobante>(vacio())
const enviando = ref(false)
const errorEnvio = ref<string | null>(null)
const enviado = ref<ComprobantePortal | null>(null)
let clave = claveIdempotencia()

function vacio(): FormularioComprobante {
    return {
        metodo: 'deposito',
        cuenta_bancaria_id: undefined,
        banco_origen_id: undefined,
        referencia: '',
        monto: '',
        fecha_deposito: hoyGuatemala(),
        archivo: undefined,
    }
}

const cuentas = computed(() => empresa.value?.cuentas_deposito ?? [])
/** Tarjetas con el número completo a la vista: es lo que el cliente compara con su boleta. */
const opcionesCuenta = computed<RadioGroupItem[]>(() => cuentas.value.map(cuenta => ({
    label: `${cuenta.banco} · ${cuenta.alias}`,
    description: cuenta.numero,
    value: cuenta.id,
})))
const opcionesMetodo: SelectItem[] = METODOS_COMPROBANTE.map(m => ({ label: m.label, value: m.value, description: m.descripcion }))

// Una sola cuenta: ya elegida.
watch(cuentas, (lista) => {
    if (lista.length === 1 && estado.cuenta_bancaria_id === undefined) {
        estado.cuenta_bancaria_id = lista[0]!.id
    }
}, { immediate: true })

/* Bancos de origen: se piden la primera vez que el método los necesita. */
const bancos = ref<BancoPortal[] | null>(null)
const problemaBancos = ref<Problem | null>(null)
const cargandoBancos = ref(false)
const opcionesBanco = computed(() => (bancos.value ?? []).map(b => ({ label: b.nombre, value: b.id })))
const conBanco = computed(() => pideBancoOrigen(estado.metodo))

async function cargarBancos() {
    cargandoBancos.value = true
    problemaBancos.value = null
    const leido = await leerBancos()
    cargandoBancos.value = false
    if (leido.ok) {
        bancos.value = leido.data
    }
    else {
        problemaBancos.value = leido.problema
    }
}

watch(conBanco, (pide) => {
    if (!pide) {
        estado.banco_origen_id = undefined
    }
    else if (!bancos.value && !cargandoBancos.value) {
        void cargarBancos()
    }
})

/* Archivo: vista previa y foto reducida si pesa más de 5 MB. */
const capturar = ref(false)
const reduciendo = ref(false)
const vistaPrevia = ref<string | null>(null)
const esImagen = computed(() => estado.archivo?.type.startsWith('image/') ?? false)

watch(() => estado.archivo, async (archivo, anterior) => {
    if (vistaPrevia.value) {
        URL.revokeObjectURL(vistaPrevia.value)
        vistaPrevia.value = null
    }
    if (!archivo) {
        return
    }
    if (archivo !== anterior && archivo.size > TAMANO_MAXIMO_ARCHIVO && archivo.type.startsWith('image/')) {
        reduciendo.value = true
        const reducido = await reducirFotoSiHaceFalta(archivo)
        reduciendo.value = false
        if (reducido !== archivo) {
            estado.archivo = reducido
            return
        }
    }
    if (archivo.type.startsWith('image/')) {
        try {
            vistaPrevia.value = URL.createObjectURL(archivo)
        }
        catch {
            // sin vista previa: se muestra el icono con el nombre y el tamaño
            vistaPrevia.value = null
        }
    }
})

onBeforeUnmount(() => {
    if (vistaPrevia.value) {
        URL.revokeObjectURL(vistaPrevia.value)
    }
})

async function elegir(abrir: () => void, camara: boolean) {
    capturar.value = camara
    await nextTick()
    abrir()
}

watch(open, (abierto) => {
    if (abierto) {
        hoy.value = hoyGuatemala()
        errorEnvio.value = null
        if (enviado.value) {
            enviado.value = null
            Object.assign(estado, vacio())
            if (cuentas.value.length === 1) {
                estado.cuenta_bancaria_id = cuentas.value[0]!.id
            }
        }
    }
}, { immediate: true })

const CAMPOS = new Set(['metodo', 'cuenta_bancaria_id', 'banco_origen_id', 'referencia', 'monto', 'fecha_deposito', 'archivo'])

/** Errores de la API en el formulario: 422 por campo, 409 en la referencia; el resto, arriba. */
function mostrarProblema(problema: Problem) {
    if (problema.status === 409) {
        formulario.value?.setErrors([{ name: 'referencia', message: mensajeProblema(problema) }])
        return
    }
    if (problema.status === 413) {
        formulario.value?.setErrors([{ name: 'archivo', message: 'El archivo es demasiado grande; el máximo es 5 MB.' }])
        return
    }
    if (problema.status === 401) {
        errorEnvio.value = 'Tu sesión terminó. Vuelve a entrar con tu código para enviar el comprobante.'
        return
    }
    if (esCuentaDeOtraEmpresa(problema)) {
        // Multiempresa: la cuenta elegida es de otra empresa (otro NIT). El aviso arriba lo explica
        // y el campo de la cuenta queda marcado.
        errorEnvio.value = mensajeProblema(problema)
        formulario.value?.setErrors(erroresDeFormulario(problema).filter(error => error.name === 'cuenta_bancaria_id'))
        return
    }
    const errores: FormError[] = erroresDeFormulario(problema).filter(error => error.name && CAMPOS.has(error.name))
    if (errores.length > 0) {
        formulario.value?.setErrors(errores)
        return
    }
    errorEnvio.value = mensajeProblema(problema)
}

async function enviar(evento: FormSubmitEvent<DatosComprobante>) {
    enviando.value = true
    errorEnvio.value = null
    const respuesta = await subir(camposComprobante(evento.data, props.servicioId), evento.data.archivo, clave)
    enviando.value = false

    if (!respuesta.ok) {
        // Sin respuesta de la API: el reintento lleva la misma clave.
        if (respuesta.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        mostrarProblema(respuesta.problema)
        return
    }
    clave = claveIdempotencia()
    enviado.value = respuesta.data
    emit('enviado', respuesta.data)
}
</script>

<template>
    <UModal
        v-model:open="open"
        :title="enviado ? 'Comprobante enviado' : 'Subir comprobante de pago'"
        :description="enviado
            ? 'Te avisamos cuando lo revisemos.'
            : 'Lo revisamos y, al aprobarlo, abonamos el pago a tu cuenta y reactivamos tu servicio.'"
    >
        <template #body>
            <div
                v-if="enviado"
                class="flex flex-col gap-4"
                aria-live="polite"
                data-testid="comprobante-enviado"
            >
                <UAlert
                    color="success"
                    variant="subtle"
                    icon="i-lucide-circle-check"
                    title="Recibimos tu comprobante, lo revisaremos"
                    description="Cuando lo aprobemos, el pago se abona a tus facturas. Si tu servicio está suspendido, se reactiva en ese momento."
                />
                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-default p-3 text-sm">
                    <dt class="text-muted">
                        Monto
                    </dt>
                    <dd class="text-end font-semibold tabular-nums text-highlighted">
                        {{ formatearQuetzales(enviado.monto) }}
                    </dd>
                    <dt class="text-muted">
                        {{ NOMBRE_METODO[enviado.metodo] }}
                    </dt>
                    <dd class="min-w-0 text-end text-pretty text-default">
                        {{ enviado.cuenta_destino }}
                    </dd>
                    <dt class="text-muted">
                        Referencia
                    </dt>
                    <dd class="min-w-0 text-end font-mono break-all text-default">
                        {{ enviado.referencia }}
                    </dd>
                    <dt class="text-muted">
                        Fecha
                    </dt>
                    <dd class="text-end text-default">
                        {{ formatearFecha(enviado.fecha_deposito) }}
                    </dd>
                </dl>
                <UButton
                    label="Listo"
                    color="neutral"
                    size="xl"
                    block
                    @click="open = false"
                />
            </div>

            <div
                v-else-if="cargandoEmpresa"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-10 w-full" />
                <USkeleton class="h-10 w-full" />
                <USkeleton class="h-24 w-full" />
            </div>

            <UAlert
                v-else-if="problemaEmpresa"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="No pudimos cargar las cuentas para depósito"
                :description="mensajeProblema(problemaEmpresa)"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargarEmpresa() }]"
                data-testid="comprobante-error-cuentas"
            />

            <UAlert
                v-else-if="cuentas.length === 0"
                color="neutral"
                variant="subtle"
                icon="i-lucide-landmark"
                title="No hay cuentas para depósito disponibles"
                description="Comunícate con nosotros para enviar tu comprobante."
                data-testid="comprobante-sin-cuentas"
            />

            <UForm
                v-else
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    v-if="errorEnvio"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="errorEnvio"
                    data-testid="comprobante-error-envio"
                />

                <UFormField
                    label="¿Cómo pagaste?"
                    name="metodo"
                    required
                >
                    <USelect
                        v-model="estado.metodo"
                        :items="opcionesMetodo"
                        size="xl"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    label="Cuenta a la que pagaste"
                    name="cuenta_bancaria_id"
                    help="Con ella buscamos tu pago en el estado de cuenta del banco."
                    required
                >
                    <URadioGroup
                        v-model="estado.cuenta_bancaria_id"
                        :items="opcionesCuenta"
                        variant="card"
                        size="lg"
                        :ui="{ fieldset: 'gap-2', label: 'text-highlighted', description: 'font-mono tabular-nums break-all' }"
                        data-testid="comprobante-cuentas"
                    />
                </UFormField>

                <UFormField
                    v-if="conBanco"
                    label="Banco desde el que transferiste"
                    name="banco_origen_id"
                    help="Las transferencias se confirman con el banco de origen."
                    required
                >
                    <UAlert
                        v-if="problemaBancos"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-cloud-off"
                        title="No pudimos cargar la lista de bancos"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => cargarBancos() }]"
                    />
                    <USelectMenu
                        v-else
                        v-model="estado.banco_origen_id"
                        :items="opcionesBanco"
                        value-key="value"
                        :loading="cargandoBancos"
                        placeholder="Elige tu banco"
                        :search-input="{ placeholder: 'Buscar banco' }"
                        size="xl"
                        class="w-full"
                    />
                </UFormField>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Monto pagado"
                        name="monto"
                        help="El monto exacto del comprobante."
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            autocomplete="off"
                            placeholder="0.00"
                            size="xl"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Fecha del pago"
                        name="fecha_deposito"
                        required
                    >
                        <UInput
                            v-model="estado.fecha_deposito"
                            type="date"
                            :max="hoy"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <UFormField
                    label="Número de referencia o boleta"
                    name="referencia"
                    help="Como aparece en el comprobante del banco. Con ella confirmamos tu pago."
                    required
                >
                    <UInput
                        v-model="estado.referencia"
                        autocomplete="off"
                        autocapitalize="characters"
                        size="xl"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    label="Foto o PDF del comprobante"
                    name="archivo"
                    help="JPG, PNG, WebP o PDF de hasta 5 MB. Que se lean el monto y la referencia."
                    required
                >
                    <UFileUpload
                        v-model="estado.archivo"
                        :accept="ACEPTA_ARCHIVO"
                        :capture="capturar ? 'environment' : undefined"
                        :dropzone="false"
                        :interactive="false"
                        class="w-full"
                        data-testid="comprobante-archivo"
                    >
                        <template #default="{ open: abrir, removeFile: quitar }">
                            <div
                                v-if="estado.archivo"
                                class="flex items-center gap-3 rounded-lg border border-default p-2"
                                data-testid="comprobante-vista-previa"
                            >
                                <img
                                    v-if="esImagen && vistaPrevia"
                                    :src="vistaPrevia"
                                    alt="Vista previa del comprobante"
                                    class="size-16 shrink-0 rounded-md bg-elevated object-cover"
                                >
                                <div
                                    v-else
                                    class="flex size-16 shrink-0 items-center justify-center rounded-md bg-elevated"
                                >
                                    <UIcon
                                        :name="esImagen ? 'i-lucide-image' : 'i-lucide-file-text'"
                                        class="size-7 text-muted"
                                    />
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="truncate text-sm font-medium text-default">
                                        {{ estado.archivo.name }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        {{ reduciendo ? 'Reduciendo la foto…' : tamanoLegible(estado.archivo.size) }}
                                    </p>
                                </div>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="ghost"
                                    aria-label="Quitar archivo"
                                    @click="quitar()"
                                />
                            </div>
                            <div
                                v-else
                                class="grid grid-cols-2 gap-2"
                            >
                                <UButton
                                    label="Tomar foto"
                                    icon="i-lucide-camera"
                                    color="neutral"
                                    variant="outline"
                                    size="lg"
                                    block
                                    data-testid="comprobante-camara"
                                    @click="elegir(abrir, true)"
                                />
                                <UButton
                                    label="Elegir archivo"
                                    icon="i-lucide-paperclip"
                                    color="neutral"
                                    variant="outline"
                                    size="lg"
                                    block
                                    @click="elegir(abrir, false)"
                                />
                            </div>
                        </template>
                    </UFileUpload>
                </UFormField>

                <UButton
                    type="submit"
                    label="Enviar comprobante"
                    icon="i-lucide-send"
                    size="xl"
                    block
                    :loading="enviando"
                    :disabled="reduciendo"
                    data-testid="comprobante-enviar"
                />
            </UForm>
        </template>
    </UModal>
</template>
