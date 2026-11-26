<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectMenuItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Programar el envío de un reporte (`POST /reportes/envios`, `reportes.programar_envio`; tablero
 * ContaReporteVisor): cada cuánto, a quién y en qué formato. Se guardan los filtros del visor salvo
 * las fechas (`desde`, `hasta`, `corte`): cada envío calcula su periodo al enviarse, no el de hoy.
 * Solo reciben personas con permiso para ver el reporte y la empresa; a un correo externo solo va un
 * reporte contable compartible sin datos personales (422 `no_compartible` si los filtros lo impiden).
 */
const props = defineProps<{
    codigo: string
    titulo: string
    filtros: FiltrosReporte
    compartible: boolean
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [envio: EnvioReporte]
}>()

const usuario = useUsuarioActual()
const { puede } = usePermisos()
const { eleccion, empresas } = useEmpresaActiva()

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const esquema = z.object({
    nombre: z.string().trim().min(1, 'Ponle un nombre').max(120, 'Máximo 120 caracteres'),
    frecuencia: z.enum(['diaria', 'semanal', 'mensual']),
    dia: z.number().int().min(1).max(28),
    hora: z.number().int().min(0).max(23),
    formato: z.enum(['xlsx', 'pdf', 'csv']),
    usuarios: z.array(z.number()),
    correos: z.array(z.number()),
}).superRefine((datos, ctx) => {
    if (!datos.usuarios.length && !datos.correos.length) {
        ctx.addIssue({ code: 'custom', path: ['usuarios'], message: 'Elige al menos una persona o un correo' })
    }
})
type Entrada = z.output<typeof esquema>

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>({ nombre: '', frecuencia: 'semanal', dia: 1, hora: 7, formato: 'xlsx', usuarios: [], correos: [] })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const problemaLista = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const personas = shallowRef<UsuarioPanel[]>([])
const correosExternos = shallowRef<CorreoExternoListado[]>([])

const quien = computed(() => (eleccion.value === 'todas'
    ? 'Consolidado'
    : empresas.value.find(e => e.id === eleccion.value)?.nombre_comercial ?? ''))

const itemsFrecuencia = [
    { label: 'Cada día', value: 'diaria' },
    { label: 'Cada semana', value: 'semanal' },
    { label: 'Cada mes', value: 'mensual' },
]
const itemsHora = Array.from({ length: 24 }, (_, hora) => ({ label: `${hora}:00`, value: hora }))
const itemsDia = computed(() => (estado.frecuencia === 'semanal'
    ? DIAS.map((label, i) => ({ label, value: i + 1 }))
    : Array.from({ length: 28 }, (_, i) => ({ label: `Día ${i + 1}`, value: i + 1 }))))
const itemsFormato = Object.entries(FORMATO_ENVIO).map(([value, d]) => ({ label: d.etiqueta, value, icon: d.icono }))

const itemsPersonas = computed<SelectMenuItem[]>(() => {
    const lista = personas.value.filter(p => p.activo)
    // Sin `usuarios.ver` solo se puede enviar a uno mismo.
    const yo = usuario.value && !lista.some(p => p.id === usuario.value?.id) ? [{ label: `${usuario.value.nombre} (tú)`, value: usuario.value.id }] : []
    return [...yo, ...lista.map(p => ({ label: p.id === usuario.value?.id ? `${p.nombre} (tú)` : p.nombre, value: p.id, description: p.email }))]
})
const itemsCorreos = computed<SelectMenuItem[]>(() => correosExternos.value
    .filter(c => c.activo)
    .map(c => ({ label: c.nombre, value: c.id, description: c.correo })))

async function cargarDestinos() {
    problemaLista.value = null
    if (puede('usuarios.ver')) {
        const r = await useUsuarios().listar()
        personas.value = r.ok ? r.data.data : []
        problemaLista.value = r.ok ? null : r.problema
    }
    if (props.compartible) {
        const r = await useCorreosExternos().listar()
        correosExternos.value = r.ok ? r.data : []
        problemaLista.value = problemaLista.value ?? (r.ok ? null : r.problema)
    }
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, {
            nombre: [props.titulo, quien.value].filter(Boolean).join(' · '),
            frecuencia: 'semanal',
            dia: 1,
            hora: 7,
            formato: 'xlsx',
            usuarios: usuario.value ? [usuario.value.id] : [],
            correos: [],
        })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarDestinos()
    }
})

