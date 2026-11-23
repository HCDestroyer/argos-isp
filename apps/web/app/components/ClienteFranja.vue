<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Franja del cliente (tablero NuevoClienteFicha), en una sola fila: a la izquierda avatar, nombre
 * con el estado (el peor de sus servicios), código, teléfono y zona; en medio los contadores de
 * saldo, próximo vencimiento y servicios; a la derecha «Cobrar Q …» con el monto y el menú «Más»
 * (`#acciones`). Es el único lugar de la ficha que muestra el saldo. Si no cabe, los contadores se
 * compactan; las acciones nunca bajan de línea. `compacta`: al bajar se reduce a nombre, estado,
 * saldo y Cobrar. En el teléfono el saldo va solo en la barra de abajo («Cobrar Q …») y los
 * contadores son «Vencidas», «Próximo» y «Servicios». Lo que no se pudo leer queda con su aviso y
 * «Reintentar», nunca como cero.
 */
const props = withDefaults(defineProps<{
    cliente: Cliente
    servicios: Servicio[] | null
    cuenta: EstadoCuenta | null
    problemaCuenta?: Problem | null
    zona?: string | null
    compacta?: boolean
    /** Permiso de ver el estado de cuenta (sin él, sin saldo ni vencimientos). */
    verCuenta?: boolean
}>(), {
    problemaCuenta: null,
    zona: null,
    compacta: false,
    verCuenta: true,
})

const emit = defineEmits<{
    reintentarCuenta: []
}>()

const { puede, enlace } = usePermisos()

const cobro = computed(() => enlace(`/cobro?cliente=${props.cliente.id}`))

const resumen = computed(() => resumenCuentaCliente(props.cuenta, props.servicios))
const estado = computed(() => peorEstadoServicios(props.servicios))
/** «Cobrar Q 300.00» con lo que debe; sin deuda o sin poder leer la cuenta, solo «Cobrar» (nunca «Q 0.00»). */
const etiquetaCobrar = computed(() => (props.verCuenta && resumen.value?.debe ? `Cobrar ${formatearQuetzales(resumen.value.saldo)}` : 'Cobrar'))
/**
 * En el teléfono el saldo sale en la barra de abajo; el contador solo aparece si esa barra no lo
 * muestra (sin permiso de cobrar) o si hay que avisar que no se pudo leer.
 */
const saldoEnTelefono = computed(() => !cobro.value || !!props.problemaCuenta)
const textoVencidas = computed(() => (resumen.value ? (resumen.value.vencidas ? `${resumen.value.vencidas} ${resumen.value.vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}` : 'Sin facturas vencidas') : ''))
</script>

