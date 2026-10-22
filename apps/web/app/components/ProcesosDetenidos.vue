<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Procesos detenidos por un bloqueo del libro (A3, fase 6 PR B): la última corrida de facturar y de
 * vencer de cada empresa (`GET /facturas/corridas`, `facturas.ver`), con lo que no se contabilizó por un
 * bloqueo y se reintenta en la siguiente. Leerla no corre nada; «Correr ahora» (`facturas.generar`) es
 * una acción aparte, con confirmación, y después se vuelve a leer.
 */
const { puede } = usePermisos()
const toast = useToast()
const empresaActiva = useEmpresaActiva()

const corridas = shallowRef<CorridasFacturacion[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useFacturas().corridas()
    cargando.value = false
    corridas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function nombreEmpresa(id: number): string | null {
    return corridas.value.length > 1 || empresaActiva.eleccion.value === 'todas' ? empresaActiva.nombre(id) : null
}

/* «Correr ahora»: confirmación, corrida y volver a leer. */
const procesoAConfirmar = ref<ProcesoConBloqueo | null>(null)
const confirmando = computed({
    get: () => procesoAConfirmar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            procesoAConfirmar.value = null
        }
    },
})

interface Corrida {
    resumen: string
    bloqueados: number
}

function correr(): Promise<Resultado<Corrida>> {
    const clave = nuevaClaveIdempotencia()
    if (procesoAConfirmar.value === 'facturar') {
        return useFacturas().generar(clave).then(r => (r.ok
            ? { ok: true, data: { resumen: resumenCorrida({ proceso: 'facturas.generar', resultado: { ...r.data } }) ?? '', bloqueados: r.data.bloqueados ?? 0 } }
            : r))
    }
    return useFacturas().vencer(clave).then(r => (r.ok
        ? { ok: true, data: { resumen: resumenCorrida({ proceso: 'facturas.vencer_pendientes', resultado: { ...r.data } }) ?? '', bloqueados: r.data.bloqueados } }
        : r))
}

function alCorrer(resultado: Corrida) {
    toast.add({
        title: resultado.bloqueados ? `${resultado.bloqueados} pendientes por un bloqueo` : 'Sin pendientes por bloqueos',
        description: resultado.resumen,
        icon: resultado.bloqueados ? 'i-lucide-lock' : 'i-lucide-circle-check',
        color: resultado.bloqueados ? 'warning' : 'success',
    })
    void cargar()
}

defineExpose({ cargar })

onMounted(() => void cargar())
</script>

<template>
    <UPageCard
        title="Procesos detenidos por un bloqueo"
        description="La facturación y el vencimiento no contabilizan lo que cae bajo un bloqueo: lo dejan pendiente y cada corrida lo reintenta. Aquí se ve la última corrida de cada uno; después de desbloquear (o con una excepción), córralos para que entre lo pendiente."
        icon="i-lucide-hourglass"
        variant="subtle"
        data-prueba="procesos-bloqueados"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="corridas-error"
        />
        <USkeleton
            v-else-if="cargando && !corridas.length"
            class="h-28 w-full"
        />
        <div
            v-else
            class="flex flex-col gap-4"
        >
            <section
                v-for="empresa in corridas"
                :key="empresa.empresa_id"
                class="flex flex-col gap-2"
                :aria-label="nombreEmpresa(empresa.empresa_id) ?? 'Corridas'"
                :data-empresa="empresa.empresa_id"
                data-prueba="corridas-empresa"
            >
                <h4
                    v-if="nombreEmpresa(empresa.empresa_id)"
                    class="text-sm font-semibold text-highlighted"
                >
                    {{ nombreEmpresa(empresa.empresa_id) }}
                </h4>
                <div class="grid gap-3 lg:grid-cols-2">
                    <div
                        v-for="corrida in empresa.procesos"
                        :key="corrida.proceso"
                        class="flex flex-col gap-2 rounded-lg border p-3"
                        :class="corrida.bloqueados ? 'border-warning/40 bg-warning/5' : 'border-default'"
                        :data-proceso="PROCESO_DE_CORRIDA[corrida.proceso]"
                    >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                <UIcon
                                    :name="PROCESOS_CON_BLOQUEO[PROCESO_DE_CORRIDA[corrida.proceso]].icono"
                                    class="size-4 shrink-0"
                                />
                                {{ PROCESOS_CON_BLOQUEO[PROCESO_DE_CORRIDA[corrida.proceso]].etiqueta }}
                            </span>
                            <UButton
                                v-if="puede('facturas.generar')"
                                label="Correr ahora"
                                icon="i-lucide-play"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :data-prueba="`correr-${PROCESO_DE_CORRIDA[corrida.proceso]}`"
                                @click="procesoAConfirmar = PROCESO_DE_CORRIDA[corrida.proceso]"
                            />
                        </div>
                        <template v-if="corrida.corrida_en">
                            <p
                                class="text-xs text-muted"
                                data-prueba="proceso-ultima"
                            >
                                Última corrida: {{ formatearFechaHora(corrida.corrida_en) }} · {{ origenCorrida(corrida) }}<template v-if="corrida.hasta">
                                    · hasta {{ formatearFecha(corrida.hasta) }}
                                </template>
                            </p>
                            <p
                                v-if="resumenCorrida(corrida)"
                                class="text-sm"
                            >
                                {{ resumenCorrida(corrida) }}
                            </p>
                            <p
                                class="text-sm font-medium"
                                :class="corrida.bloqueados ? 'text-warning' : 'text-success'"
                                data-prueba="proceso-bloqueados"
                            >
                                {{ corrida.bloqueados ? `${corrida.bloqueados} ${corrida.bloqueados === 1 ? 'documento sigue pendiente' : 'documentos siguen pendientes'} por un bloqueo` : 'Nada quedó detenido por un bloqueo' }}
                            </p>
                            <ul
                                v-if="corrida.bloqueos.length"
                                class="flex flex-col gap-1 text-xs text-muted"
                            >
                                <li
                                    v-for="(b, indice) in corrida.bloqueos"
                                    :key="indice"
                                    data-prueba="proceso-bloqueo"
                                >
                                    {{ TIPOS_BLOQUEO[b.tipo].etiqueta }}{{ b.hasta ? ` hasta ${formatearFecha(b.hasta)}` : '' }} · fecha {{ formatearFecha(b.fecha) }} · {{ b.documentos }} {{ b.documentos === 1 ? 'documento' : 'documentos' }}<template v-if="b.ejemplos.length">
                                        · ids {{ b.ejemplos.slice(0, 5).join(', ') }}{{ b.ejemplos.length > 5 ? '…' : '' }}
                                    </template>
                                </li>
                            </ul>
                        </template>
                        <p
                            v-else
                            class="text-sm text-muted"
                            data-prueba="proceso-sin-corrida"
                        >
                            Aún no corrió para esta empresa. {{ PROCESOS_CON_BLOQUEO[PROCESO_DE_CORRIDA[corrida.proceso]].descripcion }}
                        </p>
                    </div>
                </div>
            </section>
        </div>

        <ConfirmacionModal
            v-if="puede('facturas.generar')"
            v-model:open="confirmando"
            :titulo="procesoAConfirmar ? PROCESOS_CON_BLOQUEO[procesoAConfirmar].etiqueta : 'Proceso'"
            efecto="Procesa todo lo pendiente hasta hoy, como la corrida automática. Lo que siga bajo un bloqueo queda pendiente y se ve aquí."
            confirmar="Correr ahora"
            icono="i-lucide-play"
            color="primary"
            :ejecutar="correr"
            @hecho="alCorrer"
        />
    </UPageCard>
</template>
