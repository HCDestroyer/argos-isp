<script setup lang="ts">
const { usuario } = useAuth()
const { puede } = usePermisos()

const secciones = computed(() => SECCIONES_PANEL.filter(seccion => puede(seccion.permiso)))
const estados = Object.keys(ESTADOS_SERVICIO) as EstadoServicio[]
const hoy = formatearFecha(new Date())
</script>

<template>
    <PanelPagina
        id="inicio"
        titulo="Inicio"
        icono="i-lucide-house"
    >
        <div class="flex flex-col gap-6">
            <div>
                <h2 class="text-xl font-semibold text-highlighted">
                    Hola, {{ usuario?.nombre }}
                </h2>
                <p class="text-sm text-muted">
                    {{ hoy }} · El tablero con indicadores llega en la semana 2.
                </p>
            </div>

            <UPageGrid class="gap-4 sm:gap-6 lg:grid-cols-3">
                <UPageCard
                    v-for="seccion in secciones"
                    :key="seccion.id"
                    :title="seccion.etiqueta"
                    :description="seccion.descripcion"
                    :icon="seccion.icono"
                    :to="seccion.ruta"
                    variant="subtle"
                />
            </UPageGrid>

            <UPageCard
                title="Estados del servicio"
                description="Colores fijos en todo el sistema."
                variant="outline"
            >
                <div class="flex flex-wrap gap-2">
                    <EstadoServicioBadge
                        v-for="estado in estados"
                        :key="estado"
                        :estado="estado"
                    />
                </div>
            </UPageCard>
        </div>
    </PanelPagina>
</template>
