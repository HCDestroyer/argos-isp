<script setup lang="ts">
const route = useRoute()

const permiso = computed(() => typeof route.query.permiso === 'string' ? route.query.permiso : null)
const ruta = computed(() => typeof route.query.ruta === 'string' ? route.query.ruta : null)
</script>

<template>
    <PanelPagina
        id="sin-permiso"
        titulo="Sin permiso"
        icono="i-lucide-shield-x"
        descripcion="Tu rol no incluye esta sección"
    >
        <section class="surface-card mx-auto w-full max-w-2xl rounded-[1.375rem] p-6 sm:p-8">
            <UEmpty
                icon="i-lucide-shield-x"
                title="No tienes acceso a esta sección"
                :description="ruta ? `Tu usuario no puede abrir ${ruta}. Pide el permiso a un administrador.` : 'Pide el permiso a un administrador.'"
                :actions="[{ label: 'Volver al inicio', to: '/', icon: 'i-lucide-house', size: 'lg' }, { label: 'Volver atrás', icon: 'i-lucide-chevron-left', color: 'neutral', variant: 'outline', size: 'lg', onClick: () => $router.back() }]"
                variant="naked"
            >
                <template
                    v-if="permiso"
                    #footer
                >
                    <UBadge
                        :label="`Permiso requerido: ${permiso}`"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-lock"
                    />
                </template>
            </UEmpty>
        </section>
    </PanelPagina>
</template>
