<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Comparador de regímenes (A3, fase 8 PR B; `GET /fiscal/comparador?crecimiento=`, `fiscal.ver`): con los
 * últimos 12 meses del libro y los parámetros vigentes, cuánto pagaría la empresa en el régimen opcional
 * simplificado y sobre utilidades (con el ISO como piso), `m` y `m*`, y una proyección a 12 meses con el
 * crecimiento mensual que se escriba (vacío: la tendencia). Simulación: el aviso siempre está a la vista,
 * no hay «aplicar» y nada se guarda. Con «Todas», una sección por empresa.
 */
definePageMeta({ permiso: 'fiscal.ver' })

useHead({ title: 'Comparador de regímenes · ArgosIsp' })

const AVISO_SIN_DATOS = 'Simulación de referencia con los datos del libro y los parámetros vigentes; no cambia el régimen. Valídela con su contador'

const route = useRoute()
const router = useRouter()
const { eleccion, nombre: nombreEmpresa } = useEmpresaActiva()

const CRECIMIENTO = /^-?\d{1,3}(\.\d{1,2})?$/
const inicial = typeof route.query.crecimiento === 'string' && CRECIMIENTO.test(route.query.crecimiento) ? route.query.crecimiento : ''

const estado = reactive<EstadoCrecimiento>({ crecimiento: inicial })
const aplicado = ref(inicial)
const formulario = useTemplateRef('formulario')

const comparador = shallowRef<ComparadorRegimenes | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
let pedido = 0

async function cargar() {
    const actual = ++pedido
    cargando.value = true
    const resultado = await useComparadorRegimenes().comparar(aplicado.value || undefined)
    if (actual !== pedido) {
        return
    }
    cargando.value = false
    if (resultado.ok) {
        comparador.value = resultado.data
        problema.value = null
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length && errores.every(e => e.name === 'crecimiento')) {
        // El crecimiento no pasó la validación de la API: el error va en el campo y se queda lo anterior.
        formulario.value?.setErrors(errores)
        return
    }
    comparador.value = null
    problema.value = problemaFiscalLegible(resultado.problema)
}

function reintentar() {
    void cargar()
}

function recalcular(evento: FormSubmitEvent<EstadoCrecimiento>) {
    aplicado.value = evento.data.crecimiento
    void router.replace({ query: { ...route.query, crecimiento: aplicado.value || undefined } })
    void cargar()
}

function usarTendencia() {
    estado.crecimiento = ''
    formulario.value?.clear()
    if (aplicado.value !== '') {
        aplicado.value = ''
        void router.replace({ query: { ...route.query, crecimiento: undefined } })
        void cargar()
    }
}

watch(eleccion, reintentar)

onMounted(reintentar)
</script>

<template>
    <PanelPagina
        id="fiscal-comparador"
        titulo="Comparador de regímenes"
        icono="i-lucide-scale"
    >
        <div class="flex flex-col gap-6">
            <UAlert
                color="warning"
                variant="subtle"
                icon="i-lucide-flask-conical"
                title="Simulación"
                :description="comparador?.aviso ?? AVISO_SIN_DATOS"
                data-prueba="comparador-aviso"
            />

            <UForm
                ref="formulario"
                :schema="esquemaCrecimiento"
                :state="estado"
                class="flex flex-col gap-3 sm:flex-row sm:items-end"
                data-prueba="form-crecimiento"
                @submit="recalcular"
            >
                <UFormField
                    label="Crecimiento mensual de las ventas"
                    name="crecimiento"
                    description="Por ciento con hasta 2 decimales; vacío usa la tendencia de los meses leídos."
                    class="sm:max-w-sm sm:flex-1"
                >
                    <UInput
                        v-model="estado.crecimiento"
                        placeholder="Tendencia"
                        inputmode="decimal"
                        class="w-full"
                        data-prueba="campo-crecimiento"
                    >
                        <template #trailing>
                            <span class="text-xs text-muted">% al mes</span>
                        </template>
                    </UInput>
                </UFormField>
                <div class="flex gap-2">
                    <UButton
                        type="submit"
                        label="Recalcular proyección"
                        icon="i-lucide-refresh-cw"
                        :loading="cargando"
                    />
                    <UButton
                        label="Usar tendencia"
                        color="neutral"
                        variant="outline"
                        :disabled="aplicado === '' && estado.crecimiento === ''"
                        @click="usarTendencia"
                    />
                </div>
            </UForm>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="reintentar"
                :reintentando="cargando"
                data-prueba="comparador-problema"
            />

            <div
                v-else-if="!comparador"
                class="flex flex-col gap-4"
                aria-busy="true"
                aria-label="Cargando el comparador"
            >
                <USkeleton class="h-48 w-full" />
                <USkeleton class="h-32 w-full" />
            </div>

            <template v-else>
                <p class="text-xs text-muted">
                    Calculado al {{ formatearFecha(comparador.hoy) }}<template v-if="comparador.empresas.length > 1">
                        · una sección por empresa, sin totales consolidados
                    </template>
                </p>
                <UAlert
                    v-if="!comparador.empresas.length"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-building-2"
                    title="Sin empresas activas"
                    description="No hay empresas activas para comparar."
                />
                <template
                    v-for="(empresa, indice) in comparador.empresas"
                    :key="empresa.empresa_id"
                >
                    <USeparator v-if="indice > 0" />
                    <ComparadorRegimenesEmpresa
                        :empresa="empresa"
                        :nombre="nombreEmpresa(empresa.empresa_id)"
                        :reintentar="reintentar"
                        :reintentando="cargando"
                    />
                </template>
            </template>
        </div>
    </PanelPagina>
</template>
