<script setup lang="ts">
/**
 * Servicios adicionales activos de un servicio (streaming, IPTV…): nombre, identificador y
 * modalidad. La API nunca manda la credencial; aquí tampoco se ofrece verla (se pide a soporte).
 * Con el servicio suspendido, cada adicional dice «Bloqueado por suspensión» (vuelve solo al
 * reactivarse el servicio).
 */
const props = defineProps<{
    adicionales: AdicionalPortal[]
}>()
</script>

<template>
    <div
        v-if="props.adicionales.length > 0"
        class="space-y-1.5"
        data-testid="adicionales"
    >
        <p class="text-xs font-medium text-muted">
            Servicios adicionales
        </p>
        <ul class="space-y-1.5">
            <li
                v-for="adicional in props.adicionales"
                :key="adicional.id"
                class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-elevated/60 px-2.5 py-2"
                data-testid="adicional"
            >
                <div class="flex min-w-0 items-center gap-2">
                    <UIcon
                        :name="adicional.bloqueado ? 'i-lucide-lock' : 'i-lucide-tv'"
                        class="size-4 shrink-0 text-muted"
                    />
                    <div class="min-w-0">
                        <p class="truncate text-sm text-default">
                            {{ adicional.nombre }}
                        </p>
                        <p
                            v-if="adicional.identificador"
                            class="truncate text-xs text-muted"
                            data-testid="adicional-identificador"
                        >
                            {{ adicional.identificador }}
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center justify-end gap-1.5">
                    <UBadge
                        v-if="adicional.bloqueado"
                        label="Bloqueado por suspensión"
                        icon="i-lucide-lock"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        data-testid="adicional-bloqueado"
                    />
                    <UBadge
                        :label="textoModalidad(adicional)"
                        :color="colorModalidad(adicional.modalidad)"
                        variant="subtle"
                        size="sm"
                        class="tabular-nums"
                        data-testid="adicional-modalidad"
                    />
                </div>
            </li>
        </ul>
    </div>
</template>
