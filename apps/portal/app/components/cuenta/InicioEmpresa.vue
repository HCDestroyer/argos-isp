<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Un grupo del inicio: los servicios de UNA empresa con su marca y sus accesos rápidos.
 *
 * Los accesos salen de los datos de esa empresa (`useEmpresa({ empresaId })`: pago en línea,
 * cuentas, instrucciones y soporte), nunca de otra. Con una sola empresa la marca ya está en la barra
 * superior y aquí no se repite; con varias, cada sección lleva el logo y el nombre de la empresa
 * que factura sobre sus servicios, su saldo y sus accesos. El saldo y las facturas pendientes son
 * los de la sección de esa empresa en el estado de cuenta (`PortalCuenta.empresas`): cada NIT
 * cobra lo suyo.
 */
const props = defineProps<{
    grupo: GrupoEmpresa
    mostrarMarca: boolean
    /** Servicio → se le puede pedir promesa ahora (condiciones de la API). */
    promesaPorServicio: Record<number, boolean | null>
    /** Telegram de este grupo: el del bot de su empresa (con varias) o el único (en el primer grupo). */
    telegram?: { disponible: boolean, vinculado: boolean } | null
    /** Adonde lleva "Vincular Telegram" (la tarjeta de esta empresa). */
    rutaTelegram?: string
}>()

const emit = defineEmits<{
    accion: [accion: NonNullable<AccesoRapido['accion']>]
    pedirPromesa: [servicioId: number]
}>()

// Único por empresa (dos secciones con `useId` podían repetir id tras recargar la cuenta).
const idTitulo = computed(() => `titulo-${props.grupo.clave}`)
const { empresa } = useEmpresa({ empresaId: () => props.grupo.empresa.id })

/** Facturas pendientes de esta empresa y su saldo a favor (sección de `PortalCuenta.empresas`). */
const facturas = computed(() => resumenFacturas(props.grupo.cuenta))
const aFavor = computed(() => {
    const saldo = props.grupo.cuenta?.saldo_a_favor
    return saldo && new Decimal(saldo).greaterThan(0) ? saldo : null
})

const accesos = computed(() => {
    const permisos = props.grupo.servicios.map(s => props.promesaPorServicio[s.id] ?? null)
    const promesaDisponible = permisos.includes(true) ? true : permisos.includes(null) ? null : false
    // Mientras se leen los datos de la empresa, el soporte sale de su marca (teléfono y WhatsApp).
    const contacto = empresa.value ?? { ...props.grupo.empresa, telefono_alterno: null, correo: null }
    return accesosRapidos({
        modo: 'sesion',
        empresa: empresa.value,
        montoAdeudado: props.grupo.montoAdeudado,
        retirado: props.grupo.servicios.every(s => s.estado === 'retirado'),
        promesaDisponible,
        telegram: props.telegram ?? null,
        soporte: soporteDe(contacto, rutaContactoEmpresa(props.grupo.empresa.id)),
        rutaTelegram: props.rutaTelegram ?? '/cuenta?seccion=cuenta#telegram',
    })
})
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
            <PortalMarcaEmpresa
                :nombre="props.grupo.empresa.nombre_comercial"
                :logo-url="props.grupo.empresa.logo_url"
                class="size-8"
            />
            <div class="min-w-0">
                <h2
                    :id="idTitulo"
                    class="truncate font-semibold text-highlighted"
                    data-testid="marca-grupo"
                >
                    {{ props.grupo.empresa.nombre_comercial }}
                </h2>
                <p
                    v-if="props.grupo.empresa.nit"
                    class="truncate text-xs text-muted"
                >
                    NIT {{ props.grupo.empresa.nit }}
                </p>
            </div>
            <span
                class="ms-auto shrink-0 text-sm font-semibold tabular-nums text-highlighted"
                data-testid="saldo-grupo"
            >
                {{ formatearQuetzales(props.grupo.montoAdeudado) }}
            </span>
        </div>
        <p
            v-if="props.mostrarMarca && (facturas || aFavor)"
            class="-mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
            data-testid="facturas-grupo"
        >
            <span v-if="facturas">{{ facturas }}</span>
            <span v-if="aFavor">Saldo a favor {{ formatearQuetzales(aFavor) }}</span>
        </p>
        <h2
            v-else
            :id="idTitulo"
            class="sr-only"
        >
            Mis servicios con {{ props.grupo.empresa.nombre_comercial }}
        </h2>

        <PortalAccesosRapidos
            :accesos="accesos"
            :titulo="props.mostrarMarca ? `Accesos rápidos de ${props.grupo.empresa.nombre_comercial}` : 'Accesos rápidos'"
            @accion="emit('accion', $event)"
        />

        <UCard
            v-if="props.grupo.servicios.length > 0"
            :ui="{ body: 'p-0 sm:p-0' }"
        >
            <ul class="divide-y divide-default">
                <li
                    v-for="servicio in props.grupo.servicios"
                    :key="servicio.id"
                    class="space-y-3 p-3 sm:p-4"
                    data-testid="servicio-cuenta"
                >
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <p class="truncate text-sm font-medium text-default">
                                    {{ servicio.plan ?? 'Servicio de internet' }}
                                </p>
                                <UBadge
                                    v-if="servicio.plan_tipo"
                                    :label="TIPOS_PLAN[servicio.plan_tipo]"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    data-testid="plan-tipo"
                                />
                            </div>
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
                    </div>
                    <CuentaAdicionales :adicionales="servicio.adicionales" />
                </li>
            </ul>
        </UCard>
    </section>
</template>
