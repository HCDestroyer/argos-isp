<script setup lang="ts">
const { nombre: nombreEmpresa } = useEmpresa()

useHead({ title: computed(() => `Portal del cliente · ${nombreEmpresa.value}`) })
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
            description="Facturas, pagos y datos de contacto. Entras con un código que te enviamos a tu correo o Telegram registrado."
            icon="i-lucide-user-round"
            to="/cuenta"
            variant="outline"
        />

        <UPageCard
            title="Contacto"
            description="Teléfonos, WhatsApp, correo y horario de atención."
            icon="i-lucide-headset"
            to="/contacto"
            variant="outline"
        />
    </div>
</template>
