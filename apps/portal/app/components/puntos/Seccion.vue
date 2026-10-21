<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Sección «Puntos» de `/cuenta` (contrato `lealtad.md` §12). Solo existe si el panel activó el
 * programa en el portal (`visible_portal`); el canje, si además activó `canje_portal`.
 *
 * Por empresa (los puntos son por NIT): saldo animado, lo que vence pronto, premios en tarjetas con
 * «Canjear» (apagado con el porqué), historial y términos. Si los puntos no se pueden leer, el error
 * con «Reintentar» y ningún saldo (nunca «0 puntos» inventado).
 */
const props = defineProps<{
    servicios: Schema<'PortalServicio'>[]
}>()

const { empresas, problema, cargando, recargar } = usePuntos()
const { premios, problema: problemaPremios, recargar: recargarPremios } = usePremios()
const listaCanjes = useTemplateRef<{ recargar: () => Promise<void> }>('canjes')

const varias = computed(() => (empresas.value?.length ?? 0) > 1)
const premiosDe = (empresaId: number) => (premios.value ?? []).filter(p => p.empresa_id === empresaId)
const serviciosDe = (empresaId: number) => props.servicios.filter(s => s.empresa.id === empresaId)

const elegido = ref<PremioPortal | null>(null)
const confirmar = ref(false)
function pedirCanje(premio: PremioPortal) {
    elegido.value = premio
    confirmar.value = true
}
const saldoDe = (empresaId: number) => empresas.value?.find(e => e.empresa.id === empresaId)?.saldo ?? 0

async function canjeado() {
    await Promise.all([recargar(), recargarPremios(), listaCanjes.value?.recargar()])
}
</script>

<template>
    <div
        class="flex flex-col gap-6"
        data-testid="seccion-puntos"
    >
        <h2 class="text-lg font-semibold text-highlighted">
            Mis puntos
        </h2>

        <template v-if="cargando && !empresas && !problema">
            <USkeleton class="h-28 w-full" />
            <USkeleton class="h-40 w-full" />
        </template>

        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar tus puntos"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargar() }]"
            data-testid="puntos-error"
        />

        <UAlert
            v-else-if="empresas && empresas.length === 0"
            color="neutral"
            variant="subtle"
            icon="i-lucide-sparkles"
            title="El programa de puntos no está disponible"
            description="Cuando tu proveedor lo active, aquí verás tus puntos y los premios."
            data-testid="puntos-no-disponible"
        />

        <template v-else-if="empresas">
            <section
                v-for="puntos in empresas"
                :key="puntos.empresa.id"
                class="flex flex-col gap-5"
                :aria-labelledby="`titulo-puntos-${puntos.empresa.id}`"
                :data-testid="`puntos-empresa-${puntos.empresa.id}`"
            >
                <h3
                    :id="`titulo-puntos-${puntos.empresa.id}`"
                    :class="varias ? 'text-base font-semibold text-highlighted' : 'sr-only'"
                >
                    Puntos con {{ puntos.empresa.nombre_comercial }}
                </h3>

                <PuntosSaldo :puntos="puntos" />

                <section
                    class="flex flex-col gap-3"
                    :aria-labelledby="`titulo-premios-${puntos.empresa.id}`"
                >
                    <h3
                        :id="`titulo-premios-${puntos.empresa.id}`"
                        class="text-sm font-semibold text-highlighted"
                    >
                        Premios
                    </h3>
                    <UAlert
                        v-if="problemaPremios"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-cloud-off"
                        title="No pudimos cargar los premios"
                        :description="mensajeProblema(problemaPremios)"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargarPremios() }]"
                    />
                    <p
                        v-else-if="premios && premiosDe(puntos.empresa.id).length === 0"
                        class="text-sm text-muted"
                    >
                        Pronto habrá premios para canjear.
                    </p>
                    <PuntosPremios
                        v-else-if="premios"
                        :premios="premiosDe(puntos.empresa.id)"
                        @canjear="pedirCanje"
                    />
                    <USkeleton
                        v-else
                        class="h-32 w-full"
                    />
                </section>

                <section
                    class="flex flex-col gap-3"
                    :aria-labelledby="`titulo-movimientos-${puntos.empresa.id}`"
                >
                    <h3
                        :id="`titulo-movimientos-${puntos.empresa.id}`"
                        class="text-sm font-semibold text-highlighted"
                    >
                        Historial de puntos
                    </h3>
                    <PuntosMovimientos :movimientos="puntos.movimientos" />
                </section>

                <UAccordion
                    v-if="puntos.programa.terminos"
                    :items="[{ label: `Términos de ${puntos.programa.nombre}`, icon: 'i-lucide-scroll-text', slot: 'terminos' }]"
                    data-testid="terminos-puntos"
                >
                    <template #terminos>
                        <p class="whitespace-pre-line pb-3 text-sm text-muted">
                            {{ puntos.programa.terminos }}
                        </p>
                    </template>
                </UAccordion>
            </section>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-canjes"
            >
                <h3
                    id="titulo-canjes"
                    class="text-sm font-semibold text-highlighted"
                >
                    Mis canjes
                </h3>
                <PuntosCanjes ref="canjes" />
            </section>
        </template>

        <PuntosConfirmarCanje
            v-model:open="confirmar"
            :premio="elegido"
            :saldo="elegido ? saldoDe(elegido.empresa_id) : 0"
            :servicios="elegido ? serviciosDe(elegido.empresa_id) : []"
            @canjeado="canjeado"
        />
    </div>
</template>
