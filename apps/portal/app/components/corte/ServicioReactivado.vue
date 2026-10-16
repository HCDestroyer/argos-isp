<script setup lang="ts">
/**
 * Lo que ve el cliente en `/corte` cuando el estado en vivo pasa a `activo`. Sin datos personales.
 * "Seguir navegando" lleva a `NUXT_PUBLIC_SEGUIR_NAVEGANDO_URL`: con el servicio activo ya no
 * hace falta que esté en el walled garden.
 *
 * Si se reactivó por una promesa enviada desde esta página, le recuerda lo que prometió: la
 * reactivación llega en menos de un segundo y, sin esto, el cliente no alcanza a leer el aviso.
 */
withDefaults(defineProps<{
    url: string
    promesa?: Pick<PromesaSolicitada, 'monto' | 'vence_en'> | null
}>(), {
    promesa: null,
})
</script>

<template>
    <div
        class="flex flex-col items-center gap-4 py-6 text-center"
        role="status"
        data-testid="servicio-reactivado"
    >
        <div class="flex size-16 items-center justify-center rounded-full bg-success/10">
            <UIcon
                name="i-lucide-circle-check"
                class="size-9 text-success"
            />
        </div>
        <div>
            <h1 class="text-2xl font-semibold text-balance text-highlighted">
                Ya tienes servicio
            </h1>
            <p class="mt-1 text-sm text-muted">
                Tu servicio está activo de nuevo. Si alguna página no abre, espera unos segundos y vuelve a intentarlo.
            </p>
        </div>
        <UAlert
            v-if="promesa"
            color="info"
            variant="subtle"
            icon="i-lucide-calendar-check"
            title="Recuerda tu promesa de pago"
            :description="`Pagarás ${montoEnTexto(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}. Si no se paga a tiempo, el servicio se vuelve a suspender.`"
            class="text-start"
            data-testid="reactivado-promesa"
        />
        <UButton
            label="Seguir navegando"
            icon="i-lucide-globe"
            :to="url"
            external
            size="xl"
            block
        />
    </div>
</template>
