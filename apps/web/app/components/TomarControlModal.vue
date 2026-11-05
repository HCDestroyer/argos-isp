<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Tomar control» de una VLAN o un servidor PPPoE adoptado (`contratos/red-acceso.md` §4.1): la
 * vista previa del diff de A2 (lee el router, no escribe) con cada objeto y propiedad (actual →
 * deseado), las sesiones abiertas (un cambio de perfil no las corta), advertencias y lo que falta
 * en Argos (`faltan[]`, p. ej. la red del servidor, con su enlace). Al confirmar va `version` +
 * `huella`; con 409 (`router_cambio`, `conflicto_version`) se vuelve a leer la vista previa. Sin el
 * diff de A2 la API responde 501: «Todavía no disponible» con «Reintentar». Permiso
 * `red_acceso.tomar_control` (quien lo abre lo comprueba).
 */
const props = defineProps<{
    entidad: VistaPreviaTomarControl['entidad']
    id: number
    nombre: string
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    tomado: []
    /** Falta algo en Argos (p. ej. la red): abrir la edición de la fila. */
    completar: []
}>()

const toast = useToast()

const vista = shallowRef<VistaPreviaTomarControl | null>(null)
const problema = ref<Problem | null>(null)
const problemaAplicar = ref<Problem | null>(null)
const cargando = ref(false)
const aplicando = ref(false)
let clave = nuevaClaveIdempotencia()

const noDisponible = computed(() => problema.value?.status === 501)

async function leer() {
    cargando.value = true
    problema.value = null
    const resultado = await useRedAcceso().vistaPreviaTomarControl(props.entidad, props.id)
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    clave = nuevaClaveIdempotencia()
}

watch(abierto, (valor) => {
    if (valor) {
        vista.value = null
        problemaAplicar.value = null
        void leer()
    }
}, { immediate: true })

async function confirmar() {
    const actual = vista.value
    if (!actual) {
        return
    }
    aplicando.value = true
    problemaAplicar.value = null
    const datos = { version: actual.version, huella: actual.huella }
    const resultado = props.entidad === 'vlan'
        ? await useRedAcceso().tomarControlVlan(props.id, datos, clave)
        : await useRedAcceso().tomarControlServidor(props.id, datos, clave)
    aplicando.value = false
    if (!resultado.ok) {
        problemaAplicar.value = resultado.problema
        // El router o la fila cambiaron desde la vista previa: se vuelve a leer.
        if (resultado.problema.status === 409) {
            const visto = resultado.problema
            await leer()
            problemaAplicar.value = visto
        }
        return
    }
    abierto.value = false
    toast.add({ title: `${props.nombre}: ahora lo administra Argos`, description: 'Se aplica en el router sin cortar sesiones.', icon: 'i-lucide-circle-check', color: 'success' })
    emit('tomado')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Tomar control · ${nombre}`"
        description="Desde ahora Argos lo escribe en el router con su comentario argosisp. Primero ves qué cambiaría; nada se escribe hasta confirmar."
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="tomar-control"
            >
                <USkeleton
                    v-if="cargando && !vista"
                    class="h-40 w-full"
                />
                <UEmpty
                    v-else-if="noDisponible"
                    icon="i-lucide-clock"
                    title="Todavía no disponible"
                    description="El servidor aún no sabe comparar este objeto con lo que tiene el router. Mientras, sigue adoptado y Argos no lo toca."
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'neutral', variant: 'outline', onClick: leer }]"
                    data-prueba="tomar-control-no-disponible"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="leer"
                    :reintentando="cargando"
                />
                <template v-else-if="vista">
                    <UAlert
                        v-if="problemaAplicar?.status === 409"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-git-compare"
                        title="Cambió desde la vista previa"
                        description="Volvimos a leer el router: revisa los cambios y confirma otra vez."
                        data-prueba="tomar-control-cambio"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaAplicar"
                        :problema="problemaAplicar"
                    />
                    <UAlert
                        v-if="vista.faltan.length"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        title="Falta algo en Argos"
                        :actions="[{ label: entidad === 'servidor_pppoe' ? 'Asignar red' : 'Completar', icon: 'i-lucide-pencil', color: 'error', variant: 'outline', onClick: () => { abierto = false; emit('completar') } }]"
                        data-prueba="tomar-control-faltan"
                    >
                        <template #description>
                            <ul class="mt-1 flex list-disc flex-col gap-0.5 pl-5">
                                <li
                                    v-for="falta in vista.faltan"
                                    :key="falta.field"
                                >
                                    {{ falta.message }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <ul
                        v-if="vista.cambios.length"
                        class="flex flex-col gap-2"
                        aria-label="Lo que Argos cambiaría en el router"
                        data-prueba="tomar-control-cambios"
                    >
                        <li
                            v-for="cambio in vista.cambios"
                            :key="`${cambio.ruta}-${cambio.nombre}`"
                            class="flex flex-col gap-2 rounded-lg border border-default p-3"
                        >
                            <div class="flex flex-wrap items-center gap-2">
                                <UBadge
                                    :label="cambio.accion === 'crear' ? 'Crea' : 'Cambia'"
                                    :color="cambio.accion === 'crear' ? 'info' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span class="font-mono text-xs break-all text-highlighted">{{ cambio.nombre }}</span>
                                <span class="text-xs text-muted">{{ cambio.ruta }}</span>
                            </div>
                            <dl class="flex flex-col gap-1">
                                <div
                                    v-for="propiedad in cambio.propiedades"
                                    :key="propiedad.propiedad"
                                    class="grid gap-x-3 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]"
                                >
                                    <dt class="font-mono text-muted">
                                        {{ propiedad.propiedad }}
                                    </dt>
                                    <dd class="font-mono break-all">
                                        <span class="text-muted">{{ propiedad.actual ?? '—' }}</span> → <span class="text-highlighted">{{ propiedad.deseado ?? '—' }}</span>
                                    </dd>
                                </div>
                            </dl>
                        </li>
                    </ul>
                    <UAlert
                        v-else
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="El router ya está como Argos lo dejaría"
                        description="Solo cambia quién lo administra."
                    />
                    <p
                        class="flex items-center gap-1.5 text-sm text-muted"
                        data-prueba="tomar-control-sesiones"
                    >
                        <UIcon
                            name="i-lucide-plug"
                            class="size-4 shrink-0"
                        />
                        {{ vista.sesiones === 1 ? '1 sesión abierta' : `${vista.sesiones.toLocaleString('es-GT')} sesiones abiertas` }}: nadie se desconecta; las nuevas entran con el perfil de Argos.
                    </p>
                    <UAlert
                        v-for="advertencia in vista.advertencias"
                        :key="advertencia"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :title="advertencia"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="vista"
                    label="Tomar control"
                    icon="i-lucide-hand"
                    :loading="aplicando || cargando"
                    :disabled="vista.faltan.length > 0 || vista.estado !== 'adoptado'"
                    data-prueba="tomar-control-confirmar"
                    @click="confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
