<script setup lang="ts">
/**
 * «Solicitar un servicio» del inicio (tablero `NuevoPortal`): las cuatro solicitudes que van a Iris
 * (cambio de plan, otro servicio, traslado y otra), cada una lleva a su formulario en página
 * (`/solicitudes/nueva?tipo=`). Solo con el soporte de Iris disponible (lo decide `cuenta.vue`).
 */
const tonos: Record<string, TonoPastilla> = { cambio_plan: 'primary', alta: 'info', traslado: 'warning', otro: 'neutral' }
</script>

<template>
    <section
        class="ax-tarjeta flex flex-col gap-4 p-4 sm:p-5"
        aria-labelledby="titulo-solicitar-servicio"
        data-testid="solicitar-servicio"
    >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PortalPastilla icono="i-lucide-plus" />
            <h2
                id="titulo-solicitar-servicio"
                class="font-semibold text-highlighted"
            >
                Solicitar un servicio
            </h2>
            <p class="text-sm text-muted">
                Un asesor te contacta para confirmarlo.
            </p>
        </div>
        <ul class="ax-en-tarjeta grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <li
                v-for="opcion in OPCIONES_SOLICITUD"
                :key="opcion.tipo"
            >
                <UButton
                    :to="`/solicitudes/nueva?tipo=${opcion.tipo}`"
                    color="neutral"
                    variant="outline"
                    block
                    class="ax-tarjeta ax-tocable h-full"
                    :ui="{ base: 'flex-row items-center justify-start gap-2.5 p-3 text-start ring-0 hover:bg-(--ax-tarjeta) active:bg-(--ax-tarjeta) sm:flex-col sm:items-start sm:p-3.5' }"
                    :data-testid="`solicitar-${opcion.tipo}`"
                >
                    <PortalPastilla
                        :icono="opcion.icono"
                        :tono="tonos[opcion.tipo]"
                        tamano="sm"
                    />
                    <span class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-sm font-semibold text-highlighted">{{ opcion.titulo }}</span>
                        <span class="text-xs font-normal text-muted max-sm:sr-only">{{ opcion.descripcion }}</span>
                    </span>
                </UButton>
            </li>
        </ul>
    </section>
</template>
