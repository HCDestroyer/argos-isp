<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Confirmar un canje: qué recibe, a qué servicio se aplica (si tiene varios en la empresa), cuántos
 * puntos le quedan. Lo decide `lealtad.canjear` (A3); un error se muestra aquí con su texto y no
 * descuenta nada. Un descuento queda «en tu próxima factura»; una mejora de plan, aplicada.
 *
 * `Idempotency-Key`: la misma clave en los reintentos del mismo canje; una nueva al abrir.
 */
const props = defineProps<{
    premio: PremioPortal | null
    saldo: number
    servicios: Schema<'PortalServicio'>[]
}>()

const emit = defineEmits<{
    canjeado: [canje: CanjePortal]
}>()

const open = defineModel<boolean>('open', { default: false })
const { canjear } = useCanjear()

/** Espejo de `canjearPuntosValidator`: el premio va en la tarjeta; aquí solo el servicio. */
const esquema = z.object({ servicio_id: z.number({ error: 'Elige el servicio' }).int().positive() })
type Datos = z.infer<typeof esquema>

const elegibles = computed(() => props.servicios.filter(s => s.estado !== 'retirado'))
const estado = reactive<{ servicio_id: number | undefined }>({ servicio_id: undefined })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const hecho = ref<CanjePortal | null>(null)
let clave = claveIdempotencia()

watch(open, (abierto) => {
    if (abierto) {
        estado.servicio_id = elegibles.value[0]?.id
        problema.value = null
        hecho.value = null
        clave = claveIdempotencia()
    }
}, { immediate: true })

const opciones = computed(() => elegibles.value.map(s => ({
    label: `${s.plan ?? 'Servicio de internet'}${s.direccion ? ` · ${s.direccion}` : ''}`,
    value: s.id,
})))
const quedan = computed(() => props.premio ? props.saldo - props.premio.costo_puntos : props.saldo)

async function confirmar(evento: FormSubmitEvent<Datos>) {
    if (!props.premio) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await canjear(props.premio.id, evento.data.servicio_id, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        // sin conexión se reintenta con la misma clave; con respuesta de la API, otra
        if (resultado.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        return
    }
    hecho.value = resultado.data
    emit('canjeado', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="open"
        :title="hecho ? '¡Listo, canjeaste tu premio!' : 'Confirmar canje'"
        :description="hecho ? undefined : 'Revisa el premio antes de canjear tus puntos.'"
    >
        <template #body>
            <div
                v-if="hecho"
                class="flex flex-col gap-4"
                aria-live="polite"
                data-testid="canje-hecho"
            >
                <UAlert
                    color="success"
                    variant="subtle"
                    icon="i-lucide-party-popper"
                    :title="hecho.premio_nombre"
                    :description="hecho.estado === 'reservado'
                        ? 'Se aplicará en tu próxima factura.'
                        : 'Ya quedó aplicado a tu servicio.'"
                />
                <p class="text-sm text-muted">
                    Usaste {{ puntosEnTexto(hecho.puntos) }}. Te quedan {{ puntosEnTexto(props.saldo) }}.
                </p>
                <UButton
                    label="Listo"
                    size="lg"
                    block
                    @click="open = false"
                />
            </div>

            <UForm
                v-else-if="props.premio"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="confirmar"
            >
                <div class="flex items-start gap-3 rounded-lg bg-elevated/60 p-3">
                    <UIcon
                        :name="ICONOS_PREMIO[props.premio.tipo]"
                        class="mt-0.5 size-5 shrink-0 text-primary"
                    />
                    <div class="min-w-0">
                        <p class="font-medium text-highlighted">
                            {{ props.premio.nombre }}
                        </p>
                        <p class="text-sm text-muted">
                            {{ descripcionPremio(props.premio) }}
                        </p>
                    </div>
                </div>

                <UFormField
                    v-if="opciones.length > 1"
                    label="¿A qué servicio lo aplicamos?"
                    name="servicio_id"
                    help="El premio se aplica a un solo servicio."
                    required
                >
                    <USelect
                        v-model="estado.servicio_id"
                        :items="opciones"
                        class="w-full"
                        data-testid="servicio-canje"
                    />
                </UFormField>

                <dl class="grid grid-cols-2 gap-y-1 text-sm">
                    <dt class="text-muted">
                        Cuesta
                    </dt>
                    <dd class="text-end tabular-nums text-highlighted">
                        {{ puntosEnTexto(props.premio.costo_puntos) }}
                    </dd>
                    <dt class="text-muted">
                        Te quedarán
                    </dt>
                    <dd
                        class="text-end tabular-nums text-highlighted"
                        data-testid="quedaran"
                    >
                        {{ puntosEnTexto(quedan) }}
                    </dd>
                </dl>

                <UAlert
                    v-if="problema"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="problema.title"
                    :description="mensajeProblema(problema)"
                    data-testid="canje-error"
                />

                <div class="flex flex-col gap-2 sm:flex-row-reverse">
                    <UButton
                        type="submit"
                        label="Canjear ahora"
                        icon="i-lucide-gift"
                        size="lg"
                        block
                        :loading="enviando"
                        :disabled="elegibles.length === 0"
                        data-testid="confirmar-canje"
                    />
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        block
                        @click="open = false"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
