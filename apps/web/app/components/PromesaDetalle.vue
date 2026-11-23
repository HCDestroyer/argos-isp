<script setup lang="ts">
/**
 * La promesa abierta a la derecha de `/promesas` (tablero OperPromesas) y a pantalla completa en el
 * teléfono: lo que cubre, tipo, quién la pidió, vencimiento, qué facturas cubre, la regla que
 * aplicó (`resultado_evaluacion`) y sus acciones al pie. Aprobar y rechazar las pendientes se
 * confirman en una ventana (decisión 9: también desde el teléfono).
 */
const props = withDefaults(defineProps<{
    promesa: Promesa
    nombreCliente: string
    /** En el panel del teléfono el título ya lo pone el panel. */
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{
    aprobar: [promesa: Promesa]
    cerrar: [promesa: Promesa, accion: 'rechazar' | 'cancelar']
}>()

const { puede } = usePermisos()

const pendiente = computed(() => props.promesa.estado === 'pendiente_aprobacion')
const puedeCancelar = computed(() => puede('promesas.cancelar') && (props.promesa.estado === 'activa' || pendiente.value))
</script>

<template>
    <OperPanelLateral
        :titulo="sinEncabezado ? undefined : `Servicio ${promesa.servicio_id}`"
        :subtitulo="nombreCliente"
        :icono="promesa.tipo === 'reconexion_temporal' ? 'i-lucide-power' : 'i-lucide-hand'"
        titulo-mono
        data-prueba="detalle-promesa"
    >
        <template #insignia>
            <UBadge
                :label="ESTADOS_PROMESA[promesa.estado].etiqueta"
                :icon="ESTADOS_PROMESA[promesa.estado].icono"
                :color="ESTADOS_PROMESA[promesa.estado].color"
                variant="subtle"
            />
        </template>

        <div class="flex items-baseline gap-2">
            <span class="text-[1.75rem] font-bold tabular-nums text-highlighted">{{ formatearQuetzales(promesa.monto) }}</span>
            <span class="text-[0.8125rem] text-muted">todo lo vencido del servicio</span>
        </div>

        <dl class="flex flex-col divide-y divide-(--ax-borde) text-sm">
            <div class="flex items-center justify-between gap-3 py-2">
                <dt class="text-muted">
                    Tipo
                </dt>
                <dd>
                    <span
                        class="pastilla-tono rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        :class="promesa.tipo === 'reconexion_temporal' ? 'tono-2' : 'tono-marca'"
                    >{{ TIPOS_PROMESA[promesa.tipo ?? 'promesa'].etiqueta }}</span>
                </dd>
            </div>
            <div class="flex justify-between gap-3 py-2">
                <dt class="text-muted">
                    La pidió por
                </dt>
                <dd class="text-end font-semibold text-highlighted">
                    {{ CANALES_PROMESA[promesa.canal] }}
                </dd>
            </div>
            <div
                v-if="promesa.motivo_reconexion"
                class="flex justify-between gap-3 py-2"
            >
                <dt class="text-muted">
                    Motivo
                </dt>
                <dd class="text-end text-highlighted">
                    {{ etiquetaMotivoReconexion(promesa) }}
                </dd>
            </div>
            <div class="flex justify-between gap-3 py-2">
                <dt class="text-muted">
                    Vence
                </dt>
                <dd class="text-end font-semibold text-highlighted">
                    {{ formatearFechaHora(promesa.vence_en) }}
                </dd>
            </div>
            <div class="flex justify-between gap-3 py-2">
                <dt class="text-muted">
                    Creada
                </dt>
                <dd class="text-end text-highlighted">
                    {{ formatearFechaHora(promesa.created_at) }}
                </dd>
            </div>
            <div
                v-if="promesa.comprobante_id"
                class="flex justify-between gap-3 py-2"
            >
                <dt class="text-muted">
                    Comprobante
                </dt>
                <dd class="text-end">
                    <ULink
                        v-if="puede('comprobantes.ver')"
                        :to="`/comprobantes/${promesa.comprobante_id}`"
                        class="text-primary"
                    >
                        #{{ promesa.comprobante_id }}
                    </ULink>
                    <template v-else>
                        #{{ promesa.comprobante_id }}
                    </template>
                </dd>
            </div>
        </dl>

        <section class="flex flex-col gap-1.5">
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Qué cubre
            </h3>
            <PromesaCumplimiento :promesa="promesa" />
        </section>

        <section class="flex flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <h3 class="flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-primary uppercase">
                <UIcon
                    name="i-lucide-info"
                    class="size-3.5"
                />
                La regla que aplicó
            </h3>
            <EvaluacionPromesa :promesa="promesa" />
        </section>

        <p class="text-[0.8125rem] text-muted">
            Si paga antes de que venza se marca <strong class="text-highlighted">cumplida</strong> sola. Si no, se marca
            <strong class="text-highlighted">incumplida</strong> y el servicio se corta a la hora de corte de su plantilla.
        </p>

        <template #pie>
            <UButton
                v-if="puede('servicios.ver')"
                :to="`/servicios/${promesa.servicio_id}`"
                label="Abrir servicio"
                :icon="ICONOS.abrir"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center"
            />
            <UButton
                v-if="pendiente && puede('promesas.rechazar')"
                label="Rechazar"
                icon="i-lucide-x"
                color="error"
                variant="outline"
                class="flex-1 justify-center"
                @click="emit('cerrar', promesa, 'rechazar')"
            />
            <UButton
                v-if="pendiente && puede('promesas.aprobar')"
                label="Aprobar"
                icon="i-lucide-check"
                color="success"
                class="flex-1 justify-center"
                data-prueba="aprobar-promesa"
                @click="emit('aprobar', promesa)"
            />
            <UButton
                v-else-if="puedeCancelar"
                label="Cancelar promesa"
                icon="i-lucide-circle-slash"
                color="error"
                variant="outline"
                class="flex-1 justify-center"
                @click="emit('cerrar', promesa, 'cancelar')"
            />
        </template>
    </OperPanelLateral>
</template>
