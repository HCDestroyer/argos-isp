<script setup lang="ts">
/**
 * Cómo pagar por depósito: cuentas bancarias activas en quetzales (fuente única
 * `billing.cuentas_bancarias`, A3; la API no envía las de USD) e instrucciones de pago, ambas
 * configuradas en el panel (`GET /portal/empresa`). Cada cuenta: banco, alias, moneda y número.
 *
 * Multiempresa: son las de UNA empresa (`empresaId` en `/cuenta`; en `/corte`, la del servicio de la
 * IP), con su nombre en el título cuando se conoce: no se cruzan dineros entre NIT.
 *
 * Sin cuentas no se muestra la sección de cuentas (nunca datos inventados). Si no se pudo leer
 * la configuración, error con "Reintentar".
 */
const props = withDefaults(defineProps<{
    empresaId?: number
}>(), {
    empresaId: undefined,
})

const open = defineModel<boolean>('open', { default: false })

const { empresa, problema, cargando, recargar } = useEmpresa({ empresaId: () => props.empresaId })
const toast = useToast()

const cuentas = computed(() => empresa.value?.cuentas_deposito ?? [])
const contacto = computed(() => enlacesContacto(empresa.value).find(enlace => enlace.tipo === 'telefono') ?? null)

async function copiar(numero: string) {
    try {
        await navigator.clipboard.writeText(numero)
        toast.add({ title: 'Número de cuenta copiado', icon: 'i-lucide-check', color: 'success' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar; anótalo a mano', icon: 'i-lucide-circle-alert', color: 'warning' })
    }
}
</script>

<template>
    <UModal
        v-model:open="open"
        :title="empresa ? `Datos para depósito · ${empresa.nombre}` : 'Datos para depósito'"
        :description="cuentas.length > 0
            ? 'Deposita a cualquiera de estas cuentas y guarda tu comprobante.'
            : 'Así puedes pagar tu saldo.'"
    >
        <template #body>
            <div
                v-if="cargando"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-20 w-full" />
                <USkeleton class="h-20 w-full" />
            </div>

            <UAlert
                v-else-if="problema"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="No pudimos cargar los datos de pago"
                :description="mensajeProblema(problema)"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargar() }]"
            />

            <div
                v-else
                class="flex flex-col gap-3"
            >
                <div
                    v-for="cuenta in cuentas"
                    :key="`${cuenta.banco}-${cuenta.numero}`"
                    class="rounded-lg border border-default p-3"
                    data-testid="cuenta-deposito"
                >
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="font-medium text-highlighted">
                                {{ cuenta.banco }}
                            </p>
                            <p class="text-sm text-muted">
                                {{ cuenta.alias }} · {{ cuenta.moneda === 'USD' ? 'Dólares' : 'Quetzales' }}
                            </p>
                            <p class="mt-1 font-mono text-lg tabular-nums text-default break-all">
                                {{ cuenta.numero }}
                            </p>
                        </div>
                        <UButton
                            icon="i-lucide-copy"
                            color="neutral"
                            variant="ghost"
                            :aria-label="`Copiar número de cuenta de ${cuenta.banco}`"
                            @click="copiar(cuenta.numero)"
                        />
                    </div>
                </div>

                <p
                    v-if="empresa?.instrucciones_pago"
                    class="text-sm text-muted"
                    data-testid="instrucciones-pago"
                >
                    {{ empresa.instrucciones_pago }}
                </p>

                <UAlert
                    v-if="cuentas.length === 0 && !empresa?.instrucciones_pago"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-landmark"
                    title="Datos de depósito no disponibles"
                    :description="contacto
                        ? `Llámanos al ${contacto.valor} y te damos los datos de la cuenta.`
                        : 'Comunícate con nosotros y te damos los datos de la cuenta.'"
                />
            </div>
        </template>
    </UModal>
</template>
