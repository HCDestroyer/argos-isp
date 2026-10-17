<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * "Cambiar empresa" de un servicio (`POST /servicios/:id/cambiar-empresa`). Solo sin saldo pendiente:
 * con saldo la API responde 422 `servicio_con_saldo` y aquí se explica qué hacer (cobrar o anular),
 * con el enlace al cobro. Las facturas ya emitidas quedan con el NIT que las emitió.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [servicio: Servicio] }>()

const { empresas, nombre } = useEmpresaActiva()
const { puede, enlace } = usePermisos()

const esquema = z.object({
    empresa: z.string().min(1, 'Elige la empresa nueva'),
    motivo: z.string().trim().min(3, 'Escribe al menos 3 caracteres').max(500, 'Máximo 500 caracteres'),
})
type Datos = z.output<typeof esquema>

const idFormulario = useId()
const estado = reactive<{ empresa: string, motivo: string }>({ empresa: '', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const conSaldo = ref<string | null>(null)
let clave = nuevaClaveIdempotencia()

const items = computed(() => empresas.value
    .filter(e => e.id !== props.servicio.empresa_id)
    .map(e => ({ label: e.nombre_comercial, value: String(e.id), description: e.nit ? `NIT ${e.nit}` : undefined })))

watch(abierto, (valor) => {
    if (valor) {
        estado.empresa = items.value.length === 1 ? items.value[0]?.value ?? '' : ''
        estado.motivo = ''
        problema.value = null
        conSaldo.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<Datos>) {
    enviando.value = true
    problema.value = null
    conSaldo.value = null
    const resultado = await useServicios().cambiarEmpresa(props.servicio.id, {
        empresa_id: Number(evento.data.empresa),
        version: props.servicio.version,
        motivo: evento.data.motivo,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.type.endsWith(':servicio_con_saldo')) {
        conSaldo.value = resultado.problema.detail ?? 'El servicio tiene saldo pendiente.'
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Cambiar empresa del servicio"
        :description="`${etiquetaServicio(servicio)} · hoy factura ${nombre(servicio.empresa_id)}`"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <p class="text-sm text-muted">
                    Las facturas ya emitidas quedan con el NIT que las emitió; las siguientes salen con la empresa nueva.
                    Solo se puede si el servicio no debe nada.
                </p>

                <UAlert
                    v-if="conSaldo"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="Primero hay que dejar el servicio sin saldo"
                    :description="`${conSaldo}. Cobra o anula sus facturas pendientes y vuelve a intentarlo.`"
                    :actions="puede('pagos.registrar') ? [{ label: 'Ir a cobrar', color: 'warning', variant: 'outline', to: enlace(`/cobro?cliente=${servicio.cliente_id}`) }] : undefined"
                    data-prueba="servicio-con-saldo"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />

                <UFormField
                    name="empresa"
                    label="Empresa nueva"
                    required
                >
                    <USelect
                        v-model="estado.empresa"
                        :items="items"
                        placeholder="Elige la empresa"
                        class="w-full"
                        data-prueba="empresa-nueva"
                    />
                </UFormField>
                <UFormField
                    name="motivo"
                    label="Motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: el cliente pasó a la zona de Fibra del Sur"
                        class="w-full"
                    />
                </UFormField>
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Cambiar empresa"
                    icon="i-lucide-arrow-right-left"
                    :loading="enviando"
                    class="justify-center"
                    data-prueba="confirmar-cambiar-empresa"
                />
            </div>
        </template>
    </UModal>
</template>
