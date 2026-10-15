<script setup lang="ts">
const { empresa } = useRuntimeConfig().public

useHead({ title: `Portal del cliente · ${empresa.nombre}` })
</script>

<template>
    <div class="flex flex-col gap-4">
        <div>
            <h1 class="text-2xl font-semibold text-highlighted">
                Portal del cliente
            </h1>
            <p class="mt-1 text-sm text-muted">
                Consulta el estado de tu servicio, tus facturas y tus pagos.
            </p>
        </div>

        <UPageCard
            title="Estado de mi servicio"
            description="Si tu servicio está suspendido, aquí ves cuánto debes y cómo reactivarlo."
            icon="i-lucide-wifi"
            to="/corte"
            variant="subtle"
        />

        <UPageCard
            title="Mi cuenta"
            description="Facturas, pagos y datos de contacto con un código enviado a tu teléfono o correo. Disponible pronto."
            icon="i-lucide-user-round"
            variant="outline"
            class="opacity-75"
        />
    </div>
</template>
