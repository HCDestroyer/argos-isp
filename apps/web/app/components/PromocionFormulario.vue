<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Nueva promoción de velocidad en su página (tablero PendPromocionForm): 1 · Lo básico,
 * 2 · Velocidad (multiplicar su plan o pasar a otro plan), 3 · Cuándo (días completos o franja
 * diaria en hora de Guatemala, con los días de la semana), 4 · Precio (apagado = gratis) y
 * 5 · Servicios; a la derecha «Así queda» con el resumen y la semana. `POST /promociones-velocidad`
 * es todo o nada: un 422 de regla se muestra arriba («No se guardó nada») y marca el servicio que
 * falla en la lista; los 422 por campo van junto a cada campo.
 */
const props = withDefaults(defineProps<{
    /** Servicios elegidos de entrada (desde la ficha del servicio, «Nueva promoción»). */
    serviciosIniciales?: Servicio[]
}>(), {
    serviciosIniciales: () => [],
})

const emit = defineEmits<{
    guardada: [promocion: PromocionVelocidad]
    cancelar: []
}>()

const estado = reactive<EntradaPromocion>(promocionVacia())
const esquema = esquemaPromocion()
const elegidos = ref<Servicio[]>([...props.serviciosIniciales])
watch(() => props.serviciosIniciales, (lista) => {
    if (!elegidos.value.length) {
        elegidos.value = [...lista]
    }
})

