<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Integridad del libro (A3, fase 2; contrato §10.10 y §16): `GET /libro/integridad` (`libro.ver`)
 * recalcula la cadena de hash de cada empresa. Muestra lo que dice la API: verificado o la primera
 * ruptura con su asiento, los sellos de la cadena, cuántos se recalcularon, los asientos aún sin
 * sellar y el primer y último hash del rango. El rango limita qué asientos se recalculan
 * (fecha contable o número de sello); el encadenamiento siempre se revisa desde el sello 1.
 */
const { empresas } = useEmpresaActiva()
const { puede } = usePermisos()

const MOTIVOS_RUPTURA: Record<NonNullable<IntegridadLibro['ruptura']>['motivo'], string> = {
    hash_distinto: 'El hash recalculado no coincide con el guardado: el asiento cambió después de sellarse.',
    encadenamiento: 'El sello no apunta al hash del anterior: la cadena se cortó.',
    sello_faltante: 'Falta un número de sello en la cadena.',
    asiento_inexistente: 'El sello apunta a un asiento que ya no existe.',
    cierre_distinto: 'El hash guardado en un cierre de mes ya no está en la cadena.',
    asiento_en_mes_cerrado: 'Se selló un asiento con fecha en un mes ya cerrado (insertado en el pasado).',
}

/** Espejo de los query de `GET /libro/integridad`: fechas `YYYY-MM-DD` y sellos enteros ≥ 1. */
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const SELLO = /^[1-9]\d{0,9}$/
const esquema = z.object({
    desde: z.string().refine(v => !v || FECHA.test(v), 'Fecha AAAA-MM-DD'),
    hasta: z.string().refine(v => !v || FECHA.test(v), 'Fecha AAAA-MM-DD'),
    desde_sello: z.string().refine(v => !v || SELLO.test(v), 'Número de sello'),
    hasta_sello: z.string().refine(v => !v || SELLO.test(v), 'Número de sello'),
}).refine(d => !d.desde || !d.hasta || d.desde <= d.hasta, { message: 'Debe ser posterior a «desde»', path: ['hasta'] })
    .refine(d => !d.desde_sello || !d.hasta_sello || Number(d.desde_sello) <= Number(d.hasta_sello), { message: 'Debe ser mayor que «desde»', path: ['hasta_sello'] })
type Datos = z.output<typeof esquema>

