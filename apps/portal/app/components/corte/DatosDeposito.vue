<script setup lang="ts">
/**
 * Cuentas bancarias para pagar por depósito. Hoy salen de la configuración del portal
 * (`NUXT_PUBLIC_DEPOSITO_*`); en la tarea 9 se configuran desde el panel.
 */
const open = defineModel<boolean>('open', { default: false })

const { deposito, empresa } = useRuntimeConfig().public
const toast = useToast()

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
        title="Datos para depósito"
        description="Deposita a cualquiera de estas cuentas y guarda tu comprobante."
    >
        <template #body>
            <div
                v-if="deposito.cuentas.length > 0"
                class="flex flex-col gap-3"
            >
                <div
                    v-for="cuenta in deposito.cuentas"
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
                                {{ cuenta.tipo }} · {{ cuenta.titular }}
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
                    v-if="deposito.instrucciones"
                    class="text-sm text-muted"
                >
                    {{ deposito.instrucciones }}
                </p>
            </div>

            <UAlert
                v-else
                color="neutral"
                variant="subtle"
                icon="i-lucide-landmark"
                title="Datos de depósito no disponibles"
                :description="empresa.telefono
                    ? `Llámanos al ${empresa.telefono} y te damos los datos de la cuenta.`
                    : 'Comunícate con nosotros y te damos los datos de la cuenta.'"
            />
        </template>
    </UModal>
</template>
