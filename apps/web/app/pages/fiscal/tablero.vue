<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Tablero fiscal (A3, fase 8 PR A; `GET /fiscal/tablero`, `fiscal.ver`): facturado, IVA, ISR, ISO,
 * límite del pequeño contribuyente, vencimientos, libros por emitir y FEL de la empresa activa; con
 * «Todas», una sección por empresa y ningún total consolidado. Cada bloque se calcula por separado:
 * uno que falla muestra su problema y «Reintentar» (recarga el tablero) en lugar de cifras. Solo lee:
 * no presenta nada ni cambia el régimen. Debajo de cada empresa, sus consejos (`GET /fiscal/consejos`, fase
 * 8 PR C), que se leen aparte: si fallan, solo esa sección muestra el error.
 */
definePageMeta({ permiso: 'fiscal.ver' })

useHead({ title: 'Tablero fiscal · ArgosIsp' })

const { eleccion, nombre: nombreEmpresa } = useEmpresaActiva()

const tablero = shallowRef<TableroFiscal | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
let pedido = 0

async function cargar() {
    const actual = ++pedido
    cargando.value = true
    const resultado = await useTableroFiscal().ver()
    if (actual !== pedido) {
        return
    }
    cargando.value = false
    tablero.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

/* Consejos: se leen aparte del tablero (otro endpoint); su error no tapa el tablero. */
const consejos = shallowRef<ConsejosFiscales | null>(null)
const problemaConsejos = ref<Problem | null>(null)
const cargandoConsejos = ref(false)
const verOcultos = ref(false)
const verSinDatos = ref(false)
let pedidoConsejos = 0

async function cargarConsejos() {
    const actual = ++pedidoConsejos
    cargandoConsejos.value = true
    const resultado = await useConsejosFiscales().listar()
    if (actual !== pedidoConsejos) {
        return
    }
    cargandoConsejos.value = false
    consejos.value = resultado.ok ? resultado.data : null
    problemaConsejos.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function consejosDe(empresaId: number) {
    return consejos.value?.empresas.find(e => e.empresa_id === empresaId)?.consejos ?? null
}

function recargarConsejos() {
    void cargarConsejos()
}

function reintentar() {
    void cargar()
    void cargarConsejos()
}

watch(eleccion, reintentar)

onMounted(reintentar)
</script>

<template>
    <PanelPagina
        id="fiscal-tablero"
        titulo="Tablero fiscal"
        icono="i-lucide-layout-dashboard"
    >
        <div class="flex flex-col gap-6">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Lo que va del mes y del año según los libros y las declaraciones, calculado hoy. Los estimados no se guardan ni se presentan: confírmalos con el contador. El sistema nunca cambia el régimen ni presenta nada a la SAT."
            />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="reintentar"
                :reintentando="cargando"
                data-prueba="tablero-problema"
            />

            <div
                v-else-if="!tablero"
                class="grid grid-cols-1 gap-4 lg:grid-cols-2"
                aria-busy="true"
                aria-label="Cargando el tablero fiscal"
            >
                <USkeleton
                    v-for="n in 4"
                    :key="n"
                    class="h-40 w-full"
                />
            </div>

            <template v-else>
                <p class="text-xs text-muted">
                    Calculado al {{ formatearFecha(tablero.hoy) }}<template v-if="tablero.empresas.length > 1">
                        · una sección por empresa, sin totales consolidados
                    </template>
                </p>
                <UAlert
                    v-if="!tablero.empresas.length"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-building-2"
                    title="Sin empresas activas"
                    description="No hay empresas activas con localización fiscal para mostrar."
                />
                <template
                    v-for="(empresa, indice) in tablero.empresas"
                    :key="empresa.empresa_id"
                >
                    <USeparator v-if="indice > 0" />
                    <TableroFiscalEmpresa
                        :empresa="empresa"
                        :nombre="nombreEmpresa(empresa.empresa_id)"
                        :reintentar="reintentar"
                        :reintentando="cargando"
                    />
                    <ProblemaAlerta
                        v-if="problemaConsejos"
                        :problema="problemaConsejos"
                        :reintentar="recargarConsejos"
                        :reintentando="cargandoConsejos"
                        data-prueba="consejos-problema"
                    />
                    <ConsejosFiscalesEmpresa
                        v-else-if="consejos && consejosDe(empresa.empresa_id)"
                        v-model:ver-ocultos="verOcultos"
                        v-model:ver-sin-datos="verSinDatos"
                        :consejos="consejosDe(empresa.empresa_id) ?? []"
                        :empresa-id="empresa.empresa_id"
                        :aviso="consejos.aviso"
                        :recargar="recargarConsejos"
                        :recargando="cargandoConsejos"
                    />
                </template>
            </template>
        </div>
    </PanelPagina>
</template>
