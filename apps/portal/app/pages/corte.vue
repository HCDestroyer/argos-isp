<script setup lang="ts">
/**
 * Página de corte: aquí aterriza el cliente suspendido (dst-nat del MikroTik y detección de
 * portal cautivo). Identifica el servicio por la IP de origen (`GET /portal/quien-soy`) y solo
 * muestra nombre parcial, estado y montos.
 *
 * Día 2: estado, monto, facturas vencidas, datos de depósito y contacto. Comprobante y promesa
 * se activan el día 3; el pago en línea, en la semana 2.
 */
const { empresa } = useRuntimeConfig().public
const { data: corte, status, refresh } = useCorte()

useHead({ title: `Estado del servicio · ${empresa.nombre}` })

const cargando = computed(() => status.value === 'idle' || status.value === 'pending')
const mensaje = computed(() => corte.value ? mensajeCorte(corte.value) : null)
const identificado = computed(() => corte.value?.identificado === true)
const retirado = computed(() => corte.value?.estado === 'retirado')

const verDeposito = ref(false)

const contacto = computed(() => {
    if (empresa.telefono) {
        return { label: `Llamar a soporte: ${empresa.telefono}`, icon: 'i-lucide-phone', to: `tel:${empresa.telefono}` }
    }
    if (empresa.correo) {
        return { label: `Escribir a ${empresa.correo}`, icon: 'i-lucide-mail', to: `mailto:${empresa.correo}` }
    }
    return null
})
</script>

<template>
    <div class="flex flex-col gap-4">
        <template v-if="cargando">
            <USkeleton class="h-5 w-1/3" />
            <USkeleton class="h-8 w-2/3" />
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-12 w-full" />
        </template>

        <UAlert
            v-else-if="status === 'error' || !corte || !mensaje"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos consultar tu servicio"
            description="Revisa tu conexión e intenta de nuevo en unos segundos."
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => refresh() }]"
        />

        <template v-else>
            <div>
                <p
                    v-if="corte.nombre_parcial"
                    class="text-sm text-muted"
                >
                    Hola, {{ corte.nombre_parcial }}
                </p>
                <h1 class="mt-1 text-2xl font-semibold text-balance text-highlighted">
                    {{ mensaje.titulo }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    {{ mensaje.descripcion }}
                </p>
            </div>

            <CorteResumenDeuda
                v-if="identificado"
                :corte="corte"
            />

            <div
                v-if="!retirado"
                class="flex flex-col gap-2"
            >
                <UButton
                    label="Pagar en línea"
                    icon="i-lucide-credit-card"
                    size="xl"
                    block
                    disabled
                />
                <UButton
                    label="Ver datos de depósito"
                    icon="i-lucide-landmark"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    @click="verDeposito = true"
                />
                <UButton
                    label="Subir comprobante de depósito"
                    icon="i-lucide-upload"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    disabled
                />
                <UButton
                    v-if="!corte.promesa_activa"
                    label="Solicitar promesa de pago"
                    icon="i-lucide-hand-coins"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    disabled
                />
                <p class="text-center text-xs text-muted">
                    El pago en línea, el comprobante y la promesa de pago estarán disponibles pronto.
                </p>
            </div>

            <UButton
                :label="contacto?.label ?? 'Contacta a soporte'"
                :icon="contacto?.icon ?? 'i-lucide-phone'"
                :to="contacto?.to"
                :disabled="!contacto"
                color="neutral"
                variant="ghost"
                size="lg"
                block
            />

            <p
                v-if="!identificado"
                class="text-center text-xs text-dimmed"
            >
                Conexión desde {{ corte.ip }}
            </p>
        </template>

        <CorteDatosDeposito v-model:open="verDeposito" />
    </div>
</template>
