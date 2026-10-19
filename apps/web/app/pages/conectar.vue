<script setup lang="ts">
/**
 * Si alguien abre en el navegador un enlace de conexión de ArgosIsp (`/conectar#<código>`,
 * `contratos/horus.md` §1.4): ese enlace se pega en Horus, no se abre. El código va en el fragmento,
 * que nunca se envía a ningún servidor; aquí tampoco se lee ni se manda.
 */
definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Enlace de conexión · ArgosIsp' })
</script>

<template>
    <div class="min-h-dvh">
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <main class="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
            <LogoArgos
                variante="linea"
                class="size-16 text-primary"
            />
            <div class="surface-card flex w-full max-w-md flex-col gap-4 p-6">
                <h1 class="text-xl font-semibold text-highlighted">
                    Este enlace se pega en Horus
                </h1>
                <p class="text-sm text-default">
                    Es un enlace de conexión de ArgosIsp. Cópialo de la barra de direcciones y pégalo en
                    Horus → Administración → Integraciones → ArgosISP → <strong>Conectar con enlace</strong>.
                </p>
                <UAlert
                    color="info"
                    variant="subtle"
                    icon="i-lucide-shield-check"
                    description="Dura 15 minutos y sirve una sola vez. Abrirlo aquí no lo gasta: el código no sale de tu navegador."
                />
                <UButton
                    to="/"
                    label="Ir al panel"
                    icon="i-lucide-arrow-right"
                    color="neutral"
                    variant="outline"
                    class="self-start"
                />
            </div>
        </main>
    </div>
</template>
