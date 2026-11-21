<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración › Facturación y cobro › Bancos de origen (tablero OperConfigCobro, pestaña «Bancos
 * de origen»; decisión 23 del PM): el catálogo único de bancos de donde viene el dinero de una
 * transferencia o ACH (`GET /bancos`). Al cobrar, el cajero elige de aquí; también lo usan el
 * portal y la conciliación. Agregar un banco (admin) y ocultar en esta empresa los que no usa se
 * construyen en `agente/a3-cobro-pm`: la pantalla los deja listos sin inventar nada.
 */
definePageMeta({ permiso: 'cuentas_bancarias.ver' })

useHead({ title: 'Bancos de origen · ArgosIsp' })

const bancos = shallowRef<Banco[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const busqueda = ref('')

async function cargar() {
    cargando.value = true
    const resultado = await useBancos().listar()
    cargando.value = false
    bancos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const visibles = computed(() => {
    const termino = normalizarBusqueda(busqueda.value.trim())
    return bancos.value.filter(b => !termino || normalizarBusqueda(b.nombre).includes(termino))
})
</script>

<template>
    <ConfiguracionMarco
        id="bancos-origen"
        titulo="Facturación y cobro"
        descripcion="Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos"
        empresas
    >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <UInput
                v-model="busqueda"
                icon="i-lucide-search"
                placeholder="Buscar banco…"
                aria-label="Buscar banco"
                class="flex-1"
                :ui="{ base: 'rounded-full' }"
                data-prueba="buscar-banco"
            />
            <UButton
                label="Agregar banco"
                icon="i-lucide-plus"
                class="self-start sm:self-center"
                disabled
                title="Falta la API: agregar un banco al catálogo (decisión 23 del PM)."
                data-prueba="agregar-banco"
            />
        </div>
        <p class="text-sm text-muted">
            Al cobrar una transferencia, el cajero elige de aquí el banco de donde viene el dinero. También lo usan el portal y la conciliación.
        </p>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="cargando && !bancos.length"
            class="flex flex-wrap gap-2"
        >
            <USkeleton
                v-for="n in 8"
                :key="n"
                class="h-10 w-32 rounded-full"
            />
        </div>
        <ul
            v-else-if="visibles.length"
            class="flex flex-wrap gap-2"
            aria-label="Bancos del catálogo"
            data-prueba="bancos-origen"
        >
            <li
                v-for="banco in visibles"
                :key="banco.id"
                class="inline-flex items-center gap-2 rounded-full border border-(--ax-borde) px-4 py-2 text-sm font-medium text-highlighted"
            >
                <UIcon
                    name="i-lucide-landmark"
                    class="size-4 text-muted"
                />
                {{ banco.nombre }}
            </li>
        </ul>
        <UEmpty
            v-else
            icon="i-lucide-search-x"
            :title="busqueda ? 'Ningún banco coincide' : 'El catálogo está vacío'"
            variant="naked"
        />

        <ConfiguracionBloque
            titulo="Por empresa"
            icono="i-lucide-eye-off"
        >
            <ConfiguracionPendiente
                etiqueta="Ocultar los bancos que esta empresa no usa"
                ayuda="El catálogo es uno para todo el sistema; cada empresa esconde los que no recibe para que el cajero no los vea."
                fabrica="De fábrica se ven todos"
                :decision="23"
            />
        </ConfiguracionBloque>
    </ConfiguracionMarco>
</template>
