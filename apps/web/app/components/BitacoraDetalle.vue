<script setup lang="ts">
/**
 * Detalle de una entrada de la bitácora: quién, por qué canal, sobre qué entidad, la entrada
 * tal cual la guardó la API (los datos sensibles ya vienen como `***`) y el resultado o error.
 */
const props = defineProps<{
    accion: AccionAuditoria | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    /** Filtrar la bitácora por el `request_id` de esta entrada. */
    peticion: [requestId: string]
    /** Ver el historial de cambios de la entidad de esta entrada. */
    cambios: [tipo: string, id: number]
}>()

const ruta = computed(() => (props.accion ? rutaEntidad(props.accion.entidad_tipo, props.accion.entidad_id) : null))
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="accion ? tituloAccion(accion) : 'Entrada'"
        :description="accion ? `${accion.accion} · #${accion.id}` : undefined"
    >
        <template #body>
            <div
                v-if="accion"
                class="flex flex-col gap-5"
                data-prueba="detalle-bitacora"
            >
                <div class="flex flex-wrap gap-2">
                    <UBadge
                        :label="accion.resultado === 'ok' ? 'Correcto' : 'Error'"
                        :icon="accion.resultado === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                        :color="accion.resultado === 'ok' ? 'success' : 'error'"
                        variant="subtle"
                    />
                    <UBadge
                        :label="etiquetaCanal(accion.canal)"
                        color="neutral"
                        variant="outline"
                    />
                </div>

                <dl class="grid grid-cols-2 gap-x-6 gap-y-4">
                    <DatoFicha
                        etiqueta="Fecha (Guatemala)"
                        :valor="formatearFechaHora(accion.created_at)"
                    />
                    <DatoFicha
                        etiqueta="Actor"
                        :valor="etiquetaActor(accion)"
                    />
                    <DatoFicha
                        etiqueta="Entidad"
                        :valor="etiquetaEntidad(accion)"
                    >
                        <ULink
                            v-if="ruta"
                            :to="ruta"
                            class="text-primary"
                        >
                            {{ etiquetaEntidad(accion) }}
                        </ULink>
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Empresa"
                        :valor="accion.empresa_nombre ?? 'Del grupo (sin empresa)'"
                        data-prueba="empresa-accion"
                    />
                    <DatoFicha
                        etiqueta="Request ID"
                        :valor="accion.request_id"
                        mono
                        class="col-span-2"
                    />
                </dl>

                <UAlert
                    v-if="accion.error"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Error"
                    :description="accion.error"
                />

                <section class="flex flex-col gap-2">
                    <h3 class="text-sm font-semibold text-highlighted">
                        Entrada
                    </h3>
                    <pre
                        class="max-h-80 overflow-auto rounded-md bg-elevated p-3 font-mono text-xs whitespace-pre-wrap break-all text-default"
                        data-prueba="entrada"
                    >{{ jsonLegible(accion.entrada) }}</pre>
                </section>

                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="accion.request_id"
                        label="Acciones de esta petición"
                        icon="i-lucide-link"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        @click="emit('peticion', accion.request_id)"
                    />
                    <UButton
                        v-if="accion.entidad_tipo && accion.entidad_id"
                        label="Historial de cambios de la entidad"
                        icon="i-lucide-history"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        @click="emit('cambios', accion.entidad_tipo, accion.entidad_id)"
                    />
                </div>
            </div>
        </template>
    </USlideover>
</template>
