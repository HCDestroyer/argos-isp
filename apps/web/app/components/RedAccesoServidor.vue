<script setup lang="ts">
/**
 * Un servidor PPPoE dentro del árbol de la red de acceso: nombre, estado (de Argos o adoptado),
 * perfil, la red IPv4 con el `local-address` (solo lectura: sale del gateway de la red), los pools
 * IPv6 y cuántos servicios lo usan. Editar y eliminar con su permiso; uno con servicios no se borra.
 */
const props = defineProps<{
    servidor: ServidorPppoe
    red: RedIpv4 | null
    poolEnlace: Ipv6Pool | null
    poolDelegacion: Ipv6Pool | null
}>()

defineEmits<{
    editar: []
    eliminar: []
}>()

const { puede } = usePermisos()

const estado = computed(() => (props.servidor.estado === 'administrado'
    ? { etiqueta: 'De Argos', icono: 'i-lucide-circle-check', color: 'success' as const }
    : { etiqueta: 'Adoptado', icono: 'i-lucide-lock', color: 'neutral' as const }))
</script>

<template>
    <div
        class="flex flex-col gap-3 rounded-md border border-default bg-elevated/40 p-3 sm:ml-12"
        :data-servidor="servidor.id"
    >
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-highlighted">
                    <UIcon
                        name="i-lucide-radio-tower"
                        class="size-4 text-primary"
                    />
                    {{ servidor.nombre }}
                    <UBadge
                        :label="estado.etiqueta"
                        :icon="estado.icono"
                        :color="estado.color"
                        variant="subtle"
                        size="sm"
                    />
                    <UBadge
                        v-if="!servidor.activo"
                        label="Inactivo"
                        icon="i-lucide-circle-pause"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                    />
                </span>
                <span class="font-mono text-xs text-muted">service-name {{ servidor.service_name }} · perfil {{ servidor.perfil ?? '—' }}</span>
            </div>
            <div class="flex gap-1">
                <UButton
                    v-if="puede('servidores_pppoe.editar')"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Editar ${servidor.nombre}`"
                    :data-prueba="`editar-servidor-${servidor.id}`"
                    @click="$emit('editar')"
                />
                <UButton
                    v-if="puede('servidores_pppoe.eliminar') && servidor.servicios === 0"
                    icon="i-lucide-trash-2"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Eliminar ${servidor.nombre}`"
                    @click="$emit('eliminar')"
                />
            </div>
        </div>
        <dl class="grid gap-3 text-xs sm:grid-cols-3">
            <div class="flex flex-col gap-0.5">
                <dt class="text-muted">
                    Red IPv4
                </dt>
                <dd class="font-mono text-default">
                    {{ red?.cidr ?? 'Sin red: el router asigna' }}
                </dd>
            </div>
            <div class="flex flex-col gap-0.5">
                <dt class="text-muted">
                    local-address
                </dt>
                <dd
                    :class="servidor.local_address ? 'font-mono text-highlighted' : 'text-warning'"
                    :data-prueba="`local-address-${servidor.id}`"
                >
                    {{ servidor.local_address ?? 'Sin gateway en la red' }}
                </dd>
                <dd class="text-muted">
                    Sale del gateway de la red
                </dd>
            </div>
            <div class="flex flex-col gap-0.5">
                <dt class="text-muted">
                    Servicios
                </dt>
                <dd class="text-default tabular-nums">
                    {{ servidor.servicios.toLocaleString('es-GT') }}
                </dd>
            </div>
            <div
                v-if="poolEnlace || poolDelegacion"
                class="flex flex-col gap-0.5 sm:col-span-3"
            >
                <dt class="text-muted">
                    Pools IPv6
                </dt>
                <dd class="font-mono text-default">
                    {{ [poolEnlace ? `enlace ${poolEnlace.prefijo}` : null, poolDelegacion ? `delegación ${poolDelegacion.prefijo}` : null].filter(Boolean).join(' · ') }}
                </dd>
            </div>
        </dl>
    </div>
</template>
