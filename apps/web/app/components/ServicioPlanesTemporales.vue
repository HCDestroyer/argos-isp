<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { BadgeProps, FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Planes temporales del servicio (A1, `.claude/integration/a1.md`): mejoras de plan con fecha de
 * fin, manuales (`servicios.programar_plan_temporal`) o de un canje de lealtad. Programar elige un
 * plan del router del servicio (`planes.ver`), cuándo empieza (ahora o un día) y por cuántos días;
 * cancelar (`servicios.cancelar_plan_temporal`) pide motivo y, si estaba activo, devuelve el plan
 * base. Quien lo monta ya comprobó `servicios.ver`.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const emit = defineEmits<{ cambiado: [] }>()

const { puede } = usePermisos()
const toast = useToast()

const lista = usePaginacionCursor(cursor => usePlanesTemporales().listar(props.servicio.id, cursor))
watch(() => props.servicio.id, () => void lista.recargar(), { immediate: true })

const ESTADOS: Record<PlanTemporal['estado'], { etiqueta: string, color: BadgeProps['color'] }> = {
    programado: { etiqueta: 'Programado', color: 'info' },
    activo: { etiqueta: 'Activo', color: 'success' },
    terminado: { etiqueta: 'Terminado', color: 'neutral' },
    cancelado: { etiqueta: 'Cancelado', color: 'neutral' },
}

const columnas: TableColumn<PlanTemporal>[] = [
    { id: 'plan', header: 'Plan', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'vigencia', header: 'Vigencia', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

/* Programar */
const planes = shallowRef<SelectItem[]>([])
const problemaPlanes = ref<Problem | null>(null)
const programarAbierto = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/** Espejo de `programarPlanTemporalValidator`: plan, inicio opcional, días 1–366, motivo 3–500 u omitido. */
const esquema = z.object({
    plan_id: z.number({ message: 'Elige el plan' }).int().min(1, 'Elige el plan').nullable().refine(v => v !== null, 'Elige el plan'),
    inicio: z.string().refine(v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Elige una fecha válida (día, mes y año)'),
    dias: z.number({ message: 'Escribe los días' }).int('Solo enteros').min(1, 'Entre 1 y 366 días').max(366, 'Entre 1 y 366 días'),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres').refine(v => v === '' || v.length >= 3, 'Al menos 3 caracteres'),
})
type Entrada = z.input<typeof esquema>
const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>({ plan_id: null, inicio: '', dias: 30, motivo: '' })

async function abrirProgramar() {
    Object.assign(estado, { plan_id: null, inicio: '', dias: 30, motivo: '' })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    programarAbierto.value = true
    if (!puede('planes.ver')) {
        problemaPlanes.value = problemaSinPermiso('planes.ver')
        return
    }
    const resultado = await useRouters().planes(props.servicio.router_id)
    planes.value = resultado.ok
        ? resultado.data.filter(p => p.activo && p.id !== props.servicio.plan_id).map(p => ({ label: p.nombre, description: `${formatearVelocidad(p.bajada_kbps)} / ${formatearVelocidad(p.subida_kbps)}`, value: p.id }))
        : []
    problemaPlanes.value = resultado.ok ? null : resultado.problema
}

async function programar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const datos: DatosPlanTemporal = { plan_id: evento.data.plan_id as number, dias: evento.data.dias }
    if (evento.data.inicio) {
        datos.inicio = inicioDiaGuatemala(evento.data.inicio)
    }
    if (evento.data.motivo) {
        datos.motivo = evento.data.motivo
    }
    const resultado = await usePlanesTemporales().programar(props.servicio.id, datos, clave)
    enviando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problema.value = resultado.problema
        return
    }
    programarAbierto.value = false
    toast.add({ title: `${resultado.data.plan_nombre} ${resultado.data.estado === 'activo' ? 'activo' : 'programado'}`, description: `Hasta el ${formatearFechaHora(resultado.data.fin)}; después vuelve a ${resultado.data.plan_original_nombre}.`, color: 'success', icon: 'i-lucide-circle-check' })
    void lista.recargar()
    emit('cambiado')
}

/* Cancelar */
const aCancelar = shallowRef<PlanTemporal | null>(null)
const cancelarAbierto = ref(false)

function pedirCancelar(plan: PlanTemporal) {
    aCancelar.value = plan
    cancelarAbierto.value = true
}

function cancelar(motivo: string, claveIdempotencia: string): Promise<Resultado<PlanTemporal>> {
    const plan = aCancelar.value
    if (!plan) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un plan temporal', status: 400 } })
    }
    return usePlanesTemporales().cancelar(plan, motivo, claveIdempotencia)
}

function alCancelar(plan: PlanTemporal) {
    toast.add({ title: 'Plan temporal cancelado', description: plan.iniciado_en ? `El servicio vuelve a ${plan.plan_original_nombre}.` : undefined, color: 'success', icon: 'i-lucide-circle-check' })
    void lista.recargar()
    emit('cambiado')
}

/** Retirado o pendiente de instalación: la API rechaza programar (422). */
const puedeProgramar = computed(() => puede('servicios.programar_plan_temporal') && props.servicio.estado !== 'retirado' && props.servicio.estado !== 'pendiente_instalacion')
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Planes temporales"
        data-prueba="planes-temporales"
    >
        <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Planes temporales
            </h3>
            <UButton
                v-if="puedeProgramar"
                label="Programar mejora"
                icon="i-lucide-calendar-clock"
                color="neutral"
                variant="outline"
                size="sm"
                data-prueba="programar-plan-temporal"
                @click="abrirProgramar"
            />
        </div>
        <ProblemaAlerta
            v-if="lista.problema.value"
            :problema="lista.problema.value"
            :reintentar="lista.recargar"
            :reintentando="lista.cargando.value"
        />
        <template v-else>
            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                :ui="{ td: 'py-2.5' }"
            >
                <template #plan-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-plan-temporal="row.original.id"
                    >
                        <span class="text-sm font-medium text-highlighted">{{ row.original.plan_nombre }}</span>
                        <span class="text-xs text-muted">Base: {{ row.original.plan_original_nombre }} · {{ row.original.origen === 'lealtad' ? 'canje de lealtad' : 'manual' }}</span>
                        <span
                            v-if="row.original.motivo"
                            class="text-xs text-muted"
                        >{{ row.original.motivo }}</span>
                        <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.inicio) }} → {{ formatearFecha(row.original.fin) }}</span>
                    </div>
                </template>
                <template #vigencia-cell="{ row }">
                    <span class="whitespace-nowrap text-sm">{{ formatearFechaHora(row.original.inicio) }} → {{ formatearFechaHora(row.original.fin) }}</span>
                </template>
                <template #estado-cell="{ row }">
                    <UBadge
                        :label="ESTADOS[row.original.estado].etiqueta"
                        :color="ESTADOS[row.original.estado].color"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puede('servicios.cancelar_plan_temporal') && (row.original.estado === 'programado' || row.original.estado === 'activo')"
                        label="Cancelar"
                        icon="i-lucide-ban"
                        color="error"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Cancelar el plan temporal ${row.original.plan_nombre}`"
                        :data-prueba="`cancelar-plan-temporal-${row.original.id}`"
                        @click="pedirCancelar(row.original)"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-calendar-clock"
                        title="Sin planes temporales"
                        description="Una mejora de plan por unos días (promoción o canje de lealtad) aparece aquí."
                        variant="naked"
                    />
                </template>
            </UTable>
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

        <UModal
            v-model:open="programarAbierto"
            title="Programar mejora de plan"
            :description="`${servicio.plan_nombre ?? 'Plan actual'} vuelve solo al terminar.`"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    id="form-plan-temporal"
                    ref="formulario"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="programar"
                >
                    <ProblemaAlerta
                        v-if="problemaPlanes"
                        :problema="problemaPlanes"
                    />
                    <UFormField
                        label="Plan"
                        name="plan_id"
                        required
                    >
                        <USelect
                            :model-value="estado.plan_id ?? undefined"
                            :items="planes"
                            placeholder="Elige el plan del router"
                            class="w-full"
                            data-prueba="plan-temporal-plan"
                            @update:model-value="v => estado.plan_id = typeof v === 'number' ? v : null"
                        />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Empieza"
                            name="inicio"
                            help="Vacío = ahora."
                        >
                            <UInput
                                v-model="estado.inicio"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Días"
                            name="dias"
                            required
                        >
                            <UInputNumber
                                v-model="estado.dias"
                                :min="1"
                                :max="366"
                                class="w-full"
                                data-prueba="plan-temporal-dias"
                            />
                        </UFormField>
                    </div>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                    >
                        <UInput
                            v-model="estado.motivo"
                            placeholder="Promoción de aniversario"
                            class="w-full"
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
                        @click="programarAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-plan-temporal"
                        label="Programar"
                        icon="i-lucide-calendar-clock"
                        :loading="enviando"
                        data-prueba="plan-temporal-guardar"
                    />
                </div>
            </template>
        </UModal>

        <AccionMotivoModal
            v-model:open="cancelarAbierto"
            titulo="Cancelar plan temporal"
            :efecto="aCancelar?.estado === 'activo' ? `El servicio vuelve a ${aCancelar.plan_original_nombre} de inmediato.` : 'El plan programado no se aplicará.'"
            confirmar="Cancelar plan temporal"
            placeholder="Ej.: el cliente pidió quitar la promoción"
            :ejecutar="cancelar"
            @hecho="alCancelar"
        />
    </section>
</template>
