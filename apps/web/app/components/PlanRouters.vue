<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Implementación del plan por router (A1, brief tarea 7): profile PPP, pools, `local-address`,
 * rate-limit propio y excepciones de velocidad del plan en cada router (`null` = hereda del plan).
 * Leer pide `planes.ver` (el de la página); crear o editar, `planes.editar`. Los nombres de los
 * routers se leen con `routers.ver`; sin él se ve el id.
 */
const props = defineProps<{
    plan: Plan
}>()

const { puede } = usePermisos()
const toast = useToast()

const implementaciones = shallowRef<PlanRouter[]>([])
const routers = shallowRef<RouterNas[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const [lista, listaRouters] = await Promise.all([
        usePlanes().implementaciones(props.plan.id),
        puede('routers.ver') ? useRouters().listar() : null,
    ])
    cargando.value = false
    implementaciones.value = lista.ok ? lista.data : []
    problema.value = lista.ok ? null : lista.problema
    routers.value = listaRouters?.ok ? listaRouters.data.data : []
}

watch(() => props.plan.id, () => void cargar(), { immediate: true })

function nombreRouter(id: number): string {
    return routers.value.find(r => r.id === id)?.nombre ?? `Router ${id}`
}

const columnas: TableColumn<PlanRouter>[] = [
    { id: 'router', header: 'Router', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'pools', header: 'Profile y pools', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

/* Velocidad del plan en un router y sincronizar (`contratos/control-velocidad.md`). */
const seleccionada = shallowRef<PlanRouter | null>(null)
const estrategiaAbierta = ref(false)
const sincronizarAbierto = ref(false)

function abrirEstrategia(implementacion: PlanRouter) {
    seleccionada.value = implementacion
    estrategiaAbierta.value = true
}

function abrirSincronizar(implementacion: PlanRouter) {
    seleccionada.value = implementacion
    sincronizarAbierto.value = true
}

/* Formulario */
const abierto = ref(false)
const editando = shallowRef<PlanRouter | null>(null)
const routerElegido = ref<number | null>(null)
const estado = reactive<EntradaPlanRouter>(entradaPlanRouter(null))
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)

const routersLibres = computed<SelectItem[]>(() => routers.value
    .filter(r => !implementaciones.value.some(i => i.router_id === r.id))
    .map(r => ({ label: r.nombre, value: r.id })))

function abrir(implementacion: PlanRouter | null) {
    editando.value = implementacion
    routerElegido.value = implementacion?.router_id ?? null
    Object.assign(estado, entradaPlanRouter(implementacion))
    problemaGuardar.value = null
    abierto.value = true
}

function numeroONulo(valor: unknown): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

async function enviar(evento: FormSubmitEvent<SalidaPlanRouter>) {
    if (routerElegido.value === null) {
        problemaGuardar.value = { type: 'about:blank', title: 'Elige el router', status: 422 }
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    const resultado = await usePlanes().implementar(props.plan.id, routerElegido.value, cuerpoPlanRouter(evento.data, editando.value?.version ?? null))
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: `${props.plan.nombre} en ${nombreRouter(resultado.data.router_id)}`, description: resumenImplementacion(resultado.data), color: 'success', icon: 'i-lucide-circle-check' })
        void cargar()
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problemaGuardar.value = resultado.problema
}

const VELOCIDAD: { campo: 'reuso' | 'garantizado_pct' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps' | 'rafaga_umbral_pct' | 'rafaga_segundos' | 'prioridad', etiqueta: string, min: number, max: number, paso?: number }[] = [
    { campo: 'reuso', etiqueta: 'Reuso 1:N', min: 1, max: 64 },
    { campo: 'garantizado_pct', etiqueta: 'Garantía (%)', min: 0.01, max: 100, paso: 0.01 },
    { campo: 'prioridad', etiqueta: 'Prioridad (1–8)', min: 1, max: 8 },
    { campo: 'rafaga_bajada_kbps', etiqueta: 'Ráfaga bajada (kbps)', min: 1, max: 100_000_000, paso: 1000 },
    { campo: 'rafaga_subida_kbps', etiqueta: 'Ráfaga subida (kbps)', min: 1, max: 100_000_000, paso: 1000 },
    { campo: 'rafaga_umbral_pct', etiqueta: 'Umbral de ráfaga (%)', min: 1, max: 99 },
    { campo: 'rafaga_segundos', etiqueta: 'Tiempo de ráfaga (s)', min: 1, max: 3600 },
]
</script>

