<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/** Detalle de un DTE (`GET /dte/:id`, `fel.ver`) con reintentar, XML y PDF. */
definePageMeta({ permiso: 'fel.ver' })

const route = useRoute()
const dteId = computed(() => Number(route.params.id))

const dte = shallowRef<Dte | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `DTE #${route.params.id} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useDte().ver(dteId.value)
    cargando.value = false
    dte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

/* Intentos ante el certificador (`GET /dte/:id/intentos`). */
const intentos = shallowRef<DteIntento[]>([])
const cargandoIntentos = ref(false)
const problemaIntentos = ref<Problem | null>(null)
const intentoAbierto = shallowRef<DteIntento | null>(null)

const OPERACIONES: Record<DteIntento['operacion'], string> = {
    certificar: 'Certificar',
    anular: 'Anular',
    consultar: 'Consultar',
    validar: 'Validar',
}

const columnasIntentos: TableColumn<DteIntento>[] = [
    { accessorKey: 'enviado_en', header: 'Enviado' },
    { accessorKey: 'operacion', header: 'Operación' },
    { accessorKey: 'resultado', header: 'Resultado' },
    { accessorKey: 'duracion_ms', header: 'Duración', meta: SOLO_ANCHO },
    { id: 'respuesta', header: '', meta: { class: { td: 'text-right w-0' } } },
]

async function cargarIntentos() {
    cargandoIntentos.value = true
    problemaIntentos.value = null
    const resultado = await useDte().intentos(dteId.value)
    cargandoIntentos.value = false
    intentos.value = resultado.ok ? resultado.data : []
    problemaIntentos.value = resultado.ok ? null : resultado.problema
}

/** Un rechazado reintentado es otro DTE: se navega a él. */
function alActualizar(nuevo: Dte) {
    if (nuevo.id !== dteId.value) {
        void navigateTo(`/dte/${nuevo.id}`)
        return
    }
    dte.value = nuevo
    void cargarIntentos()
}

watch(dteId, () => {
    void cargar()
    void cargarIntentos()
})
onMounted(() => {
    void cargar()
    void cargarIntentos()
})
</script>

<template>
    <PanelPagina
        id="dte-detalle"
        :titulo="`DTE #${route.params.id}`"
        icono="i-lucide-badge-check"
    >
        <template #acciones>
            <UButton
                to="/dte"
                icon="i-lucide-arrow-left"
                label="Cola de DTE"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando && !dte"
            class="h-48 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="DTE no encontrado"
            :description="`No existe un DTE con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a la cola', to: '/dte', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="dte"
            class="flex flex-col gap-6"
        >
            <UPageCard variant="subtle">
                <DteFicha
                    :dte="dte"
                    con-documento
                    @actualizado="alActualizar"
                />
            </UPageCard>

            <section
                class="flex flex-col gap-2"
                data-prueba="dte-intentos-lista"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Intentos ante el certificador
                </h3>
                <ProblemaAlerta
                    v-if="problemaIntentos"
                    :problema="problemaIntentos"
                    :reintentar="cargarIntentos"
                    :reintentando="cargandoIntentos"
                />
                <UTable
                    v-else
                    :data="intentos"
                    :columns="columnasIntentos"
                    :loading="cargandoIntentos"
                >
                    <template #enviado_en-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFechaHora(row.original.enviado_en) }}</span>
                    </template>
                    <template #operacion-cell="{ row }">
                        <span class="text-sm">{{ OPERACIONES[row.original.operacion] }}</span>
                    </template>
                    <template #resultado-cell="{ row }">
                        <EstadoDteBadge
                            v-if="estadoDteDe(row.original.resultado)"
                            :estado="estadoDteDe(row.original.resultado) ?? 'pendiente'"
                            size="sm"
                        />
                        <span
                            v-else
                            class="font-mono text-xs"
                        >{{ row.original.resultado }}</span>
                    </template>
                    <template #duracion_ms-cell="{ row }">
                        <span class="tabular-nums text-sm">{{ row.original.duracion_ms }} ms</span>
                    </template>
                    <template #respuesta-cell="{ row }">
                        <UButton
                            v-if="Object.keys(row.original.respuesta).length"
                            label="Respuesta"
                            icon="i-lucide-braces"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            @click="intentoAbierto = row.original"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-send"
                            title="Todavía no se ha enviado al certificador"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <UModal
                :open="intentoAbierto !== null"
                :title="`Respuesta del certificador · intento #${intentoAbierto?.id ?? ''}`"
                description="Sin credenciales."
                @update:open="valor => { if (!valor) intentoAbierto = null }"
            >
                <template #body>
                    <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-elevated p-3 font-mono text-xs text-default">{{ JSON.stringify(intentoAbierto?.respuesta ?? {}, null, 2) }}</pre>
                </template>
            </UModal>
        </div>
    </PanelPagina>
</template>
