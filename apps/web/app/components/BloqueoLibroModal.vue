<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Bloquear o desbloquear un tipo del libro de una empresa. Bloquear (`POST /libro/bloqueos`,
 * `libro.bloquear`) solo avanza, nunca al futuro ni antes del duro. Desbloquear
 * (`POST /libro/bloqueos/desbloquear`, `libro.desbloquear`) lleva global, ventas o compras a una fecha
 * anterior o a «sin bloqueo»; impuestos y el duro no retroceden. Siempre con motivo. Las reglas se
 * revisan aquí con los vigentes de la empresa y la API responde igual (422/409) si cambiaron.
 */
const props = defineProps<{
    modo: 'bloquear' | 'desbloquear'
    empresaId: number
    /** Nombre de la empresa (consolidado). */
    empresa?: string | null
    vigentes: BloqueosEmpresa['vigentes']
    tipoInicial: TipoBloqueoNormal
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [bloqueo: BloqueoLibro] }>()

const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

interface Entrada {
    tipo: TipoBloqueoNormal
    hasta: string
    sin_bloqueo: boolean
    motivo: string
}

const estado = reactive<Entrada>({ tipo: 'global', hasta: '', sin_bloqueo: false, motivo: '' })
const hoy = hoyGuatemala()

const esquema = computed(() => (props.modo === 'bloquear' ? esquemaBloquear(props.vigentes, hoy) : esquemaDesbloquear(props.vigentes)))
const tipos = computed(() => (props.modo === 'bloquear' ? TIPOS_NORMALES : TIPOS_DESBLOQUEABLES).filter(t => props.modo === 'bloquear' || props.vigentes[t] !== null))
const itemsTipo = computed<SelectItem[]>(() => tipos.value.map(t => ({ label: TIPOS_BLOQUEO[t].etiqueta, value: t, description: props.vigentes[t] ? `Vigente hasta ${formatearFecha(props.vigentes[t] ?? '')}` : 'Sin bloqueo' })))
const vigente = computed(() => props.vigentes[estado.tipo])

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { tipo: tipos.value.includes(props.tipoInicial) ? props.tipoInicial : tipos.value[0] ?? 'global', hasta: '', sin_bloqueo: false, motivo: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

/** El formulario ya validó `estado` con el esquema del modo (bloquear o desbloquear). */
async function enviar() {
    enviando.value = true
    problema.value = null
    const d = { ...estado, motivo: estado.motivo.trim(), hasta: estado.hasta.trim() }
    const resultado = props.modo === 'bloquear'
        ? await useBloqueosLibro().bloquear({ empresa_id: props.empresaId, tipo: d.tipo, hasta: d.hasta, motivo: d.motivo }, clave)
        : await useBloqueosLibro().desbloquear({ empresa_id: props.empresaId, tipo: d.tipo === 'impuestos' ? 'global' : d.tipo, hasta: d.sin_bloqueo ? null : d.hasta, motivo: d.motivo }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'hasta' || e.name === 'motivo' || e.name === 'tipo')
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = problemaBloqueoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="modo === 'bloquear' ? 'Bloquear el libro' : 'Desbloquear el libro'"
        :description="empresa ?? undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-bloqueo-libro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Tipo"
                    name="tipo"
                    required
                    :help="TIPOS_BLOQUEO[estado.tipo].descripcion"
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        class="w-full"
                        data-prueba="bloqueo-tipo"
                    />
                </UFormField>
                <UFormField
                    v-if="modo === 'desbloquear'"
                    name="sin_bloqueo"
                >
                    <USwitch
                        v-model="estado.sin_bloqueo"
                        label="Quitar el bloqueo de este tipo"
                        description="Sin fecha: se puede registrar en cualquier fecha que no cubra otro bloqueo."
                        data-prueba="bloqueo-sin-bloqueo"
                    />
                </UFormField>
                <UFormField
                    v-if="modo === 'bloquear' || !estado.sin_bloqueo"
                    :label="modo === 'bloquear' ? 'Bloquear hasta' : 'Nuevo bloqueo hasta'"
                    name="hasta"
                    required
                    :help="modo === 'bloquear'
                        ? `Nada se registra con fecha hasta ese día. ${vigente ? `Vigente: ${formatearFecha(vigente)}.` : 'Sin bloqueo vigente.'}${vigentes.duro ? ` Duro: ${formatearFecha(vigentes.duro)}.` : ''}`
                        : `Anterior al vigente (${vigente ? formatearFecha(vigente) : '—'})${vigentes.duro ? ` y no antes del duro (${formatearFecha(vigentes.duro)})` : ''}.`"
                >
                    <UInput
                        v-model="estado.hasta"
                        type="date"
                        :max="modo === 'bloquear' ? hoy : (vigente ?? undefined)"
                        :min="vigentes.duro ?? undefined"
                        class="w-full"
                        data-prueba="bloqueo-hasta"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en el historial de bloqueos y en la bitácora."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="bloqueo-motivo"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="bloqueo-problema"
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
                    form="form-bloqueo-libro"
                    :label="modo === 'bloquear' ? 'Bloquear' : 'Desbloquear'"
                    :icon="modo === 'bloquear' ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                    :color="modo === 'bloquear' ? 'primary' : 'warning'"
                    :loading="enviando"
                    data-prueba="confirmar-bloqueo"
                />
            </div>
        </template>
    </UModal>
</template>
