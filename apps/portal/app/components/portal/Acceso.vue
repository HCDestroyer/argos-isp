<script setup lang="ts">
/**
 * Marco de las páginas de acceso (`/entrar`, `/cambiar-contrasena`). En escritorio, dividido: a la
 * izquierda el panel con el degradado de marca (texto blanco, AA), el logo y el nombre de la empresa
 * y una frase; a la derecha el título y el formulario. En el teléfono, solo el logo arriba y el
 * formulario: nada que empuje los campos fuera de la pantalla.
 */
const props = defineProps<{
    titulo: string
    descripcion: string
}>()

const { nombre, logoUrl } = useEmpresa()
</script>

<template>
    <div class="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-10">
        <aside
            class="ax-banner hidden flex-col justify-between gap-10 p-8 lg:flex"
            aria-hidden="true"
            data-testid="acceso-panel"
        >
            <span class="flex items-center gap-3">
                <PortalMarcaEmpresa
                    :nombre="nombre"
                    :logo-url="logoUrl"
                    respaldo="argos"
                    class="size-11"
                />
                <span class="text-lg font-semibold">{{ nombre }}</span>
            </span>
            <span class="flex flex-col gap-3">
                <span class="text-3xl leading-tight font-semibold tracking-[-0.02em] text-balance">
                    Tu servicio, tus facturas y tus pagos en un solo lugar.
                </span>
                <span class="ax-banner-suave text-sm">
                    Paga en línea, sube tu comprobante o pide una promesa de pago sin ir a la oficina.
                </span>
            </span>
            <span class="ax-banner-suave flex flex-col gap-2 text-sm">
                <span class="flex items-center gap-2">
                    <UIcon
                        name="i-lucide-shield-check"
                        class="size-4"
                    />
                    Tus datos viajan cifrados y solo tú los ves.
                </span>
                <span class="flex items-center gap-2">
                    <UIcon
                        name="i-lucide-smartphone"
                        class="size-4"
                    />
                    Hecho para usarlo desde el teléfono.
                </span>
            </span>
        </aside>

        <div class="flex min-w-0 flex-col gap-4 lg:py-4">
            <div class="flex flex-col gap-3">
                <PortalMarcaEmpresa
                    :nombre="nombre"
                    :logo-url="logoUrl"
                    respaldo="argos"
                    class="size-12 lg:hidden"
                />
                <div>
                    <h1 class="text-2xl font-semibold text-highlighted">
                        {{ props.titulo }}
                    </h1>
                    <p class="mt-1 text-sm text-muted">
                        {{ props.descripcion }}
                    </p>
                </div>
            </div>
            <slot />
        </div>
    </div>
</template>
