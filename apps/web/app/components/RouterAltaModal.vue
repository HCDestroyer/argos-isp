<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Alta de un router (`POST /routers`, `routers.crear`, A1): nombre, host de la API REST, IP del NAS,
 * secreto RADIUS y credenciales de la API (se guardan cifrados; nunca vuelven), modo de seguridad y
 * colas. La conexión fina (puerto, TLS, CA, DHCP) se ajusta después en «Conexión» y la capacidad en
 * «Velocidad»; el modo de colas después del alta solo cambia con su acción.
 */
const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ creado: [router: RouterNas] }>()

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** Espejo de `crearRouterValidator` (A1) en los campos de este formulario. */
const esquema = z.object({
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    host: z.string().trim().min(1, 'Escribe el host o la IP').max(255, 'Máximo 255 caracteres'),
    nas_ip: z.string().trim().regex(IPV4, 'Escribe la IPv4 con la que el router habla con RADIUS'),
    radius_secret: z.string().max(200, 'Máximo 200 caracteres'),
    api_usuario: z.string().trim().max(100, 'Máximo 100 caracteres'),
    api_password: z.string().max(200, 'Máximo 200 caracteres'),
    modo_seguridad: z.enum(['radius', 'api']),
    control_velocidad: z.enum(['simple', 'arbol_pcq']),
    activo: z.boolean(),
})
type Entrada = z.input<typeof esquema>
const vacio = (): Entrada => ({ nombre: '', host: '', nas_ip: '', radius_secret: '', api_usuario: '', api_password: '', modo_seguridad: 'radius', control_velocidad: 'simple', activo: true })

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
    }
})

const itemsSeguridad: SelectItem[] = [
    { label: 'RADIUS', value: 'radius', description: 'Recomendado: el router autentica y corta por RADIUS' },
    { label: 'API de RouterOS', value: 'api' },
]
const itemsControl: SelectItem[] = (Object.keys(CONTROLES_VELOCIDAD) as ControlVelocidad[]).map(c => ({ label: CONTROLES_VELOCIDAD[c].etiqueta, value: c, icon: CONTROLES_VELOCIDAD[c].icono }))

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = await useRouters().crear({
        nombre: d.nombre,
        host: d.host,
        nas_ip: d.nas_ip,
        radius_secret: d.radius_secret || null,
        api_usuario: d.api_usuario || null,
        api_password: d.api_password || null,
        modo_seguridad: d.modo_seguridad,
        control_velocidad: d.control_velocidad,
        activo: d.activo,
    })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('creado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Nuevo router"
        description="Los secretos se guardan cifrados y no se vuelven a mostrar."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-router"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        placeholder="Nodo Centro"
                        class="w-full"
                        data-prueba="router-nombre"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Host de la API"
                        name="host"
                        required
                    >
                        <UInput
                            v-model="estado.host"
                            placeholder="10.0.0.1"
                            class="w-full font-mono"
                            data-prueba="router-host"
                        />
                    </UFormField>
                    <UFormField
                        label="IP del NAS"
                        name="nas_ip"
                        required
                    >
                        <UInput
                            v-model="estado.nas_ip"
                            placeholder="10.0.0.1"
                            class="w-full font-mono"
                            data-prueba="router-nas"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Secreto RADIUS"
                    name="radius_secret"
                >
                    <UInput
                        v-model="estado.radius_secret"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Usuario de la API"
                        name="api_usuario"
                    >
                        <UInput
                            v-model="estado.api_usuario"
                            autocomplete="off"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Contraseña de la API"
                        name="api_password"
                    >
                        <UInput
                            v-model="estado.api_password"
                            type="password"
                            autocomplete="new-password"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Seguridad"
                        name="modo_seguridad"
                    >
                        <USelect
                            v-model="estado.modo_seguridad"
                            :items="itemsSeguridad"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Colas"
                        name="control_velocidad"
                        help="Después del alta solo cambia con «Velocidad»."
                    >
                        <USelect
                            v-model="estado.control_velocidad"
                            :items="itemsControl"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <USwitch
                    v-model="estado.activo"
                    label="Activo"
                />
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
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-router"
                    label="Crear router"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="router-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