<template>
    <section
        class="surface-card flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[1.375rem] transition-[padding] duration-200 motion-reduce:transition-none lg:flex-nowrap"
        :class="compacta ? 'px-3 py-2' : 'p-4 sm:px-5'"
        :aria-label="`Cliente ${cliente.nombre}`"
        data-prueba="franja-cliente"
        :data-compacta="compacta || undefined"
    >
        <div class="order-1 flex min-w-0 flex-1 items-center gap-3 lg:flex-initial lg:shrink">
            <AvatarIniciales
                :nombre="cliente.nombre"
                :size="compacta ? 'lg' : '3xl'"
                class="shrink-0"
            />
            <div class="flex min-w-0 flex-col gap-0.5">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <h1
                        class="truncate font-bold tracking-[-0.02em] text-highlighted"
                        :class="compacta ? 'text-[0.9375rem]' : 'text-xl sm:text-[1.3125rem]'"
                    >
                        {{ cliente.nombre }}
                    </h1>
                    <EstadoServicioBadge
                        v-if="estado"
                        :estado="estado"
                        size="sm"
                        class="rounded-full"
                    />
                </div>
                <p
                    v-if="!compacta"
                    class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8125rem] text-muted"
                >
                    <span class="font-mono">{{ cliente.codigo }}</span>
                    <span
                        v-if="cliente.telefono || cliente.movil"
                        class="inline-flex items-center gap-1 whitespace-nowrap"
                    >
                        <UIcon
                            name="i-lucide-phone"
                            class="size-3.5"
                        />
                        {{ cliente.telefono ?? cliente.movil }}
                    </span>
                    <span
                        v-if="zona"
                        class="inline-flex items-center gap-1 whitespace-nowrap"
                    >
                        <UIcon
                            name="i-lucide-map-pin"
                            class="size-3.5"
                        />
                        {{ zona }}
                    </span>
                </p>
                <slot
                    v-if="!compacta"
                    name="meta"
                />
            </div>
        </div>

        <!-- Contadores con ícono y contexto: se compactan antes que bajar las acciones. -->
        <div
            v-if="!compacta"
            class="order-3 grid w-full min-w-0 grid-cols-3 gap-2 sm:flex sm:flex-nowrap lg:order-2 lg:w-auto lg:shrink lg:overflow-hidden"
            data-prueba="contadores-cliente"
        >
            <template v-if="verCuenta">
                <div
                    class="min-w-0 items-center gap-2.5 rounded-xl p-2.5 ring ring-(--ax-borde) sm:flex sm:pe-4"
                    :class="[resumen?.debe ? 'bg-error/8 ring-error/30' : 'bg-(--ax-panel)', saldoEnTelefono ? 'col-span-3 flex' : 'hidden']"
                    data-prueba="contador-saldo"
                >
                    <span class="hidden shrink-0 min-[90rem]:block">
                        <span
                            class="pastilla-icono pastilla-tono size-9 shrink-0 rounded-lg"
                            :class="resumen?.debe ? 'tono-error' : 'tono-exito'"
                        >
                            <UIcon
                                :name="ICONOS.cobrar"
                                class="size-4.5"
                            />
                        </span>
                    </span>
                    <span class="flex min-w-0 flex-col">
                        <span class="text-xs text-muted">Saldo</span>
                        <span
                            v-if="resumen"
                            class="whitespace-nowrap text-base font-bold tabular-nums sm:text-lg"
                            :class="resumen.debe ? 'text-error' : 'text-highlighted'"
                            data-prueba="franja-saldo"
                        >{{ formatearQuetzales(resumen.saldo) }}</span>
                        <span
                            v-else-if="problemaCuenta"
                            class="flex items-center gap-1.5 whitespace-nowrap text-sm text-error"
                            role="alert"
                            data-prueba="franja-saldo-error"
                        >
                            No se pudo leer
                            <UButton
                                label="Reintentar"
                                icon="i-lucide-rotate-cw"
                                color="error"
                                variant="link"
                                size="xs"
                                class="p-0"
                                @click="emit('reintentarCuenta')"
                            />
                        </span>
                        <USkeleton
                            v-else
                            class="h-6 w-20"
                        />
                        <span
                            v-if="resumen"
                            class="hidden whitespace-nowrap text-[0.6875rem] text-muted min-[90rem]:block"
                        >{{ textoVencidas }}</span>
                    </span>
                </div>
                <!-- Teléfono: las vencidas (el monto va en la barra de abajo). -->
                <div
                    class="flex min-w-0 flex-col rounded-xl p-2.5 ring sm:hidden"
                    :class="resumen?.vencidas ? 'bg-error/8 ring-error/30' : 'bg-(--ax-panel) ring-(--ax-borde)'"
                >
                    <span class="text-xs text-muted">Vencidas</span>
                    <span
                        class="text-base font-bold tabular-nums"
                        :class="resumen?.vencidas ? 'text-error' : 'text-highlighted'"
                        data-prueba="franja-vencidas"
                    >{{ resumen ? resumen.vencidas : '—' }}</span>
                </div>
                <div class="flex min-w-0 items-center gap-2.5 rounded-xl bg-(--ax-panel) p-2.5 ring ring-(--ax-borde) sm:pe-4">
                    <span class="hidden shrink-0 min-[90rem]:block">
                        <span class="pastilla-icono pastilla-tono tono-aviso size-9 shrink-0 rounded-lg">
                            <UIcon
                                name="i-lucide-clock"
                                class="size-4.5"
                            />
                        </span>
                    </span>
                    <span class="flex min-w-0 flex-col">
                        <span class="whitespace-nowrap text-xs text-muted"><span class="sm:hidden">Próximo</span><span class="hidden sm:inline">Próximo vencimiento</span></span>
                        <span
                            class="whitespace-nowrap text-base font-bold text-highlighted sm:text-lg"
                            data-prueba="franja-proximo"
                        >{{ resumen?.proxima ? formatearFechaCorta(resumen.proxima.vence_en) : '—' }}</span>
                        <span
                            v-if="resumen && !resumen.proxima"
                            class="hidden whitespace-nowrap text-[0.6875rem] text-muted min-[90rem]:block"
                        >Nada por vencer</span>
                    </span>
                </div>
            </template>
            <div
                v-if="puede('servicios.ver')"
                class="flex min-w-0 items-center gap-2.5 rounded-xl bg-(--ax-panel) p-2.5 ring ring-(--ax-borde) sm:pe-4"
            >
                <span class="hidden shrink-0 min-[90rem]:block">
                    <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-lg">
                        <UIcon
                            name="i-lucide-wifi"
                            class="size-4.5"
                        />
                    </span>
                </span>
                <span class="flex min-w-0 flex-col">
                    <span class="text-xs text-muted">Servicios</span>
                    <span class="whitespace-nowrap text-base font-bold text-highlighted sm:text-lg">
                        <template v-if="servicios">
                            <span class="sm:hidden">{{ servicios.length }}</span>
                            <span class="hidden sm:inline">{{ textoServiciosCliente(servicios) }}</span>
                        </template>
                        <template v-else>—</template>
                    </span>
                    <span
                        v-if="servicios?.length"
                        class="hidden whitespace-nowrap text-[0.6875rem] text-muted min-[90rem]:block"
                    >{{ formatearQuetzales(sumarPrecios(servicios)) }} / mes</span>
                </span>
            </div>
        </div>

        <!-- Compacta: el saldo junto al nombre (escritorio; en el teléfono ya va en la barra). -->
        <div
            v-else-if="verCuenta && (resumen || problemaCuenta)"
            class="order-2 text-sm font-bold tabular-nums"
            :class="[resumen?.debe || problemaCuenta ? 'text-error' : 'text-highlighted', saldoEnTelefono ? '' : 'hidden sm:block']"
        >
            {{ resumen ? formatearQuetzales(resumen.saldo) : 'Saldo: no se pudo leer' }}
        </div>

        <div class="order-2 ms-auto flex shrink-0 items-center gap-2 lg:order-3">
            <UButton
                v-if="cobro"
                :to="cobro"
                :icon="ICONOS.cobrar"
                :label="etiquetaCobrar"
                color="success"
                :size="compacta ? 'md' : 'lg'"
                class="hidden whitespace-nowrap rounded-full px-5 tabular-nums sm:inline-flex"
                data-prueba="franja-cobrar"
            />
            <slot name="acciones" />
        </div>
    </section>
</template>