const estado = reactive<Datos>({ desde: '', hasta: '', desde_sello: '', hasta_sello: '' })
const secciones = shallowRef<IntegridadLibro[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const verificadoEn = ref<string | null>(null)

function filtrosDe(datos: Datos): FiltrosIntegridad {
    const filtros: FiltrosIntegridad = {}
    if (datos.desde) {
        filtros.desde = datos.desde
    }
    if (datos.hasta) {
        filtros.hasta = datos.hasta
    }
    if (datos.desde_sello) {
        filtros.desde_sello = Number(datos.desde_sello)
    }
    if (datos.hasta_sello) {
        filtros.hasta_sello = Number(datos.hasta_sello)
    }
    return filtros
}

async function verificar(datos: Datos = estado) {
    cargando.value = true
    problema.value = null
    const resultado = await useLibro().integridad(filtrosDe(datos))
    cargando.value = false
    secciones.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
    verificadoEn.value = resultado.ok ? new Date().toISOString() : null
}

function limpiar() {
    Object.assign(estado, { desde: '', hasta: '', desde_sello: '', hasta_sello: '' })
    void verificar()
}

/* El asiento de la ruptura (`GET /libro/asientos/:id`), mostrado bajo la alerta. */
const asientoRuptura = shallowRef<Asiento | null>(null)
const cargandoAsiento = ref<number | null>(null)
const problemaAsiento = ref<Problem | null>(null)

async function verAsiento(id: number) {
    cargandoAsiento.value = id
    problemaAsiento.value = null
    const resultado = await useLibro().asiento(id)
    cargandoAsiento.value = null
    asientoRuptura.value = resultado.ok ? resultado.data : null
    problemaAsiento.value = resultado.ok ? null : resultado.problema
}

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

const conRango = computed(() => Object.values(estado).some(Boolean))

onMounted(() => void verificar())
</script>

<template>
    <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
            Cada asiento confirmado recibe un sello con el hash del anterior: si alguien alterara el libro en la base de datos, la cadena dejaría de verificar. El sellador corre cada minuto y el cierre de mes exige la cadena verificada.
        </p>

        <UForm
            :schema="esquema"
            :state="estado"
            class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
            @submit="e => verificar(e.data)"
        >
            <UFormField
                label="Desde (fecha contable)"
                name="desde"
            >
                <UInput
                    v-model="estado.desde"
                    type="date"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="Hasta"
                name="hasta"
            >
                <UInput
                    v-model="estado.hasta"
                    type="date"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="Desde el sello"
                name="desde_sello"
            >
                <UInput
                    v-model="estado.desde_sello"
                    inputmode="numeric"
                    placeholder="1"
                    class="w-full"
                />
            </UFormField>
            <UFormField
                label="Hasta el sello"
                name="hasta_sello"
            >
                <UInput
                    v-model="estado.hasta_sello"
                    inputmode="numeric"
                    class="w-full"
                />
            </UFormField>
            <div class="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
                <UButton
                    type="submit"
                    label="Verificar"
                    icon="i-lucide-shield-check"
                    :loading="cargando"
                    data-prueba="integridad-verificar"
                />
                <UButton
                    v-if="conRango"
                    label="Todo el libro"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    @click="limpiar"
                />
            </div>
        </UForm>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="() => void verificar()"
            :reintentando="cargando"
            data-prueba="integridad-error"
        />
        <USkeleton
            v-else-if="cargando && !secciones.length"
            class="h-40 w-full"
        />
        <template v-else>
            <p
                v-if="verificadoEn"
                class="text-xs text-muted"
            >
                Verificado {{ formatearFechaHora(verificadoEn) }} · versión de la cadena {{ secciones[0]?.version ?? '—' }}
            </p>
            <UEmpty
                v-if="!secciones.length"
                icon="i-lucide-book-open"
                title="Sin empresas que verificar"
                variant="naked"
            />
            <section
                v-for="seccion in secciones"
                :key="seccion.empresa_id"
                class="flex flex-col gap-3 rounded-lg border border-default p-4"
                :data-integridad="seccion.empresa_id"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold text-highlighted">
                        {{ nombreEmpresa(seccion.empresa_id) }}
                    </h3>
                    <UBadge
                        :label="seccion.verificado ? 'Cadena verificada' : 'Cadena rota'"
                        :icon="seccion.verificado ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
                        :color="seccion.verificado ? 'success' : 'error'"
                        variant="subtle"
                        data-prueba="integridad-estado"
                    />
                </div>

                <UAlert
                    v-if="seccion.ruptura"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-shield-alert"
                    :title="`Ruptura en el sello ${seccion.ruptura.sello}`"
                    data-prueba="integridad-ruptura"
                >
                    <template #description>
                        <div class="flex flex-col gap-1">
                            <span>{{ MOTIVOS_RUPTURA[seccion.ruptura.motivo] }} No cierres ni bloquees periodos hasta revisarlo.</span>
                            <span v-if="seccion.ruptura.asiento_id !== null">Asiento #{{ seccion.ruptura.asiento_id }}</span>
                            <span class="break-all font-mono text-xs">Guardado {{ seccion.ruptura.esperado }}</span>
                            <span class="break-all font-mono text-xs">Recalculado {{ seccion.ruptura.obtenido }}</span>
                        </div>
                    </template>
                    <template
                        v-if="seccion.ruptura.asiento_id !== null && puede('libro.ver')"
                        #actions
                    >
                        <UButton
                            :label="`Ver asiento #${seccion.ruptura.asiento_id}`"
                            icon="i-lucide-book-open"
                            color="error"
                            variant="outline"
                            size="sm"
                            :loading="cargandoAsiento === seccion.ruptura.asiento_id"
                            data-prueba="integridad-asiento"
                            @click="verAsiento(seccion.ruptura.asiento_id)"
                        />
                    </template>
                </UAlert>
                <ProblemaAlerta
                    v-if="problemaAsiento && seccion.ruptura"
                    :problema="problemaAsiento"
                />
                <AsientoContable
                    v-if="asientoRuptura && seccion.ruptura?.asiento_id === asientoRuptura.id"
                    :asiento="asientoRuptura"
                    class="lg:max-w-2xl"
                />

                <dl class="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="Sellos en la cadena"
                        :valor="String(seccion.sellos)"
                    />
                    <DatoFicha
                        etiqueta="Recalculados"
                        :valor="String(seccion.verificados)"
                        data-prueba="integridad-verificados"
                    />
                    <DatoFicha
                        etiqueta="Sin sellar (rango)"
                        :valor="String(seccion.sin_sellar)"
                    />
                    <DatoFicha
                        etiqueta="Sellos del rango"
                        :valor="seccion.primer_sello === null ? null : `${seccion.primer_sello} – ${seccion.ultimo_sello ?? '—'}`"
                    />
                    <DatoFicha
                        etiqueta="Primer hash"
                        :valor="seccion.primer_hash"
                        mono
                        class="col-span-2"
                    />
                    <DatoFicha
                        etiqueta="Último hash (último sello)"
                        :valor="seccion.ultimo_hash"
                        mono
                        class="col-span-2"
                        data-prueba="integridad-ultimo-hash"
                    />
                </dl>
                <p
                    v-if="seccion.sin_sellar > 0"
                    class="text-xs text-muted"
                >
                    Los asientos sin sellar reciben su sello en el próximo minuto; el cierre del mes los sella antes de cerrar.
                </p>
            </section>
        </template>
    </div>
</template>
