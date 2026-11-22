<script setup lang="ts">
/**
 * Inicio público del portal: banner con la marca (degradado, texto blanco) y la acción principal
 * «Entrar a mi cuenta», y debajo los tres caminos como tarjetas con su pastilla de icono.
 */
const { nombre: nombreEmpresa } = useEmpresa()

useHead({ title: computed(() => `Portal del cliente · ${nombreEmpresa.value}`) })
</script>

<template>
    <div class="flex flex-col gap-4">
        <section class="ax-banner flex flex-col gap-4 p-5 sm:p-7">
            <div>
                <h1 class="text-2xl font-semibold sm:text-3xl">
                    Portal del cliente
                </h1>
                <p class="ax-banner-suave mt-1 text-sm">
                    Consulta el estado de tu servicio, tus facturas y tus pagos.
                </p>
            </div>
            <UButton
                label="Entrar a mi cuenta"
                icon="i-lucide-log-in"
                color="neutral"
                size="lg"
                to="/entrar"
                class="ax-banner-accion self-start rounded-full px-5 font-semibold"
            />
        </section>

        <UPageCard
            title="Estado de mi servicio"
            description="Si tu servicio está suspendido, aquí ves cuánto debes y cómo reactivarlo."
            icon="i-lucide-wifi"
            to="/corte"
            variant="outline"
            class="ax-tocable"
        />

        <UPageCard
            title="Mi cuenta"
            description="Facturas, pagos y datos de contacto. Entras con tu documento y contraseña, o con un código que te enviamos."
            icon="i-lucide-user-round"
            to="/cuenta"
            variant="outline"
            class="ax-tocable"
        />

        <UPageCard
            title="Contacto"
            description="Teléfonos, WhatsApp, correo y horario de atención."
            icon="i-lucide-headset"
            to="/contacto"
            variant="outline"
            class="ax-tocable"
        />
    </div>
</template>
