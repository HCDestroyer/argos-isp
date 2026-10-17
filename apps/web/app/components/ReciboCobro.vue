<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Recibo de un cobro repartido (`GET /cobros/:id`, A3): un pago por empresa, cada sección con la
 * marca y los datos fiscales de su empresa (nombre comercial, razón social, NIT y dirección) y las
 * facturas que pagó. ArgosIsp solo va en el pie. Se imprime como el ticket de 80 mm.
 */
const props = defineProps<{
    cobroId: number
    cliente: Pick<Cliente, 'nombre' | 'nit_cui'>
    cajero?: string | null
}>()

const cobro = shallowRef<Schema<'Cobro'> | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await usePagos().cobro(props.cobroId)
    cargando.value = false
    cobro.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

function aplicado(pago: Pago): Decimal {
    return pago.aplicaciones.reduce((suma, a) => suma.plus(a.monto), new Decimal(0))
}
</script>

<template>
    <ProblemaAlerta
        v-if="problema"
        :problema="problema"
        :reintentar="cargar"
        :reintentando="cargando"
    />
    <USkeleton
        v-else-if="!cobro"
        class="h-64 w-full"
    />
    <article
        v-else
        class="recibo-ticket surface-card flex flex-col gap-3 p-4 text-sm"
        aria-label="Recibo del cobro"
        data-prueba="recibo-cobro"
    >
        <header class="flex flex-col items-center gap-0.5 text-center">
            <p class="text-xs text-muted">
                Recibo de cobro · {{ cobro.secciones.length }} {{ cobro.secciones.length === 1 ? 'empresa' : 'empresas' }}
            </p>
            <p class="font-mono text-lg font-semibold text-highlighted">
                Cobro No. {{ String(cobro.id).padStart(6, '0') }}
            </p>
            <p class="text-xs text-muted">
                {{ formatearFechaHora(cobro.created_at) }} (hora de Guatemala)
            </p>
            <p class="text-highlighted">
                {{ cliente.nombre }} · NIT <span class="font-mono">{{ cliente.nit_cui ?? 'CF' }}</span>
            </p>
        </header>

        <template
            v-for="seccion in cobro.secciones"
            :key="seccion.pago.id"
        >
            <USeparator type="dashed" />
            <section
                class="flex flex-col gap-1.5"
                :data-empresa="seccion.empresa.id"
                :aria-label="`Pago a ${seccion.empresa.nombre_comercial}`"
            >
                <div class="flex items-center gap-2">
                    <UAvatar
                        :src="urlLogoEmpresa(seccion.empresa.logo_url)"
                        :alt="seccion.empresa.nombre_comercial"
                        size="xs"
                    />
                    <p class="font-semibold text-highlighted">
                        {{ seccion.empresa.nombre_comercial }}
                    </p>
                </div>
                <p class="text-xs text-muted">
                    {{ seccion.empresa.razon_social ?? seccion.empresa.nombre_comercial }} · NIT <span class="font-mono">{{ seccion.empresa.nit ?? '—' }}</span><template v-if="seccion.empresa.direccion_fiscal">
                        · {{ seccion.empresa.direccion_fiscal }}
                    </template>
                </p>
                <p class="text-xs text-muted">
                    Pago No. <span class="font-mono">{{ String(seccion.pago.id).padStart(6, '0') }}</span>
                    · {{ ETIQUETAS_METODO[seccion.pago.metodo] }}
                </p>
                <ul class="flex flex-col gap-0.5">
                    <li
                        v-for="aplicacion in seccion.pago.aplicaciones"
                        :key="aplicacion.factura_id"
                        class="flex justify-between gap-3"
                    >
                        <span>Aviso #{{ aplicacion.factura_id }}</span>
                        <span class="tabular-nums">{{ formatearQuetzales(aplicacion.monto) }}</span>
                    </li>
                    <li
                        v-if="new Decimal(seccion.pago.monto).gt(aplicado(seccion.pago))"
                        class="flex justify-between gap-3 text-muted"
                    >
                        <span>Anticipo</span>
                        <span class="tabular-nums">{{ formatearQuetzales(new Decimal(seccion.pago.monto).minus(aplicado(seccion.pago))) }}</span>
                    </li>
                </ul>
                <p class="flex justify-between gap-3 font-medium text-highlighted">
                    <span>Subtotal {{ seccion.empresa.nombre_comercial }}</span>
                    <span class="tabular-nums">{{ formatearQuetzales(seccion.pago.monto) }}</span>
                </p>
            </section>
        </template>

        <USeparator type="dashed" />
        <p
            class="flex justify-between gap-3 text-base font-semibold text-highlighted"
            data-prueba="total-cobro"
        >
            <span>Total cobrado</span>
            <span class="tabular-nums">{{ formatearQuetzales(cobro.monto) }}</span>
        </p>
        <p
            v-if="cajero"
            class="text-xs text-muted"
        >
            Atendió: {{ cajero }}
        </p>
        <footer class="text-center text-xs text-muted">
            ArgosIsp
        </footer>
    </article>
</template>