const formulario = useTemplateRef<{ setErrors: (errores: { name?: string, message: string }[]) => void }>('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const falla = computed(() => (problema.value ? fallaPromocion(problema.value) : null))
const servicioConFalla = computed(() => (falla.value?.servicioId ? elegidos.value.find(s => s.id === falla.value?.servicioId) ?? null : null))
let claveIdempotencia = nuevaClaveIdempotencia()

// Cualquier cambio es otro intento lógico: otra clave.
watch([estado, elegidos], () => {
    claveIdempotencia = nuevaClaveIdempotencia()
}, { deep: true })

/* Planes para «Pasar a otro plan» (`planes.ver`). */
const planes = shallowRef<Plan[]>([])
const problemaPlanes = ref<Problem | null>(null)
const { puede } = usePermisos()
async function cargarPlanes() {
    if (!puede('planes.ver')) {
        return
    }
    const resultado = await leerTodas(cursor => usePlanes().listar({ activo: true, limit: 200 }, cursor))
    planes.value = resultado.ok ? resultado.data.filas : []
    problemaPlanes.value = resultado.ok ? null : resultado.problema
}
onMounted(cargarPlanes)

const itemsPlanes = computed<SelectItem[]>(() => planes.value.map(p => ({
    label: `${p.nombre} · ${formatearVelocidad(p.bajada_kbps)}/${formatearVelocidad(p.subida_kbps)}`,
    value: p.id,
})))
const planDestino = computed(() => planes.value.find(p => p.id === estado.plan_destino_id) ?? null)

function alternarDia(dia: number) {
    estado.dias_semana = estado.dias_semana.includes(dia) ? estado.dias_semana.filter(d => d !== dia) : [...estado.dias_semana, dia].sort((a, b) => a - b)
}

/* «Así queda». */
const resumen = computed(() => {
    const velocidad = estado.tipo_velocidad === 'multiplicador'
        ? `x${multiplicadorCorto(estado.multiplicador)} su plan`
        : planDestino.value ? `Pasa a ${planDestino.value.nombre}` : 'Elige el plan'
    const horario = estado.modo === 'franja'
        ? `${estado.franja_inicio || '—'}–${estado.franja_fin || '—'}${textoDiasSemana(estado.dias_semana) ? ` · ${textoDiasSemana(estado.dias_semana)}` : ''}`
        : 'Todo el día'
    const precio = estado.cobrar && /^\d{1,12}(\.\d{1,2})?$/.test(estado.precio.trim()) ? `${formatearQuetzales(estado.precio.trim())} /mes` : estado.cobrar ? 'Con precio' : 'Gratis'
    return { velocidad, horario, precio }
})
const semana = computed(() => semanaPromocion(estado))
const ejemplo = computed(() => elegidos.value[0] ?? null)

async function enviar(evento: FormSubmitEvent<EntradaPromocion>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePromocionesVelocidad().crear(datosPromocion(evento.data, elegidos.value.map(s => s.id)), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        emit('guardada', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (falla.value) {
        // `promocion_requiere_plan_destino` también marca el campo del plan destino.
        const enCampo = (resultado.problema.errors ?? []).filter(e => e.field === 'plan_destino_id')
        if (enCampo.length) {
            formulario.value?.setErrors(enCampo.map(e => ({ name: e.field, message: e.message })))
        }
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name !== 'servicio_ids')
    if (errores.length) {
        formulario.value?.setErrors(errores)
        problema.value = errores.some(e => !e.name || !(e.name in estado)) ? resultado.problema : null
    }
}

function quitarConFalla() {
    if (servicioConFalla.value) {
        const id = servicioConFalla.value.id
        elegidos.value = elegidos.value.filter(s => s.id !== id)
        problema.value = null
    }
}
</script>

<template>
    <div
        class="surface-card flex min-w-0 flex-col overflow-clip rounded-[1.375rem]"
        data-prueba="promocion-formulario"
    >
        <header class="flex items-center gap-3 border-b border-(--ax-borde) px-4 py-3 sm:px-5">
            <UButton
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                class="rounded-full"
                aria-label="Atrás"
                @click="emit('cancelar')"
            />
            <div class="flex min-w-0 flex-1 flex-col">
                <h1 class="truncate text-lg font-bold tracking-[-0.02em] text-highlighted">
                    Nueva promoción de velocidad
                </h1>
                <p class="truncate text-xs text-muted">
                    Se aplica por CoA, sin cortar la sesión · queda en la bitácora de cada servicio
                </p>
            </div>
            <AyudaBoton solo-icono />
        </header>

        <div class="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <UForm
                id="form-promocion"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="min-w-0"
                @submit="enviar"
            >
                <div
                    v-if="problema"
                    class="px-4 pt-4 sm:px-6"
                >
                    <UAlert
                        v-if="falla"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :title="falla.titulo"
                        :actions="servicioConFalla ? [{ label: 'Quitar de la lista', color: 'neutral', variant: 'outline', onClick: quitarConFalla }] : undefined"
                        data-prueba="falla-promocion"
                    >
                        <template #description>
                            <span class="block">{{ servicioConFalla ? `${servicioConFalla.codigo} · ${servicioConFalla.cliente_nombre}: ` : '' }}{{ falla.detalle }}</span>
                            <span class="block">No se guardó nada: la promoción se crea con todos sus servicios o con ninguno.</span>
                        </template>
                    </UAlert>
                    <ProblemaAlerta
                        v-else
                        :problema="problema"
                    />
                </div>

                <FormularioSeccion
                    titulo="1 · Lo básico"
                    descripcion="Cómo se llama y para qué es. Lo ve el personal, no el cliente."
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Nombre"
                            name="nombre"
                            required
                        >
                            <UInput
                                v-model="estado.nombre"
                                placeholder="Gamer nocturno"
                                class="w-full"
                                data-prueba="promocion-nombre"
                            />
                        </UFormField>
                        <UFormField
                            label="Descripción"
                            name="descripcion"
                        >
                            <UInput
                                v-model="estado.descripcion"
                                placeholder="Ej.: para los que juegan en línea de noche"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="2 · Velocidad"
                    descripcion="Cuánto sube mientras dura."
                >
                    <div class="flex flex-col gap-4">
                        <UTabs
                            v-model="estado.tipo_velocidad"
                            :items="[{ label: 'Multiplicar su plan', value: 'multiplicador', icon: 'i-lucide-zap' }, { label: 'Pasar a otro plan', value: 'plan_destino', icon: 'i-lucide-gauge' }]"
                            variant="pill"
                            color="neutral"
                            :content="false"
                            aria-label="Cómo sube la velocidad"
                            class="w-fit max-w-full"
                            :ui="{
                                list: 'rounded-xl bg-(--ax-panel) p-1',
                                indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                                trigger: 'rounded-lg px-3 text-muted data-[state=active]:text-primary',
                            }"
                            data-prueba="promocion-tipo-velocidad"
                        />
                        <div
                            v-if="estado.tipo_velocidad === 'multiplicador'"
                            class="grid items-start gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]"
                        >
                            <UFormField
                                label="Multiplicador"
                                name="multiplicador"
                                required
                                help="De x1.01 a x10, sobre el plan de cada servicio"
                            >
                                <UInputNumber
                                    v-model="estado.multiplicador"
                                    :min="1.01"
                                    :max="10"
                                    :step="0.5"
                                    :step-snapping="false"
                                    :format-options="{ maximumFractionDigits: 2, useGrouping: false }"
                                    size="xl"
                                    class="w-full"
                                    :ui="{ base: 'text-xl font-semibold text-center' }"
                                    aria-label="Multiplicador"
                                    data-prueba="promocion-multiplicador"
                                />
                            </UFormField>
                            <UAlert
                                color="warning"
                                variant="subtle"
                                icon="i-lucide-triangle-alert"
                                description="En routers que controlan la velocidad por plan (PCQ o árbol) no se puede multiplicar: ahí hace falta un plan destino."
                            />
                        </div>
                        <div
                            v-else
                            class="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                        >
                            <UFormField
                                label="Plan destino"
                                name="plan_destino_id"
                                required
                                help="Debe estar en el router del servicio y tener la misma IPv6"
                            >
                                <USelectMenu
                                    v-model="estado.plan_destino_id"
                                    :items="itemsPlanes"
                                    value-key="value"
                                    placeholder="Elige el plan"
                                    class="w-full"
                                    data-prueba="promocion-plan-destino"
                                />
                                <ProblemaAlerta
                                    v-if="problemaPlanes"
                                    :problema="problemaPlanes"
                                    :reintentar="cargarPlanes"
                                    class="mt-2"
                                />
                            </UFormField>
                            <UAlert
                                color="primary"
                                variant="subtle"
                                icon="i-lucide-info"
                                :description="`Mientras dura, el servicio pasa a ${planDestino?.nombre ?? 'ese plan'} y regresa solo a su plan. La factura sigue con su plan de siempre.`"
                            />
                        </div>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="3 · Cuándo"
                    descripcion="Días completos o unas horas cada día, en hora de Guatemala."
                >
                    <div class="flex flex-col gap-4">
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                label="Empieza"
                                name="inicio"
                                required
                            >
                                <UInput
                                    v-model="estado.inicio"
                                    type="datetime-local"
                                    icon="i-lucide-calendar"
                                    class="w-full"
                                    data-prueba="promocion-inicio"
                                />
                            </UFormField>
                            <UFormField
                                label="Termina"
                                name="fin"
                                required
                            >
                                <UInput
                                    v-model="estado.fin"
                                    type="datetime-local"
                                    icon="i-lucide-calendar"
                                    class="w-full"
                                    data-prueba="promocion-fin"
                                />
                            </UFormField>
                        </div>
                        <UTabs
                            v-model="estado.modo"
                            :items="[{ label: 'Días completos', value: 'dias', icon: 'i-lucide-calendar' }, { label: 'Franja diaria', value: 'franja', icon: 'i-lucide-clock' }]"
                            variant="pill"
                            color="neutral"
                            :content="false"
                            aria-label="Cuándo sube la velocidad"
                            class="w-fit max-w-full"
                            :ui="{
                                list: 'rounded-xl bg-(--ax-panel) p-1',
                                indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                                trigger: 'rounded-lg px-3 text-muted data-[state=active]:text-primary',
                            }"
                            data-prueba="promocion-modo"
                        />
                        <template v-if="estado.modo === 'franja'">
                            <div class="flex flex-wrap items-end gap-4">
                                <UFormField
                                    label="Desde"
                                    name="franja_inicio"
                                    required
                                >
                                    <UInput
                                        v-model="estado.franja_inicio"
                                        type="time"
                                        icon="i-lucide-clock"
                                        class="w-36"
                                        data-prueba="promocion-franja-inicio"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Hasta"
                                    name="franja_fin"
                                    required
                                >
                                    <UInput
                                        v-model="estado.franja_fin"
                                        type="time"
                                        icon="i-lucide-clock"
                                        class="w-36"
                                        data-prueba="promocion-franja-fin"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Días"
                                    name="dias_semana"
                                >
                                    <div
                                        class="flex flex-wrap gap-1.5"
                                        role="group"
                                        aria-label="Días de la semana"
                                    >
                                        <UButton
                                            v-for="(letra, indice) in LETRAS_DIAS"
                                            :key="indice"
                                            :label="letra"
                                            :aria-label="NOMBRES_DIAS[indice]"
                                            :aria-pressed="estado.dias_semana.includes(indice + 1)"
                                            :color="estado.dias_semana.includes(indice + 1) ? 'primary' : 'neutral'"
                                            :variant="estado.dias_semana.includes(indice + 1) ? 'solid' : 'outline'"
                                            class="size-9 justify-center rounded-full"
                                            @click="alternarDia(indice + 1)"
                                        />
                                    </div>
                                </UFormField>
                            </div>
                            <p class="text-xs text-muted">
                                Si «hasta» es más temprano que «desde» (22:00 a 02:00), termina al día siguiente. Sin días marcados, todos los días.
                            </p>
                        </template>
                        <p
                            v-else
                            class="text-xs text-muted"
                        >
                            Sube al empezar y baja al terminar, de forma continua.
                        </p>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="4 · Precio"
                    descripcion="Sin precio es gratis: la factura no cambia."
                >
                    <div class="flex flex-col gap-4">
                        <USwitch
                            v-model="estado.cobrar"
                            label="Cobrar la promoción"
                            description="Apagado = gratis"
                            size="lg"
                            data-prueba="promocion-cobrar"
                        />
                        <div
                            v-if="estado.cobrar"
                            class="grid items-start gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]"
                        >
                            <UFormField
                                label="Precio mensual con la promoción"
                                name="precio"
                                required
                            >
                                <UInput
                                    v-model="estado.precio"
                                    inputmode="decimal"
                                    placeholder="400.00"
                                    class="w-full"
                                    data-prueba="promocion-precio"
                                >
                                    <template #leading>
                                        <span class="text-sm text-muted">Q</span>
                                    </template>
                                </UInput>
                            </UFormField>
                            <UAlert
                                color="primary"
                                variant="subtle"
                                icon="i-lucide-info"
                                description="Se cobra la diferencia con el precio de su plan, proporcional a los días que tuvo la promoción, en una línea aparte de la factura. Si su plan ya cuesta más, no se cobra nada."
                            />
                        </div>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="5 · Servicios"
                    descripcion="A quién se le da. También se pueden agregar después."
                >
                    <PromocionServiciosElegir
                        v-model="elegidos"
                        :falla="falla && falla.servicioId !== null ? { servicioId: falla.servicioId, titulo: falla.titulo, ayuda: falla.ayuda } : null"
                    />
                </FormularioSeccion>
            </UForm>

            <aside
                class="flex flex-col gap-3 border-t border-(--ax-borde) bg-(--ax-fondo)/40 p-4 sm:p-5 xl:border-t-0 xl:border-s"
                aria-label="Así queda"
                data-prueba="promocion-asi-queda"
            >
                <h2 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                    Así queda
                </h2>
                <div class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4">
                    <div class="flex items-center justify-between gap-2 pb-1">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                <UIcon
                                    name="i-lucide-zap"
                                    class="size-4"
                                />
                            </span>
                            <span class="truncate font-semibold text-highlighted">{{ estado.nombre || 'Promoción nueva' }}</span>
                        </span>
                        <UBadge
                            :label="resumen.precio"
                            :color="estado.cobrar ? 'primary' : 'success'"
                            variant="subtle"
                            class="shrink-0 rounded-full"
                            data-prueba="asi-queda-precio"
                        />
                    </div>
                    <dl>
                        <RedFila
                            etiqueta="Velocidad"
                            :valor="resumen.velocidad"
                        />
                        <RedFila
                            etiqueta="Horario"
                            :valor="resumen.horario"
                        />
                        <RedFila
                            etiqueta="Servicios"
                            :valor="String(elegidos.length)"
                        />
                    </dl>
                </div>

                <div class="flex flex-col gap-2 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4">
                    <h3 class="text-sm font-semibold text-highlighted">
                        Una semana
                    </h3>
                    <div
                        class="flex flex-col gap-1.5"
                        role="img"
                        :aria-label="`Horas con la promoción cada día: ${resumen.horario}`"
                    >
                        <div
                            v-for="dia in semana"
                            :key="dia.dia"
                            class="flex items-center gap-2"
                        >
                            <span class="w-3 text-[0.6875rem] text-muted">{{ LETRAS_DIAS[dia.dia - 1] }}</span>
                            <span class="relative h-2 flex-1 overflow-hidden rounded-full bg-(--ax-panel)">
                                <span
                                    v-for="(tramo, i) in dia.tramos"
                                    :key="i"
                                    class="absolute inset-y-0 rounded-full bg-primary"
                                    :style="{ left: `${(tramo.desde / 24) * 100}%`, width: `${((tramo.hasta - tramo.desde) / 24) * 100}%` }"
                                />
                            </span>
                        </div>
                        <div class="flex justify-between ps-5 text-[0.6875rem] text-muted">
                            <span>0 h</span><span>12 h</span><span>24 h</span>
                        </div>
                    </div>
                </div>

                <div
                    v-if="ejemplo"
                    class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4 text-xs text-muted"
                >
                    <span class="text-sm font-semibold text-highlighted">{{ ejemplo.cliente_nombre }} · {{ ejemplo.plan_nombre }}</span>
                    <span>{{ estado.tipo_velocidad === 'multiplicador' ? `${resumen.velocidad} (${ejemplo.plan_nombre})` : resumen.velocidad }} · {{ resumen.horario === 'Todo el día' ? 'todo el día' : `de ${resumen.horario}` }}. Sin cortar su sesión.</span>
                </div>
            </aside>
        </div>

        <footer class="panel-barra-accion sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-(--ax-borde) bg-(--ax-tarjeta) px-4 py-3 max-lg:border-t-0 sm:px-5">
            <span class="hidden text-sm text-muted sm:block">Puedes crearla sin servicios y asignarlos después.</span>
            <span class="ms-auto flex flex-1 gap-2 sm:flex-none">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    class="rounded-full"
                    :disabled="enviando"
                    @click="emit('cancelar')"
                />
                <UButton
                    type="submit"
                    form="form-promocion"
                    :label="elegidos.length ? 'Crear y aplicar' : 'Crear promoción'"
                    :icon="ICONOS.guardar"
                    size="lg"
                    class="glow-brand flex-1 justify-center rounded-full sm:flex-none"
                    :loading="enviando"
                    data-prueba="guardar-promocion"
                />
            </span>
        </footer>
    </div>
</template>
