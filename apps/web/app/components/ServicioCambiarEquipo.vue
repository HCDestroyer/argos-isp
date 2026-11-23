<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * «Cambiar equipo» en un paso (decisión del PM, tablero OperServicioFicha): el que sale, el que
 * entra (por serie o MAC), el motivo y a dónde va el que sale (funciona, revisión o garantía; nunca
 * a baja: el técnico no decide pérdidas). `POST /servicios/:id/equipos/cambiar`
 * (`servicios.cambiar_equipo`) con `Idempotency-Key`; con dañado o garantía, «funciona» no vale
 * (la API responde 422 y aquí ni se ofrece). Panel lateral: son 5 datos.
 */
const props = defineProps<{
    servicioId: number
    equipos: EquipoServicio[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [cambio: CambioEquipo]
}>()

const toast = useToast()

const MOTIVOS = [
    { label: 'Dañado', value: 'danado' },
    { label: 'Actualización', value: 'actualizacion' },
    { label: 'Garantía', value: 'garantia' },
    { label: 'Otro', value: 'otro' },
] as const
const DESTINOS = [
    { label: 'Funciona: vuelve disponible', value: 'funciona' },
    { label: 'A revisión', value: 'revision' },
    { label: 'Dañado (a revisión)', value: 'danado' },
    { label: 'A garantía', value: 'garantia' },
] as const

/** Espejo de `cambiarEquipoValidator` en lo que se pide desde el panel. */
const esquema = z.object({
    sale: z.number({ message: 'Elige el equipo que sale' }).int().min(1, 'Elige el equipo que sale'),
    entra: z.string().trim().min(1, 'Escribe la serie o la MAC del equipo que entra').max(100, 'Máximo 100 caracteres'),
    motivo: z.enum(['danado', 'actualizacion', 'garantia', 'otro']),
    destino_sale: z.enum(['funciona', 'revision', 'garantia', 'danado']),
    nota: z.string().trim().max(500, 'Máximo 500 caracteres'),
}).superRefine((datos, ctx) => {
    if (datos.destino_sale === 'funciona' && (datos.motivo === 'danado' || datos.motivo === 'garantia')) {
        ctx.addIssue({ code: 'custom', path: ['destino_sale'], message: 'Un equipo dañado o en garantía no vuelve como «funciona»' })
    }
})
type Entrada = z.input<typeof esquema>

const estado = reactive<Entrada>({ sale: 0, entra: '', motivo: 'danado', destino_sale: 'revision', nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { sale: props.equipos[0]?.id ?? 0, entra: '', motivo: 'danado', destino_sale: 'revision', nota: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

const itemsSale = computed(() => props.equipos.map(e => ({ label: `${e.producto_nombre} · ${e.serie ?? e.mac ?? `#${e.id}`}`, value: e.id })))
const destinos = computed(() => DESTINOS.filter(d => !(d.value === 'funciona' && (estado.motivo === 'danado' || estado.motivo === 'garantia'))))
watch(() => estado.motivo, () => {
    if (!destinos.value.some(d => d.value === estado.destino_sale)) {
        estado.destino_sale = 'revision'
    }
})

const PATRON_MAC_LIBRE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const esMac = PATRON_MAC_LIBRE.test(d.entra)
    const resultado = await useEquiposServicio().cambiar(props.servicioId, {
        sale: { unidad_id: d.sale },
        entra: esMac ? { mac: d.entra } : { serie: d.entra },
        motivo: d.motivo,
        destino_sale: d.destino_sale,
        nota: d.nota || null,
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    toast.add({ title: 'Equipo cambiado', description: 'El que salió quedó en la bodega con el destino elegido.', icon: 'i-lucide-arrow-left-right', color: 'success' })
    emit('hecho', resultado.data)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Cambiar equipo"
        description="Sale uno y entra otro en un solo paso. El que sale nunca se da de baja aquí."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-cambiar-equipo"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Sale"
                    name="sale"
                    required
                >
                    <USelect
                        v-model="estado.sale"
                        :items="itemsSale"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Entra (serie o MAC)"
                    name="entra"
                    required
                    help="Debe estar disponible en la bodega del técnico o de su cuadrilla."
                >
                    <UInput
                        v-model="estado.entra"
                        placeholder="ZTEGC8A1B2C3 o 4C:5E:0C:11:A2:B4"
                        class="w-full font-mono"
                        autocomplete="off"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <USelect
                        v-model="estado.motivo"
                        :items="[...MOTIVOS]"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="El que sale va a"
                    name="destino_sale"
                    required
                >
                    <USelect
                        v-model="estado.destino_sale"
                        :items="destinos"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Nota (opcional)"
                    name="nota"
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
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
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-cambiar-equipo"
                    label="Cambiar equipo"
                    icon="i-lucide-arrow-left-right"
                    :loading="enviando"
                    data-prueba="confirmar-cambiar-equipo"
                />
            </div>
        </template>
    </USlideover>
</template>
