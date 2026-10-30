<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Alta de un router (`POST /routers`, `routers.crear`, A1): primero el modo de seguridad («RADIUS» o
 * «Sin RADIUS»), luego nombre, host de la API REST, IP del NAS y secreto RADIUS (solo con RADIUS),
 * credenciales de la API (se guardan cifrados; nunca vuelven) y colas. Sin RADIUS (`api`) la IP del
 * NAS y el secreto no se piden ni se mandan (`utils/modoSeguridad.ts`). La conexión fina (puerto, TLS, CA, DHCP) se ajusta después en «Conexión» y la capacidad en
 * «Velocidad»; el modo de colas después del alta solo cambia con su acción. Si ese MikroTik ya
 * está registrado (misma API o misma IP del NAS), la API responde 409 `router_duplicado`: se marca
 * el campo y se explica qué router es y qué hacer (`contratos/routers.md` §2).
 */
const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ creado: [router: RouterNas] }>()

/**
 * Espejo de `crearRouterValidator` (A1) en los campos de este formulario: la IP del NAS es
 * obligatoria solo con `radius`; con `api` no se valida ni se manda.
 */
const esquema = z.object({
    modo_seguridad: z.enum(['radius', 'api']),
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    host: z.string().trim().min(1, 'Escribe el host o la IP').max(255, 'Máximo 255 caracteres'),
    nas_ip: z.string().trim(),
    radius_secret: z.string().max(200, 'Máximo 200 caracteres'),
    api_usuario: z.string().trim().max(100, 'Máximo 100 caracteres'),
    api_password: z.string().max(200, 'Máximo 200 caracteres'),
    control_velocidad: z.enum(['simple', 'arbol_pcq']),
    activo: z.boolean(),
}).superRefine((datos, ctx) => {
    const error = errorNas(datos.modo_seguridad, datos.nas_ip)
    if (error) {
        ctx.addIssue({ code: 'custom', path: ['nas_ip'], message: error })
    }
})
type Entrada = z.input<typeof esquema>
const vacio = (): Entrada => ({ nombre: '', host: '', nas_ip: '', radius_secret: '', api_usuario: '', api_password: '', modo_seguridad: 'radius', control_velocidad: 'simple', activo: true })

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const duplicado = computed(() => esRouterDuplicado(problema.value))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
    }
})

const itemsSeguridad: RadioGroupItem[] = (['radius', 'api'] as const).map(modo => ({
    label: MODOS_SEGURIDAD[modo].opcion,
    value: modo,
    description: MODOS_SEGURIDAD[modo].descripcion,
}))
const conRadius = computed(() => estado.modo_seguridad === 'radius')
const itemsControl: SelectItem[] = (Object.keys(CONTROLES_VELOCIDAD) as ControlVelocidad[]).map(c => ({ label: CONTROLES_VELOCIDAD[c].etiqueta, value: c, icon: CONTROLES_VELOCIDAD[c].icono }))

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const radius = d.modo_seguridad === 'radius'
    const resultado = await useRouters().crear({
        nombre: d.nombre,
        host: d.host,
        // Sin RADIUS no se mandan: la API los deja en null (A1).
        ...(radius ? { nas_ip: d.nas_ip, radius_secret: d.radius_secret || null } : {}),
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
                    label="Modo de seguridad"
                    name="modo_seguridad"
                    required
                >
                    <URadioGroup
                        v-model="estado.modo_seguridad"
                        :items="itemsSeguridad"
                        variant="card"
                        class="w-full"
                        :ui="{ fieldset: 'grid gap-2' }"
                        data-prueba="router-modo"
                    />
                </UFormField>
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
                        :class="conRadius ? '' : 'sm:col-span-2'"
                    >
                        <UInput
                            v-model="estado.host"
                            placeholder="10.0.0.1"
                            class="w-full font-mono"
                            data-prueba="router-host"
                        />
                    </UFormField>
                    <UFormField
                        v-if="conRadius"
                        label="IP del NAS"
                        name="nas_ip"
                        required
                        help="La IP con la que el router habla con RADIUS."
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
                    v-if="conRadius"
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
                <UFormField
                    label="Colas"
                    name="control_velocidad"
                    help="Después del alta solo cambia con «Velocidad»."
                >
                    <USelect
                        v-model="estado.control_velocidad"
                        :items="itemsControl"
                        class="w-full sm:max-w-xs"
                    />
                </UFormField>
                <USwitch
                    v-model="estado.activo"
                    label="Activo"
                />
                <UAlert
                    v-if="problema && duplicado"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-copy"
                    title="Ese MikroTik ya está registrado"
                    data-prueba="router-duplicado"
                >
                    <template #description>
                        <div class="flex flex-col gap-1.5">
                            <p>{{ problema.detail }}</p>
                            <ul class="list-disc pl-5">
                                <li
                                    v-for="(error, indice) in problema.errors ?? []"
                                    :key="indice"
                                >
                                    {{ error.message }}
                                </li>
                            </ul>
                            <p>
                                Registrarlo otra vez haría que cada registro borre las colas del otro y que las sesiones RADIUS se atribuyan a uno solo. Usa el router existente; si ya hay dos registros, únelos desde Routers.
                            </p>
                        </div>
                    </template>
                </UAlert>
                <ProblemaAlerta
                    v-else-if="problema"
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
