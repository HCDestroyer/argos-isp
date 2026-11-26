<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Registrar gestión de cobro (`POST /clientes/:id/gestiones-cobro`, `gestiones_cobro.registrar`):
 * una llamada, un mensaje, una visita o una carta, con su resultado y cuándo ocurrió (hasta 7 días
 * atrás). Es la evidencia que pide el castigo de cartera. Con varios clientes elegidos se registra
 * la misma gestión a cada uno (una llamada por cliente, cada una con su `Idempotency-Key`).
 */
const props = defineProps<{
    /** Clientes de la gestión (de la fila o de la selección). */
    clientes: { id: number, nombre: string }[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [registradas: GestionCobroRegistrada[]]
}>()

const hoy = hoyGuatemala()
const minimo = (() => {
    const fecha = new Date(`${hoy}T12:00:00-06:00`)
    fecha.setDate(fecha.getDate() - DIAS_VENTANA_GESTION)
    return fecha.toISOString().slice(0, 10)
})()

const esquema = z.object({
    tipo: z.enum(['llamada', 'mensaje', 'visita', 'promesa', 'carta']),
    resultado: z.enum(['contesto', 'no_contesto', 'numero_equivocado', 'promete_pagar', 'rechaza', 'pago_informado', 'visita_sin_contacto']),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige el día').refine(f => f >= minimo && f <= hoy, `Desde ${minimo} hasta hoy`),
    hora: z.string().regex(/^\d{2}:\d{2}$/, 'Escribe la hora'),
    nota: z.string().trim().max(280, 'Máximo 280 caracteres'),
})
type Entrada = z.output<typeof esquema>

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>({ tipo: 'llamada', resultado: 'contesto', fecha: hoy, hora: horaGuatemala(), nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const claves = new Map<number, string>()

const itemsTipo = Object.entries(TIPOS_GESTION).map(([value, d]) => ({ label: d.etiqueta, value, icon: d.icono }))
const itemsResultado = Object.entries(RESULTADOS_GESTION).map(([value, label]) => ({ label, value }))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { tipo: 'llamada', resultado: 'contesto', fecha: hoy, hora: horaGuatemala(), nota: '' })
        problema.value = null
        claves.clear()
    }
})

function claveDe(clienteId: number): string {
    let clave = claves.get(clienteId)
    if (!clave) {
        clave = nuevaClaveIdempotencia()
        claves.set(clienteId, clave)
    }
    return clave
}

async function enviar(evento: FormSubmitEvent<Entrada>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const cuerpo: DatosGestionCobro = {
        tipo: datos.tipo,
        resultado: datos.resultado,
        ocurrido_en: instanteGuatemala(`${datos.fecha}T${datos.hora}`) ?? new Date().toISOString(),
        origen_tipo: 'panel',
        nota: datos.nota ? datos.nota : null,
    }
    const hechas: GestionCobroRegistrada[] = []
    // Se corta en el primer error: las ya registradas no se repiten al reintentar (misma clave).
    for (const cliente of props.clientes) {
        const resultado = await useGestionesCobro().registrar(cliente.id, cuerpo, claveDe(cliente.id))
        if (!resultado.ok) {
            enviando.value = false
            const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name))
            formulario.value?.setErrors(errores)
            problema.value = props.clientes.length > 1
                ? { ...resultado.problema, title: `${cliente.nombre}: ${resultado.problema.title}` }
                : resultado.problema
            if (hechas.length) {
                emit('hecho', hechas)
            }
            return
        }
        hechas.push(resultado.data)
    }
    enviando.value = false
    abierto.value = false
    emit('hecho', hechas)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar gestión de cobro"
        :description="clientes.length === 1 ? clientes[0]!.nombre : `${clientes.length} clientes: se anota la misma gestión a cada uno`"
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                texto="Registrar gestión de cobro"
                icono="i-lucide-phone"
            />
        </template>
        <template #body>
            <UForm
                id="form-gestion-cobro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Cómo fue"
                        name="tipo"
                        required
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            class="w-full"
                            data-prueba="gestion-tipo"
                        />
                    </UFormField>
                    <UFormField
                        label="Qué pasó"
                        name="resultado"
                        required
                    >
                        <USelect
                            v-model="estado.resultado"
                            :items="itemsResultado"
                            class="w-full"
                            data-prueba="gestion-resultado"
                        />
                    </UFormField>
                    <UFormField
                        label="Día"
                        name="fecha"
                        required
                        help="Hasta 7 días atrás"
                    >
                        <CampoFecha
                            v-model="estado.fecha"
                            :min="minimo"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Hora"
                        name="hora"
                        required
                    >
                        <UInput
                            v-model="estado.hora"
                            type="time"
                            class="w-full"
                            data-prueba="gestion-hora"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Nota"
                    name="nota"
                    help="Opcional. Lo que se habló o se acordó (hasta 280 caracteres)."
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        placeholder="Dijo que paga el viernes en caja"
                        class="w-full"
                        data-prueba="gestion-nota"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="gestion-error"
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
                    form="form-gestion-cobro"
                    label="Registrar gestión"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="gestion-registrar"
                />
            </div>
        </template>
    </UModal>
</template>
