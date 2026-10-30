<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * «Script de conexión» (`GET /routers/:id/script-conexion`, `routers.generar_script`) o «Rotar
 * conexión» (`POST /routers/:id/conexion/rotar`, `routers.rotar_conexion`, con confirmación): pide
 * las IPs de administración y si incluir la configuración de servicio, genera el `.rsc` y deja
 * descargarlo o copiarlo, con los pasos para el técnico (`infra/mikrotik/README.md`, «Conectar un
 * router»). El script lleva claves: vive solo en memoria mientras el modal está abierto.
 */
const props = withDefaults(defineProps<{
    router: RouterNas
    modo?: 'generar' | 'rotar'
}>(), {
    modo: 'generar',
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    generado: []
}>()

const toast = useToast()

const IP_O_RED = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\/([0-9]|[12][0-9]|3[0-2]))?$/

/** Espejo de `scriptConexionValidator`: IPs o redes IPv4 separadas por coma, hasta 2000 caracteres. */
const esquema = z.object({
    admin: z.string().trim().max(2000, 'Acorta la lista: máximo 2000 caracteres').refine(
        valor => valor === '' || valor.split(',').every(parte => IP_O_RED.test(parte.trim())),
        'Escribe IPv4 o redes separadas por coma, como 190.56.10.20, 10.0.0.0/24; o déjalo vacío',
    ),
    incluir_servicio: z.boolean(),
})
type Entrada = z.input<typeof esquema>

const estado = reactive<Entrada>({ admin: '', incluir_servicio: false })
const generando = ref(false)
const problema = ref<Problem | null>(null)
/** El `.rsc`: solo en memoria, se borra al cerrar. */
const script = ref<string | null>(null)
const rotar = computed(() => props.modo === 'rotar')

watch(abierto, (valor) => {
    // Al abrir y al cerrar: nada del script anterior queda en pantalla ni en memoria.
    script.value = null
    problema.value = null
    if (valor) {
        Object.assign(estado, { admin: '', incluir_servicio: false })
    }
})

const NOMBRE_ARCHIVO = 'argosisp-conexion.rsc'

async function generar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    generando.value = true
    problema.value = null
    const opciones = {
        ...(evento.data.admin ? { admin: evento.data.admin.split(',').map(p => p.trim()).join(',') } : {}),
        ...(evento.data.incluir_servicio ? { incluir: 'servicio' as const } : {}),
    }
    const resultado = rotar.value
        ? await useRouters().rotarConexion(props.router.id, opciones)
        : await useRouters().scriptConexion(props.router.id, opciones)
    generando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    script.value = resultado.data
    emit('generado')
}

function descargar() {
    if (!script.value) {
        return
    }
    const url = URL.createObjectURL(new Blob([script.value], { type: 'text/plain' }))
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = NOMBRE_ARCHIVO
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copiar() {
    if (!script.value) {
        return
    }
    try {
        await navigator.clipboard.writeText(script.value)
        toast.add({ title: 'Script copiado', description: 'Pégalo en New Terminal del router.', color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', description: 'Descárgalo como archivo.', color: 'warning' })
    }
}

const PASOS = [
    { titulo: 'Abre Winbox', detalle: 'Entra al router como administrador.' },
    { titulo: 'New Terminal', detalle: `Pega el script, o sube el archivo en Files y escribe /import file-name=${NOMBRE_ARCHIVO}.` },
    { titulo: 'Espera «argosisp: listo»', detalle: 'Al final el router se registra solo con ArgosIsp.' },
    { titulo: 'Verifica', detalle: 'En menos de un minuto esta ficha muestra «Conectado». Si dice «FALTA un paso», usa «Pegar clave pública».' },
]
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="rotar ? `Rotar conexión · ${router.nombre}` : `Script de conexión · ${router.nombre}`"
        description="Conecta el MikroTik a ArgosIsp por un túnel WireGuard: crea el usuario de la API, RADIUS y cierra los puertos que no hacen falta."
        :dismissible="!generando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="script-conexion"
            >
                <UAlert
                    v-if="rotar && !script"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Rotar corta la conexión actual"
                    description="El túnel de este router deja de valer: Argos no llega a él (ni RADIUS ni CoA) hasta que ejecutes el script nuevo."
                    data-prueba="aviso-rotar"
                />
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-key-round"
                    title="El script lleva claves"
                    description="Trae la clave de la API y el secreto RADIUS. ArgosIsp no lo guarda: descárgalo o cópialo ahora; no lo mandes por chat. Vale 24 horas y para un solo registro, y cada script nuevo invalida el anterior."
                />

                <UForm
                    v-if="!script"
                    id="form-script"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="generar"
                >
                    <UFormField
                        label="IPs de administración"
                        name="admin"
                        hint="Opcional"
                        help="IPs fijas desde las que entras por Winbox o SSH (tu oficina), separadas por coma. Vacío: solo por el túnel; la sesión de Winbox abierta puede cortarse al final del script."
                    >
                        <UInput
                            v-model="estado.admin"
                            placeholder="190.56.10.20, 10.10.0.0/24"
                            class="w-full font-mono"
                            data-prueba="script-admin"
                        />
                    </UFormField>
                    <UFormField
                        name="incluir_servicio"
                        help="Solo en un router nuevo que ArgosIsp configura completo: suma PPPoE, perfiles y corte."
                    >
                        <UCheckbox
                            v-model="estado.incluir_servicio"
                            label="Incluir configuración de servicio"
                            data-prueba="script-incluir"
                        />
                    </UFormField>
                </UForm>

                <ProblemaPools
                    v-if="problema"
                    :problema="problema"
                    :rechazos="ERRORES_SCRIPT"
                />

                <template v-if="script">
                    <UAlert
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="Script listo"
                        description="Descárgalo o cópialo ahora: al cerrar esta ventana se borra."
                        data-prueba="script-listo"
                    />
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            label="Descargar .rsc"
                            icon="i-lucide-download"
                            data-prueba="script-descargar"
                            @click="descargar"
                        />
                        <UButton
                            label="Copiar"
                            icon="i-lucide-copy"
                            color="neutral"
                            variant="outline"
                            data-prueba="script-copiar"
                            @click="copiar"
                        />
                    </div>
                    <UTextarea
                        :model-value="script"
                        readonly
                        :rows="6"
                        autoresize
                        :maxrows="12"
                        class="w-full"
                        :ui="{ base: 'font-mono text-xs' }"
                        aria-label="Script de conexión"
                        data-prueba="script-texto"
                    />
                    <ol
                        class="flex flex-col gap-2"
                        aria-label="Pasos en el router"
                        data-prueba="script-pasos"
                    >
                        <li
                            v-for="(paso, indice) in PASOS"
                            :key="paso.titulo"
                            class="flex gap-2 text-sm"
                        >
                            <UBadge
                                :label="String(indice + 1)"
                                color="neutral"
                                variant="soft"
                                class="h-6 shrink-0 justify-center rounded-full"
                            />
                            <span class="flex flex-col">
                                <span class="font-medium text-highlighted">{{ paso.titulo }}</span>
                                <span class="text-muted">{{ paso.detalle }}</span>
                            </span>
                        </li>
                    </ol>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="script ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="generando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!script"
                    type="submit"
                    form="form-script"
                    :label="rotar ? 'Rotar y generar script nuevo' : 'Generar script'"
                    :icon="rotar ? 'i-lucide-rotate-ccw-key' : 'i-lucide-file-code-2'"
                    :color="rotar ? 'error' : 'primary'"
                    :loading="generando"
                    data-prueba="script-generar"
                />
            </div>
        </template>
    </UModal>
</template>
