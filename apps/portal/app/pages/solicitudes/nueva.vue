<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Solicitar un servicio (`POST /portal/soporte/solicitudes`, contrato Iris 0.9.0 §11.7, A31): servicio
 * nuevo, cambio de plan, traslado u otra cosa. En Iris es un prospecto que revisa un asesor; el
 * cliente solo ve si está recibida, en revisión, cotizada, en proceso, completada o si no procede.
 *
 * `?tipo=` elige la opción (por defecto, cambio de plan) y `?empresa=` la empresa.
 */

const route = useRoute()
const toast = useToast()
const solicitudes = useSolicitudes()
const { data: cuentaLeida } = useCuenta()

const tipo = ref<TipoSolicitud>(OPCIONES_SOLICITUD.find(o => o.tipo === route.query.tipo)?.tipo ?? 'cambio_plan')
const opcion = computed(() => OPCIONES_SOLICITUD.find(o => o.tipo === tipo.value)!)
useHead({ title: computed(() => opcion.value.titulo) })

const empresaId = computed(() => {
    const n = Number(route.query.empresa)
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
})
const servicios = computed(() => {
    const todos = cuentaLeida.value?.ok ? cuentaLeida.value.data.servicios : []
    return todos.filter(s => s.estado !== 'retirado' && (!empresaId.value || s.empresa.id === empresaId.value))
})

const planes = ref<{ label: string, value: number }[]>([])
onMounted(async () => {
    const leidos = await solicitudes.planes()
    if (leidos.ok) {
        planes.value = leidos.data.data.map(p => ({
            label: `${p.nombre} · ${formatearQuetzales(p.precio)} al mes`,
            value: p.id,
        }))
    }
})

const esquema = computed(() => esquemaSolicitud(tipo.value))
const estado = reactive<Partial<DatosSolicitud>>({
    servicio_id: undefined,
    direccion: '',
    coordenadas: '',
    plan_interes_id: undefined,
    comentario: '',
    telefono_contacto: '',
})
watch([servicios, tipo], ([lista]) => {
    if (pideServicio(tipo.value) === 'no') {
        estado.servicio_id = undefined
    }
    else if (estado.servicio_id === undefined && lista.length === 1) {
        estado.servicio_id = lista[0]!.id
    }
}, { immediate: true })

const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const error = ref<string | null>(null)
const enviada = ref<SolicitudServicio | null>(null)
let clave = claveIdempotencia()

