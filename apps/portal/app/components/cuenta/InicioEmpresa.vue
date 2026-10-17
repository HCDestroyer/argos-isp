<script setup lang="ts">
/**
 * Un grupo del inicio: los servicios de una empresa con sus accesos rápidos.
 *
 * Hoy hay un solo grupo y la cabecera de marca no se muestra (la marca ya está en la barra
 * superior). Con multiempresa, `/cuenta` pinta un grupo por empresa y `mostrarMarca` pone el logo y
 * el nombre de la empresa que factura sobre sus servicios, su saldo y sus accesos.
 */
const props = defineProps<{
    grupo: GrupoEmpresa
    accesos: AccesoRapido[]
    mostrarMarca: boolean
    /** Servicio → se le puede pedir promesa ahora (condiciones de la API). */
    promesaPorServicio: Record<number, boolean | null>
}>()

const emit = defineEmits<{
    accion: [accion: NonNullable<AccesoRapido['accion']>]
    pedirPromesa: [servicioId: number]
}>()

const idTitulo = useId()
</script>

<template>
    <section
        class="flex flex-col gap-3"
        :aria-labelledby="idTitulo"
        :data-testid="`grupo-${props.grupo.clave}`"
    >
        <div
            v-if="props.mostrarMarca"
            class="flex items-center gap-2"
        >
            <img
                v-if="props.grupo.empresa.logoUrl"
                :src="props.grupo.empresa.logoUrl"
                alt=""
                class="size-8 rounded-md object-contain"
            >
            <LogoArgos
                v-else
                class="size-8"
            />
            <h2
                :id="idTitulo"
                class="min-w-0 truncate font-semibold text-highlighted"
            >
                {{ props.grupo.empresa.nombre }}
            </h2>
            <span class="ms-auto shrink-0 text-sm font-semibold tabular-nums text-highlighted">
                {{ formatearQuetzales(props.grupo.montoAdeudado) }}
            </span>
        </div>
        <h2
            v-else
            :id="idTitulo"
            class="sr-only"
        >
            Mis servicios con {{ props.grupo.empresa.nombre }}
        </h2>

        <PortalAccesosRapidos
            :accesos="props.accesos"
            @accion="emit('accion', $event)"
        />

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <ul class="divide-y divide-default">
                <li
                    v-for="servicio in props.grupo.servicios"
                    :key="servicio.id"
                    class="flex items-center justify-between gap-3 p-3 sm:p-4"
                    data-testid="servicio-cuenta"
                >
                    <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-default">
                            {{ servicio.plan ?? 'Servicio de internet' }}
                        </p>
                        <p
                            v-if="servicio.direccion"
                            class="truncate text-xs text-muted"
                        >
                            {{ servicio.direccion }}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1">
                        <EstadoServicioBadge
                            :estado="servicio.estado"
                            size="sm"
                        />
                        <span
                            v-if="props.grupo.servicios.length > 1"
                            class="text-sm font-medium tabular-nums text-highlighted"
                            data-testid="saldo-servicio"
                        >
                            {{ formatearQuetzales(servicio.monto_adeudado) }}
                        </span>
                        <UButton
                            v-if="props.promesaPorServicio[servicio.id] === true"
                            label="Pedir promesa"
                            icon="i-lucide-hand-coins"
                            color="neutral"
                            variant="link"
                            size="sm"
                            class="px-0"
                            data-testid="pedir-promesa"
                            @click="emit('pedirPromesa', servicio.id)"
                        />
                    </div>
                </li>
            </ul>
        </UCard>
    </section>
</template>
