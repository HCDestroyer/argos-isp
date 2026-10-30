<script setup lang="ts">
import type { DiagnosticoCorte } from '~/types/controlVelocidad'

/**
 * Chequeo `corte` de «Probar conexión» (`ChequeoConexion.corte`, `DiagnosticoCorte` de A2;
 * `contratos/control-velocidad.md` §10.2–10.3): responde «¿un suspendido de este router ve la página
 * de corte?». Cada paso con su estado, lo que se vio y qué hacer, los comandos de RouterOS en un
 * bloque para copiar y, si «Reconciliar ahora» lo arregla, el botón (lo abre el padre). Además el
 * destino del portal, los suspendidos fuera de la lista y los límites del corte, que se ven siempre.
 */
const props = defineProps<{
    corte: DiagnosticoCorte
}>()

const emit = defineEmits<{
    reconciliar: []
}>()

const { puede } = usePermisos()

type Chequeo = DiagnosticoCorte['chequeos'][number]

const PASOS: Record<Chequeo['clave'], string> = {
    lista_suspendidos: 'Lista de suspendidos',
    reglas: 'Reglas de corte (filter y NAT)',
    portal_http: 'El router llega a la página de corte',
    sesiones_suspendidas: 'Cada suspendido está en la lista',
    fasttrack: 'El corte va antes de FastTrack',
    perfil_suspendido: 'Perfil PPP del suspendido',
    walled_garden: 'Portal y pasarela permitidos (walled garden)',
}

const ORIGENES: Record<NonNullable<DiagnosticoCorte['portal']['origen']>, string> = {
    variable: 'fijada en ROUTERS_SERVICIO_PORTAL_V4',
    url: 'tomada de la URL del portal',
    dns: 'resuelta del nombre del portal',
}

function estado(chequeo: Chequeo): { etiqueta: string, color: 'success' | 'error' | 'neutral', icono: string } {
    if (chequeo.ok === true) {
        return { etiqueta: 'Bien', color: 'success', icono: 'i-lucide-circle-check' }
    }
    if (chequeo.ok === false) {
        return { etiqueta: 'Falla', color: 'error', icono: 'i-lucide-circle-x' }
    }
    return { etiqueta: 'No se pudo comprobar', color: 'neutral', icono: 'i-lucide-circle-minus' }
}

/** `sin_api` y `router_no_responde` llegan solo en `problemas[]` (sin chequeo propio). */
const sinLectura = computed(() => props.corte.problemas.filter(p => p.codigo === 'sin_api' || p.codigo === 'router_no_responde'))
const reconciliable = computed(() => props.corte.chequeos.some(c => c.reconciliar) || props.corte.problemas.some(p => p.reconciliar))
const fuera = computed(() => props.corte.suspendidos.fuera_de_lista)
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="diagnostico-corte"
    >
        <UAlert
            :color="corte.ok ? 'success' : 'error'"
            variant="subtle"
            :icon="corte.ok ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
            :title="corte.ok ? 'Un suspendido de este router ve la página de corte' : 'Un suspendido de este router no vería la página de corte'"
            :description="corte.ok ? 'Reglas activas y en orden, y el router llega al portal.' : 'Abajo está cada paso con qué hacer.'"
            data-prueba="corte-resumen"
        />

        <div
            v-for="item in sinLectura"
            :key="item.codigo"
            class="flex flex-col gap-2"
            :data-prueba="`corte-${item.codigo}`"
        >
            <p class="text-sm text-error">
                {{ item.mensaje }}
            </p>
            <ComandosRouterOs :comandos="item.comandos" />
        </div>

        <ul
            v-if="corte.chequeos.length"
            class="flex flex-col divide-y divide-default rounded-md border border-default"
        >
            <li
                v-for="chequeo in corte.chequeos"
                :key="chequeo.clave"
                class="flex flex-col gap-1.5 px-3 py-2.5"
                :data-corte="chequeo.clave"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm font-medium text-highlighted">{{ PASOS[chequeo.clave] }}</span>
                    <UBadge
                        :label="estado(chequeo).etiqueta"
                        :icon="estado(chequeo).icono"
                        :color="estado(chequeo).color"
                        variant="subtle"
                        size="sm"
                    />
                </div>
                <p class="text-xs break-words whitespace-pre-line text-muted">
                    {{ chequeo.detalle }}
                </p>
                <p
                    v-if="chequeo.ok === false && chequeo.reconciliar"
                    class="flex items-start gap-1.5 text-xs text-error"
                >
                    <UIcon
                        name="i-lucide-lightbulb"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>Qué hacer: «Reconciliar ahora» lo deja como debe estar{{ chequeo.comandos.length ? ', o pega estos comandos en el router' : '' }}.</span>
                </p>
                <ComandosRouterOs
                    v-if="chequeo.ok !== true"
                    :comandos="chequeo.comandos"
                />
            </li>
        </ul>

        <dl
            class="grid gap-3 rounded-md border border-default p-3 sm:grid-cols-2"
            data-prueba="corte-portal"
        >
            <DatoFicha
                etiqueta="Página de corte (destino del NAT)"
                :valor="corte.portal.destino_nat ?? 'Sin destino: Argos no sabe la IPv4 del portal'"
                mono
            />
            <DatoFicha
                etiqueta="IPv4 del portal"
                :valor="corte.portal.ipv4 ? `${corte.portal.ipv4}${corte.portal.origen ? ` (${ORIGENES[corte.portal.origen]})` : ''}` : 'No se sabe'"
            />
            <DatoFicha
                etiqueta="Respuesta del portal"
                :valor="corte.portal.alcanzable === null ? 'No se probó' : corte.portal.alcanzable ? `Responde${corte.portal.http_status ? ` (HTTP ${corte.portal.http_status})` : ''}` : `No responde${corte.portal.http_status ? ` (HTTP ${corte.portal.http_status})` : ''}`"
            />
            <DatoFicha
                etiqueta="Suspendidos con IPv4"
                :valor="corte.suspendidos.total ? `${corte.suspendidos.total} · ${fuera ? `${fuera} fuera de la lista (navegan sin corte)` : 'todos en la lista'}` : 'Ninguno ahora'"
                data-prueba="corte-suspendidos"
            />
        </dl>
        <p
            v-if="corte.portal.detalle"
            class="font-mono text-xs break-all text-muted"
        >
            {{ corte.portal.detalle }}
        </p>
        <p
            v-if="corte.suspendidos.ejemplos.length"
            class="text-xs text-muted"
            data-prueba="corte-ejemplos"
        >
            Ejemplos fuera de la lista:
            <span class="font-mono">{{ corte.suspendidos.ejemplos.map(e => `${e.ipv4} (servicio ${e.servicio_id}, ${TIPOS_CONEXION[e.tipo_conexion].corta})`).join(', ') }}</span>
        </p>

        <UButton
            v-if="reconciliable && puede('routers.reconciliar')"
            label="Reconciliar ahora"
            icon="i-lucide-refresh-cw"
            class="self-start"
            data-prueba="corte-reconciliar"
            @click="emit('reconciliar')"
        />
        <p
            v-else-if="reconciliable"
            class="text-xs text-muted"
        >
            Pide a un administrador o a un técnico que use «Reconciliar ahora».
        </p>

        <UAlert
            v-if="corte.limites.length"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            title="Lo que el corte no hace"
            data-prueba="corte-limites"
        >
            <template #description>
                <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                    <li
                        v-for="(limite, indice) in corte.limites"
                        :key="indice"
                    >
                        {{ limite }}
                    </li>
                </ul>
            </template>
        </UAlert>
    </div>
</template>