watch(() => estado.frecuencia, () => {
    estado.dia = 1
})

function filtrosSinFechas(): DatosEnvioReporte['filtros'] {
    const sin = new Set(['desde', 'hasta', 'corte'])
    return Object.fromEntries(Object.entries(props.filtros).filter((par): par is [string, string | number] => !sin.has(par[0]) && par[1] !== undefined && par[1] !== ''))
}

async function enviar(evento: FormSubmitEvent<Entrada>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const cuerpo: DatosEnvioReporte = {
        reporte: props.codigo,
        nombre: datos.nombre.trim(),
        filtros: filtrosSinFechas(),
        formato: datos.formato,
        frecuencia: datos.frecuencia,
        dia: datos.frecuencia === 'diaria' ? null : datos.dia,
        hora: datos.hora,
        destinatarios: { usuarios: datos.usuarios, correos_externos: datos.correos },
        ...(eleccion.value === 'todas' ? { consolidado: true } : {}),
    }
    const resultado = await useEnviosReportes().programar(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
        clave = nuevaClaveIdempotencia()
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'nombre')
    formulario.value?.setErrors(errores)
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Programar envío"
        :description="`${titulo}${quien ? ` · ${quien}` : ''}`"
        :dismissible="!enviando"
    >
        <template #title>
            <ModalTitulo
                texto="Programar envío"
                icono="i-lucide-send"
            />
        </template>
        <template #body>
            <UForm
                id="form-envio-reporte"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre del envío"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        class="w-full"
                        data-prueba="envio-nombre"
                    />
                </UFormField>
                <div class="grid grid-cols-3 gap-3">
                    <UFormField
                        label="Cada cuánto"
                        name="frecuencia"
                    >
                        <USelect
                            v-model="estado.frecuencia"
                            :items="itemsFrecuencia"
                            class="w-full"
                            data-prueba="envio-frecuencia"
                        />
                    </UFormField>
                    <UFormField
                        label="Día"
                        name="dia"
                    >
                        <USelect
                            v-model="estado.dia"
                            :items="itemsDia"
                            :disabled="estado.frecuencia === 'diaria'"
                            class="w-full"
                            data-prueba="envio-dia"
                        />
                    </UFormField>
                    <UFormField
                        label="Hora"
                        name="hora"
                        help="Guatemala"
                    >
                        <USelect
                            v-model="estado.hora"
                            :items="itemsHora"
                            class="w-full"
                            data-prueba="envio-hora"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Para quién"
                    name="usuarios"
                    required
                    help="Solo personas con permiso para ver este reporte y esta empresa."
                >
                    <USelectMenu
                        v-model="estado.usuarios"
                        :items="itemsPersonas"
                        value-key="value"
                        multiple
                        placeholder="Elige personas"
                        class="w-full"
                        data-prueba="envio-personas"
                    />
                </UFormField>
                <UFormField
                    v-if="compartible"
                    label="Correos externos aprobados"
                    name="correos"
                    :help="itemsCorreos.length ? 'Un contador o un socio de la lista que aprueba el administrador.' : 'No hay correos externos aprobados todavía.'"
                >
                    <USelectMenu
                        v-model="estado.correos"
                        :items="itemsCorreos"
                        value-key="value"
                        multiple
                        placeholder="Opcional"
                        class="w-full"
                        data-prueba="envio-correos"
                    />
                </UFormField>
                <UFormField
                    label="Formato"
                    name="formato"
                >
                    <USelect
                        v-model="estado.formato"
                        :items="itemsFormato"
                        class="w-full sm:w-48"
                        data-prueba="envio-formato"
                    />
                </UFormField>
                <p class="flex gap-2 text-xs text-muted">
                    <UIcon
                        name="i-lucide-calendar-clock"
                        class="mt-px size-3.5 shrink-0"
                    />
                    Se guardan los filtros de la pantalla, menos las fechas: cada envío usa el periodo del día en que se manda.
                </p>
                <ProblemaAlerta
                    v-if="problemaLista"
                    :problema="problemaLista"
                    :reintentar="cargarDestinos"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="envio-error"
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
                    form="form-envio-reporte"
                    label="Programar"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="envio-programar"
                />
            </div>
        </template>
    </UModal>
</template>