async function enviar(evento: FormSubmitEvent<DatosSolicitud>) {
    enviando.value = true
    error.value = null
    const d = evento.data
    const r = await solicitudes.solicitar({
        tipo: tipo.value,
        ...(empresaId.value ? { empresa_id: empresaId.value } : {}),
        ...(d.servicio_id ? { servicio_id: d.servicio_id } : {}),
        ...(pideDireccion(tipo.value) && d.direccion ? { direccion: d.direccion } : {}),
        ...(d.coordenadas ? { coordenadas: d.coordenadas } : {}),
        ...(d.plan_interes_id ? { plan_interes_id: d.plan_interes_id } : {}),
        ...(d.comentario ? { comentario: d.comentario } : {}),
        ...(d.telefono_contacto ? { telefono_contacto: d.telefono_contacto } : {}),
    }, clave)
    enviando.value = false
    if (!r.ok) {
        if (r.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        error.value = mensajeProblema(r.problema)
        return
    }
    clave = claveIdempotencia()
    enviada.value = r.data
    toast.add({ title: `Recibimos tu solicitud ${r.data.numero}`, icon: 'i-lucide-check', color: 'success' })
}

const volver = '/cuenta?seccion=soporte&pestana=solicitudes'
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="solicitud-nueva"
    >
        <div>
            <UButton
                label="Atrás"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                :to="volver"
            />
        </div>

        <UCard :ui="{ body: 'p-4 sm:p-6' }">
            <div
                v-if="enviada"
                class="flex flex-col items-center gap-3 py-4 text-center"
                data-testid="solicitud-enviada"
            >
                <span class="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                    <UIcon
                        name="i-lucide-circle-check"
                        class="size-7"
                    />
                </span>
                <h1 class="text-lg font-semibold text-highlighted">
                    Recibimos tu solicitud
                </h1>
                <p class="text-sm text-muted">
                    Tu número es <span class="font-semibold text-highlighted">{{ enviada.numero }}</span>. Un asesor te contactará para confirmarla.
                </p>
                <UButton
                    label="Ver mis solicitudes"
                    :to="volver"
                    size="lg"
                    block
                />
            </div>

            <div
                v-else
                class="flex flex-col gap-4"
            >
                <div>
                    <h1 class="text-lg font-semibold text-highlighted">
                        Solicitar un servicio
                    </h1>
                    <p class="text-sm text-muted">
                        Un asesor la revisa y te contacta para confirmarla.
                    </p>
                </div>

                <URadioGroup
                    v-model="tipo"
                    :items="OPCIONES_SOLICITUD.map(o => ({ label: o.titulo, description: o.descripcion, value: o.tipo }))"
                    variant="card"
                    orientation="vertical"
                    :ui="{ fieldset: 'grid grid-cols-1 gap-2 sm:grid-cols-2' }"
                    legend="¿Qué necesitas?"
                    data-testid="solicitud-tipo"
                />

                <UAlert
                    v-if="error"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="error"
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => formulario?.submit() }]"
                    data-testid="solicitud-error"
                />

                <UForm
                    ref="formulario"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="enviar"
                >
                    <UFormField
                        v-if="pideServicio(tipo) !== 'no'"
                        label="Servicio"
                        name="servicio_id"
                        :required="pideServicio(tipo) === 'obligatorio'"
                    >
                        <USelect
                            v-model="estado.servicio_id"
                            :items="servicios.map(s => ({ label: etiquetaServicio(s), value: s.id }))"
                            placeholder="¿Cuál servicio?"
                            class="w-full"
                            data-testid="solicitud-servicio"
                        />
                    </UFormField>
                    <UFormField
                        v-if="pideDireccion(tipo)"
                        :label="tipo === 'traslado' ? 'Dirección nueva' : 'Dirección donde lo quieres'"
                        name="direccion"
                        required
                    >
                        <UInput
                            v-model="estado.direccion"
                            autocomplete="street-address"
                            class="w-full"
                            data-testid="solicitud-direccion"
                        />
                    </UFormField>
                    <UFormField
                        v-if="pideDireccion(tipo)"
                        label="Ubicación (opcional)"
                        name="coordenadas"
                        help="Latitud y longitud, por ejemplo 14.6349,-90.5069"
                    >
                        <UInput
                            v-model="estado.coordenadas"
                            inputmode="decimal"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="tipo !== 'traslado'"
                        label="Plan que te interesa (opcional)"
                        name="plan_interes_id"
                    >
                        <USelect
                            v-model="estado.plan_interes_id"
                            :items="planes"
                            placeholder="Elige un plan"
                            class="w-full"
                            data-testid="solicitud-plan"
                        />
                    </UFormField>
                    <UFormField
                        label="Comentario (opcional)"
                        name="comentario"
                    >
                        <UTextarea
                            v-model="estado.comentario"
                            :rows="3"
                            autoresize
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Teléfono para contactarte (opcional)"
                        name="telefono_contacto"
                        help="Si lo dejas vacío, te llamamos al de tu cuenta."
                    >
                        <UInput
                            v-model="estado.telefono_contacto"
                            type="tel"
                            autocomplete="tel"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Enviar solicitud"
                        icon="i-lucide-send"
                        size="xl"
                        block
                        :loading="enviando"
                        data-testid="solicitud-enviar"
                    />
                </UForm>
            </div>
        </UCard>
    </div>
</template>