<template>
    <UPageCard
        title="Implementación por router"
        description="Cómo se aplica este plan en cada router. Lo vacío hereda del plan o de la configuración del router."
        icon="i-lucide-router"
        variant="subtle"
        data-prueba="plan-routers"
    >
        <template
            v-if="puede('planes.editar') && (routersLibres.length || !puede('routers.ver'))"
            #footer
        >
            <UButton
                label="Implementar en un router"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="!routersLibres.length"
                data-prueba="implementar-plan"
                @click="abrir(null)"
            />
        </template>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="implementaciones"
            :columns="columnas"
            :loading="cargando"
            :ui="{ td: 'py-2.5' }"
        >
            <template #router-cell="{ row }">
                <div
                    class="flex min-w-0 flex-col gap-0.5"
                    :data-implementacion="row.original.router_id"
                >
                    <span class="text-sm font-medium text-highlighted">{{ nombreRouter(row.original.router_id) }}</span>
                    <span class="text-xs text-muted">{{ resumenImplementacion(row.original) }}</span>
                    <UBadge
                        v-if="tieneExcepcion(row.original.estrategia_velocidad)"
                        label="Velocidad propia en este router"
                        icon="i-lucide-sliders-horizontal"
                        color="info"
                        variant="subtle"
                        size="sm"
                        class="self-start"
                        :data-prueba="`excepcion-plan-${row.original.router_id}`"
                    />
                    <span
                        v-if="row.original.rate_limit_override"
                        class="break-all font-mono text-xs text-muted"
                    >{{ row.original.rate_limit_override }}</span>
                </div>
            </template>
            <template #pools-cell="{ row }">
                <span class="font-mono text-xs">{{ [row.original.profile_ppp, row.original.pool_ipv4, row.original.pool_ipv6_enlace, row.original.pool_ipv6_delegacion].filter(Boolean).join(' · ') || '—' }}</span>
            </template>
            <template #acciones-cell="{ row }">
                <div class="flex justify-end gap-1">
                    <UButton
                        v-if="puede('routers.cambiar_control_velocidad') && puede('routers.ver')"
                        icon="i-lucide-sliders-horizontal"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Velocidad del plan en ${nombreRouter(row.original.router_id)}`"
                        :data-prueba="`estrategia-plan-${row.original.router_id}`"
                        @click="abrirEstrategia(row.original)"
                    />
                    <UButton
                        v-if="puede('planes.sincronizar')"
                        icon="i-lucide-refresh-cw"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Sincronizar el plan en ${nombreRouter(row.original.router_id)}`"
                        :data-prueba="`sincronizar-plan-${row.original.router_id}`"
                        @click="abrirSincronizar(row.original)"
                    />
                    <UButton
                        v-if="puede('planes.editar')"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Editar la implementación en ${nombreRouter(row.original.router_id)}`"
                        :data-prueba="`editar-implementacion-${row.original.router_id}`"
                        @click="abrir(row.original)"
                    />
                </div>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-router"
                    :title="plan.global ? 'Sin ajustes por router: aplica igual en todos' : 'Todavía no está en ningún router'"
                    variant="naked"
                />
            </template>
        </UTable>

        <USlideover
            v-model:open="abierto"
            :title="editando ? `${plan.nombre} en ${nombreRouter(editando.router_id)}` : `Implementar ${plan.nombre}`"
            description="Vacío = hereda del plan. El rate-limit propio reemplaza al calculado en estado activo."
            :dismissible="!enviando"
            :ui="{ content: 'sm:max-w-2xl' }"
        >
            <template #body>
                <UForm
                    id="form-plan-router"
                    ref="formulario"
                    :schema="esquemaPlanRouter"
                    :state="estado"
                    class="flex flex-col gap-6"
                    @submit="enviar"
                >
                    <UFormField
                        v-if="!editando"
                        label="Router"
                        required
                    >
                        <USelect
                            :model-value="routerElegido ?? undefined"
                            :items="routersLibres"
                            placeholder="Elige el router"
                            class="w-full"
                            data-prueba="plan-router-router"
                            @update:model-value="v => routerElegido = typeof v === 'number' ? v : null"
                        />
                    </UFormField>
                    <section class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Profile PPP"
                            name="profile_ppp"
                        >
                            <UInput
                                v-model="estado.profile_ppp"
                                class="w-full font-mono"
                                data-prueba="plan-router-profile"
                            />
                        </UFormField>
                        <UFormField
                            label="Local address"
                            name="local_address"
                        >
                            <UInput
                                v-model="estado.local_address"
                                placeholder="10.0.0.1"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="Pool IPv4"
                            name="pool_ipv4"
                        >
                            <UInput
                                v-model="estado.pool_ipv4"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="Pool IPv6 de enlace"
                            name="pool_ipv6_enlace"
                        >
                            <UInput
                                v-model="estado.pool_ipv6_enlace"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            label="Pool IPv6 delegado"
                            name="pool_ipv6_delegacion"
                        >
                            <UInput
                                v-model="estado.pool_ipv6_delegacion"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <USwitch
                            v-model="estado.no_crear_reglas"
                            label="No crear reglas automáticas"
                            description="El router ya tiene sus colas o reglas para este plan."
                            class="self-center"
                        />
                    </section>
                    <section class="flex flex-col gap-3">
                        <h3 class="text-sm font-medium text-highlighted">
                            Excepciones de velocidad en este router
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-3">
                            <UFormField
                                v-for="campo in VELOCIDAD"
                                :key="campo.campo"
                                :label="campo.etiqueta"
                                :name="campo.campo"
                            >
                                <UInputNumber
                                    :model-value="estado[campo.campo] ?? undefined"
                                    :min="campo.min"
                                    :max="campo.max"
                                    :step="campo.paso ?? 1"
                                    :step-snapping="false"
                                    :format-options="{ useGrouping: false, maximumFractionDigits: 2 }"
                                    placeholder="Del plan"
                                    class="w-full"
                                    @update:model-value="v => estado[campo.campo] = numeroONulo(v)"
                                />
                            </UFormField>
                        </div>
                        <UFormField
                            label="Rate-limit propio"
                            name="rate_limit_override"
                            help="Cadena Mikrotik-Rate-Limit completa; vacía = la calculada."
                        >
                            <UInput
                                v-model="estado.rate_limit_override"
                                placeholder="5M/20M 0/0 0/0 0/0 8 5M/20M"
                                class="w-full font-mono"
                            />
                        </UFormField>
                    </section>
                    <ProblemaAlerta
                        v-if="problemaGuardar"
                        :problema="problemaGuardar"
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
                        form="form-plan-router"
                        label="Guardar"
                        icon="i-lucide-save"
                        :loading="enviando"
                        data-prueba="plan-router-guardar"
                    />
                </div>
            </template>
        </USlideover>

        <EstrategiaPlanModal
            v-if="seleccionada && puede('routers.cambiar_control_velocidad') && puede('routers.ver')"
            v-model:open="estrategiaAbierta"
            :plan="plan"
            :router-id="seleccionada.router_id"
            :implementacion="seleccionada"
            @guardado="cargar"
        />
        <SincronizarPlanModal
            v-if="seleccionada && puede('planes.sincronizar')"
            v-model:open="sincronizarAbierto"
            :plan="plan"
            :router-id="seleccionada.router_id"
            :nombre-router="nombreRouter(seleccionada.router_id)"
        />
    </UPageCard>
</template>
