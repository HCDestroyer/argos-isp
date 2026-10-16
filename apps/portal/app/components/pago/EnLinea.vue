<script setup lang="ts">
/**
 * Botón "Pagar en línea" de `/corte` y `/cuenta` (semana 2, tarea 2).
 *
 * Apagado y con "Pronto" mientras A3 no publique el contrato de la pasarela (`POST /pasarela/cobros`
 * no está en `main` ni en `agente/a3-facturacion` al 16/10; pedido en `.claude/integration/a5.md`).
 * Se ve apagado (neutro, sin el azul primario) y explica qué hacer mientras tanto. Cuando exista el
 * contrato, este es el único lugar que cambia: elegir facturas o monto, ir a la página del
 * proveedor y volver a `/corte` con el estado en vivo.
 */
const props = withDefaults(defineProps<{
    /** id único del texto de ayuda (hay un botón en `/corte` y otro en `/cuenta`) */
    idAyuda?: string
}>(), {
    idAyuda: 'pagar-en-linea-pronto',
})
</script>

<template>
    <div class="flex flex-col gap-2">
        <UButton
            data-testid="pagar-en-linea"
            label="Pagar en línea"
            icon="i-lucide-credit-card"
            color="neutral"
            variant="soft"
            size="xl"
            block
            disabled
            :aria-describedby="props.idAyuda"
        >
            <template #trailing>
                <UBadge
                    label="Pronto"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="ms-auto"
                />
            </template>
        </UButton>
        <p
            :id="props.idAyuda"
            class="-mt-1 text-center text-xs text-muted"
        >
            El pago en línea llega pronto. Mientras tanto, paga en nuestra oficina o por depósito.
        </p>
    </div>
</template>
