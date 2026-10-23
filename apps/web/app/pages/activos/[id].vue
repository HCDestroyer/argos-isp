<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Ficha de un activo fijo (A3, fase 5): clase, costo, residual, tasa y cuota, depreciación acumulada y
 * valor en libros, cuentas, la compra de la que nació y su baja. «Dar de baja» (`activos.dar_de_baja`).
 */
definePageMeta({ permiso: 'activos.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const id = computed(() => Number(route.params.id))
const activo = shallowRef<ActivoFijo | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead(() => ({ title: `${activo.value?.descripcion ?? 'Activo fijo'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    const resultado = await useActivos().ver(id.value)
    cargando.value = false
    activo.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

const dandoDeBaja = ref(false)

function alBaja(nuevo: ActivoFijo) {
    activo.value = nuevo
    toast.add({ title: 'Activo dado de baja', description: `${nuevo.descripcion} · ${nuevo.baja ? TIPOS_BAJA[nuevo.baja.tipo] : ''}`, icon: 'i-lucide-archive', color: 'neutral' })
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="activo"
        :titulo="activo ? `Activo #${activo.id}` : 'Activo fijo'"
        icono="i-lucide-boxes"
    >
        <template #acciones>
            <UButton
                v-if="activo && activo.estado === 'vigente' && puede('activos.dar_de_baja')"
                label="Dar de baja"
                icon="i-lucide-archive"
                color="error"
                variant="outline"
                data-prueba="abrir-baja"
                @click="dandoDeBaja = true"
            />
        </template>

        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="activo">
                <UAlert
                    v-if="activo.baja"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-archive"
                    :title="`Dado de baja el ${formatearFecha(activo.baja.fecha)} · ${TIPOS_BAJA[activo.baja.tipo]}`"
                    :description="`${activo.baja.motivo}. Valor en libros a la baja: ${formatearQuetzales(activo.baja.valor_libros)}${activo.baja.tipo === 'venta' ? ` · precio ${formatearQuetzales(activo.baja.precio_venta)}` : ''}.`"
                    data-prueba="activo-baja"
                />
                <UCard :ui="{ body: 'p-4 sm:p-4' }">
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-base font-semibold text-highlighted">
                                {{ activo.descripcion }}
                            </h2>
                            <UBadge
                                :label="ESTADOS_ACTIVO[activo.estado].etiqueta"
                                :color="ESTADOS_ACTIVO[activo.estado].color"
                                :icon="ESTADOS_ACTIVO[activo.estado].icono"
                                variant="subtle"
                            />
                        </div>
                        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <DatoFicha
                                etiqueta="Clase"
                                :valor="etiquetaClaseActivo(activo.clase)"
                            />
                            <DatoFicha
                                etiqueta="Serie"
                                :valor="activo.serie"
                            />
                            <DatoFicha
                                etiqueta="Ubicación"
                                :valor="activo.ubicacion"
                            />
                            <DatoFicha
                                etiqueta="Alta"
                                :valor="formatearFecha(activo.fecha_alta)"
                            />
                            <DatoFicha etiqueta="Costo">
                                <span class="tabular-nums">{{ formatearQuetzales(activo.costo) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="Valor residual">
                                <span class="tabular-nums">{{ formatearQuetzales(activo.valor_residual) }}</span>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Tasa anual"
                                :valor="`${activo.tasa_anual} %`"
                            />
                            <DatoFicha etiqueta="Cuota mensual">
                                <span class="tabular-nums">{{ formatearQuetzales(activo.cuota_mensual) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="Depreciación acumulada">
                                <span class="tabular-nums">{{ formatearQuetzales(activo.depreciacion_acumulada) }}</span>
                            </DatoFicha>
                            <DatoFicha etiqueta="Valor en libros">
                                <span
                                    class="font-semibold tabular-nums"
                                    data-prueba="valor-libros"
                                >{{ formatearQuetzales(activo.valor_libros) }}</span>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Cuotas"
                                :valor="activo.cuotas ? `${activo.cuotas} (la última de ${activo.ultima_cuota?.slice(0, 7)})` : `Ninguna; la primera es de ${activo.inicio_depreciacion.slice(0, 7)}`"
                            />
                            <DatoFicha
                                v-if="!new Decimal(activo.depreciacion_inicial).isZero()"
                                etiqueta="Depreciación al alta"
                            >
                                <span class="tabular-nums">{{ formatearQuetzales(activo.depreciacion_inicial) }}</span>
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Cuentas"
                                :valor="`${activo.cuenta_activo_codigo} · ${activo.cuenta_depreciacion_codigo}`"
                                mono
                            />
                            <DatoFicha
                                v-if="activo.compra_id"
                                etiqueta="Comprado con"
                            >
                                <ULink
                                    :to="puede('compras.ver') ? `/compras/${activo.compra_id}` : undefined"
                                    class="text-highlighted underline"
                                >
                                    Compra #{{ activo.compra_id }}
                                </ULink>
                            </DatoFicha>
                        </dl>
                    </div>
                </UCard>
            </template>
        </div>

        <BajaActivoModal
            v-if="activo"
            v-model:open="dandoDeBaja"
            :activo="activo"
            @hecho="alBaja"
        />
    </PanelPagina>
</template>
