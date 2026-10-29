<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Conciliación de la pasarela en línea (A3): cada corrida compara los cobros de un día (Guatemala)
 * con lo que reporta el proveedor y deja sus diferencias (pago sin registrar, monto distinto,
 * anulado…). Leer pide `pagos.ver`; «Conciliar un día», `facturas.generar` (lo mismo que corre el
 * cron cada madrugada). Las diferencias se resuelven en Pagos o con el proveedor.
 */
definePageMeta({ permiso: 'pagos.ver' })

useHead({ title: 'Conciliación de la pasarela · ArgosIsp' })

const { puede, enlace } = usePermisos()
const toast = useToast()

const fecha = ref('')
const lista = usePaginacionCursor(cursor => usePasarela().conciliaciones(fecha.value || undefined, cursor))
watch(fecha, () => void lista.recargar())
onMounted(() => void lista.recargar())

const DIFERENCIAS: Record<ConciliacionPasarela['diferencias'][number]['tipo'], string> = {
    pago_sin_registrar: 'El proveedor cobró y no hay pago registrado',
    pago_sin_cobro_en_proveedor: 'Hay pago registrado y el proveedor no lo reporta',
    monto_distinto: 'El monto no coincide',
    pago_anulado: 'El pago está anulado y el proveedor lo cobró',
    pago_sin_cobro: 'Pago sin cobro de pasarela',
    error_consulta: 'No se pudo consultar al proveedor',
    disputa: 'Contracargo abierto en el proveedor',
    reembolso_sin_aplicar: 'Reembolso del proveedor rechazado y sin aplicar',
}

/* Conciliar un día */
const esquema = z.object({
    fecha: z.string().refine(v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Elige una fecha válida (día, mes y año)'),
})
const estado = reactive<z.input<typeof esquema>>({ fecha: '' })
const abierto = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

function abrir() {
    estado.fecha = ''
    problema.value = null
    clave = nuevaClaveIdempotencia()
    abierto.value = true
}

async function conciliar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePasarela().conciliar(evento.data.fecha || null, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    const r = resultado.data
    toast.add({
        title: r.diferencias.length ? `${r.diferencias.length} diferencias el ${formatearFecha(r.fecha)}` : `Todo concilia el ${formatearFecha(r.fecha)}`,
        description: `${r.conciliados} de ${r.revisados} cobros conciliados con ${r.proveedor}.`,
        color: r.diferencias.length ? 'warning' : 'success',
        icon: r.diferencias.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check',
    })
    void lista.recargar()
}
</script>

<template>
    <PanelPagina
        id="pasarela"
        titulo="Conciliación de la pasarela"
        icono="i-lucide-scale"
    >
        <template #acciones>
            <UButton
                v-if="puede('facturas.generar')"
                label="Conciliar un día"
                icon="i-lucide-play"
                data-prueba="conciliar-pasarela"
                @click="abrir"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-sm text-muted">
                    Cobros en línea de cada día contra el reporte del proveedor. El sistema concilia el día anterior cada madrugada.
                </p>
                <UInput
                    v-model="fecha"
                    type="date"
                    aria-label="Filtrar por día"
                    class="w-full sm:w-48"
                />
            </div>
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <USkeleton
                    v-if="lista.cargando.value && !lista.filas.value.length"
                    class="h-32 w-full"
                />
                <UEmpty
                    v-else-if="!lista.filas.value.length"
                    icon="i-lucide-scale"
                    :title="fecha ? 'Sin corridas ese día' : 'Todavía no hay conciliaciones'"
                    variant="naked"
                />
                <UCard
                    v-for="corrida in lista.filas.value"
                    :key="corrida.id"
                    variant="subtle"
                    :data-conciliacion="corrida.id"
                >
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ formatearFecha(corrida.fecha) }} · {{ corrida.proveedor }}</span>
                                <span class="text-xs text-muted">{{ corrida.conciliados }} de {{ corrida.revisados }} cobros conciliados<template v-if="corrida.created_at"> · corrida {{ formatearFechaHora(corrida.created_at) }}</template></span>
                            </div>
                            <UBadge
                                :label="corrida.diferencias.length ? `${corrida.diferencias.length} diferencias` : 'Concilia'"
                                :color="corrida.diferencias.length ? 'warning' : 'success'"
                                variant="subtle"
                            />
                        </div>
                    </template>
                    <ul
                        v-if="corrida.diferencias.length"
                        class="flex flex-col divide-y divide-default"
                    >
                        <li
                            v-for="(d, i) in corrida.diferencias"
                            :key="i"
                            class="flex flex-col gap-0.5 py-2 text-sm"
                        >
                            <span class="font-medium text-highlighted">{{ DIFERENCIAS[d.tipo] ?? d.tipo }}</span>
                            <span class="text-xs text-muted">{{ d.detalle }}</span>
                            <span class="flex flex-wrap gap-x-3 text-xs text-muted">
                                <span v-if="d.nuestro !== null">Nuestro {{ formatearQuetzales(d.nuestro) }}</span>
                                <span v-if="d.proveedor !== null">Proveedor {{ formatearQuetzales(d.proveedor) }}</span>
                                <span
                                    v-if="d.id_proveedor"
                                    class="font-mono"
                                >{{ d.id_proveedor }}</span>
                                <ULink
                                    v-if="d.pago_id && enlace(`/pagos/${d.pago_id}`)"
                                    :to="enlace(`/pagos/${d.pago_id}`)"
                                    class="text-primary"
                                >Pago #{{ d.pago_id }}</ULink>
                            </span>
                        </li>
                    </ul>
                    <p
                        v-else
                        class="text-sm text-muted"
                    >
                        Cada cobro del día coincide con el proveedor.
                    </p>
                </UCard>
                <PaginacionCursor
                    v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <UModal
            v-model:open="abierto"
            title="Conciliar un día"
            description="Consulta al proveedor los cobros del día y deja las diferencias."
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    id="form-conciliar"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="conciliar"
                >
                    <UFormField
                        label="Día"
                        name="fecha"
                        help="Vacío = ayer (Guatemala)."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            class="w-full"
                            data-prueba="conciliar-fecha"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="abierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-conciliar"
                        label="Conciliar"
                        icon="i-lucide-play"
                        :loading="enviando"
                        data-prueba="conciliar-confirmar"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
