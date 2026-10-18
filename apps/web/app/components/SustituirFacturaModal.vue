<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Sustituir una factura mal emitida (`POST /facturas/:id/sustituir`, `facturas.sustituir`;
 * contrato §10.9 y §17): la API anula la original (sin DTE certificado) o la acredita con una
 * NCRE por todo su saldo (con DTE), y emite una nueva del mismo periodo con el receptor
 * corregido. Los datos del cliente se corrigen aparte (ficha del cliente).
 */
const props = defineProps<{
    factura: Factura
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [sustitucion: SustitucionFactura]
}>()

type TipoDocumento = NonNullable<DatosSustituir['cliente_fiscal']>['tipo_documento_fiscal']
const TIPOS: readonly TipoDocumento[] = ['nit', 'cui', 'pasaporte', 'cf']

/** Espejo de `sustituirFacturaValidator` (A3): motivo 3–500; receptor opcional con sus largos. */
const esquema = z.object({
    motivo: z.string().trim().min(3, 'Escribe el motivo (al menos 3 caracteres)').max(500, 'Máximo 500 caracteres'),
    corregir: z.boolean(),
    tipo_documento_fiscal: z.enum(TIPOS),
    nit_cui: z.string().trim().max(20, 'Máximo 20 caracteres'),
    nombre_fiscal: z.string().trim().max(200, 'Máximo 200 caracteres'),
    direccion_fiscal: z.string().trim().max(300, 'Máximo 300 caracteres'),
}).refine(datos => !datos.corregir || datos.tipo_documento_fiscal === 'cf' || datos.nit_cui.length > 0, {
    message: 'Escribe el NIT, CUI o pasaporte del receptor',
    path: ['nit_cui'],
})
type Datos = z.output<typeof esquema>

const itemsTipo: SelectItem[] = TIPOS.map(tipo => ({ label: TIPOS_RECEPTOR[tipo], value: tipo }))

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<Datos>({ motivo: '', corregir: true, tipo_documento_fiscal: 'nit', nit_cui: '', nombre_fiscal: '', direccion_fiscal: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const conNcre = computed(() => props.factura.fel_estado === 'certificado')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { motivo: '', corregir: true, tipo_documento_fiscal: 'nit', nit_cui: '', nombre_fiscal: '', direccion_fiscal: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

function textoONull(valor: string): string | null {
    return valor.trim() ? valor.trim() : null
}

async function enviar(evento: FormSubmitEvent<Datos>) {
    const datos = evento.data
    const cuerpo: DatosSustituir = { motivo: datos.motivo }
    if (datos.corregir) {
        cuerpo.cliente_fiscal = {
            tipo_documento_fiscal: datos.tipo_documento_fiscal,
            nit_cui: datos.tipo_documento_fiscal === 'cf' ? null : textoONull(datos.nit_cui),
            nombre_fiscal: textoONull(datos.nombre_fiscal),
            direccion_fiscal: textoONull(datos.direccion_fiscal),
        }
    }
    enviando.value = true
    problema.value = null
    const resultado = await useFacturas().sustituir(props.factura.id, cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.replace(/^cliente_fiscal\./, '') }))
    if (errores.some(e => e.name && e.name in estado)) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaFelLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Sustituir factura"
        :description="`Factura #${factura.id} · ${etiquetaPeriodo(factura.periodo)} · ${formatearQuetzales(factura.total)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    :color="conNcre ? 'warning' : 'neutral'"
                    variant="subtle"
                    :icon="conNcre ? 'i-lucide-file-minus' : 'i-lucide-ban'"
                    :title="conNcre ? 'Con DTE certificado: se acredita con NCRE' : 'Sin DTE certificado: se anula'"
                    :description="conNcre
                        ? 'La original queda acreditada por todo su saldo con una nota de crédito (NCRE en cola) y se emite una factura nueva del mismo periodo.'
                        : 'La original se anula (con su asiento de reverso) y se emite una factura nueva del mismo periodo, con las mismas líneas y vencimiento.'"
                    data-prueba="sustituir-efecto"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: se emitió con el NIT equivocado"
                        class="w-full"
                        data-prueba="sustituir-motivo"
                    />
                </UFormField>
                <UCheckbox
                    v-model="estado.corregir"
                    name="corregir"
                    label="Corregir el receptor de la factura nueva"
                    description="Solo cambia el documento nuevo. Los datos fiscales del cliente se corrigen en su ficha."
                />
                <div
                    v-if="estado.corregir"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Documento"
                        name="tipo_documento_fiscal"
                        required
                    >
                        <USelect
                            v-model="estado.tipo_documento_fiscal"
                            :items="itemsTipo"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.tipo_documento_fiscal !== 'cf'"
                        :label="TIPOS_RECEPTOR[estado.tipo_documento_fiscal]"
                        name="nit_cui"
                        required
                    >
                        <UInput
                            v-model="estado.nit_cui"
                            class="w-full"
                            autocomplete="off"
                            data-prueba="sustituir-nit"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre fiscal"
                        name="nombre_fiscal"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre_fiscal"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Dirección fiscal"
                        name="direccion_fiscal"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.direccion_fiscal"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="sustituir-error"
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
                    :form="idFormulario"
                    label="Sustituir factura"
                    icon="i-lucide-replace"
                    :loading="enviando"
                    data-prueba="sustituir-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
