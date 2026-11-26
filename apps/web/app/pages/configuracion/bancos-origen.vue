<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Configuración › Facturación y cobro › Bancos de origen (tablero OperConfigCobro, pestaña «Bancos
 * de origen»; decisión 23 del PM): el catálogo único de bancos de donde viene el dinero de una
 * transferencia o ACH (`GET /bancos-origen`, A3). El admin agrega y edita (para todas las
 * empresas); cada empresa oculta los que no usa (`ocultar`/`mostrar`, de la empresa activa). Al
 * cobrar, el cajero solo ve los que su empresa no ocultó.
 */
definePageMeta({ permiso: 'cuentas_bancarias.ver' })

useHead({ title: 'Bancos de origen · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { empresaId, empresa } = useEmpresaActiva()

const bancos = shallowRef<BancoOrigen[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const busqueda = ref('')
const ocupado = ref<number | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useBancosOrigen().listar()
    cargando.value = false
    bancos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(empresaId, cargar)

const visibles = computed(() => {
    const termino = normalizarBusqueda(busqueda.value.trim())
    return bancos.value.filter(b => !termino || normalizarBusqueda(b.nombre).includes(termino))
})
const ocultos = computed(() => bancos.value.filter(b => b.oculto).length)

/* Agregar y editar */
const modalAbierto = ref(false)
const editando = shallowRef<BancoOrigen | null>(null)

function abrir(banco: BancoOrigen | null) {
    editando.value = banco
    modalAbierto.value = true
}

function alGuardar(banco: BancoOrigen, nuevo: boolean) {
    toast.add({ title: nuevo ? `${banco.nombre} agregado al catálogo` : `${banco.nombre} guardado`, description: 'Para todas las empresas.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

/* Ocultar y mostrar en la empresa activa */
async function cambiarOculto(banco: BancoOrigen) {
    ocupado.value = banco.id
    const r = banco.oculto ? await useBancosOrigen().mostrar(banco.id) : await useBancosOrigen().ocultar(banco.id)
    ocupado.value = null
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    bancos.value = bancos.value.map(b => (b.id === r.data.id ? r.data : b))
    toast.add({
        title: r.data.oculto ? `${r.data.nombre} oculto` : `${r.data.nombre} visible`,
        description: `${r.data.oculto ? 'Ya no sale' : 'Vuelve a salir'} al cobrar en ${empresa.value?.nombre_comercial ?? 'esta empresa'}.`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

function menu(banco: BancoOrigen): DropdownMenuItem[] {
    const items: DropdownMenuItem[] = []
    if (puede('bancos_origen.editar')) {
        items.push({ label: 'Editar', icon: ICONOS.editar, onSelect: () => abrir(banco) })
    }
    if (banco.oculto ? puede('bancos_origen.mostrar') : puede('bancos_origen.ocultar')) {
        items.push(empresaId.value
            ? { label: banco.oculto ? 'Mostrar en esta empresa' : 'Ocultar en esta empresa', icon: banco.oculto ? 'i-lucide-eye' : 'i-lucide-eye-off', onSelect: () => void cambiarOculto(banco) }
            : { label: 'Elige una empresa para ocultarlo', icon: 'i-lucide-eye-off', disabled: true })
    }
    return items
}
</script>

<template>
    <ConfiguracionMarco
        id="bancos-origen"
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
                v-if="puede('bancos_origen.crear')"
                label="Agregar banco"
                icon="i-lucide-plus"
                class="glow-brand self-start sm:self-center"
                data-prueba="agregar-banco"
                @click="abrir(null)"
            />
        </div>
        <p class="text-sm text-muted">
            Al cobrar una transferencia, el cajero elige de aquí el banco de donde viene el dinero. También lo usan el portal y la conciliación.
            <template v-if="empresaId">
                Los ocultos no salen en {{ empresa?.nombre_comercial ?? 'esta empresa' }}<template v-if="ocultos">
                    ({{ ocultos }})
                </template>.
            </template>
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
                :data-banco="banco.nombre"
                :data-oculto="banco.oculto"
            >
                <UDropdownMenu
                    :items="menu(banco)"
                    :disabled="!menu(banco).length"
                    :content="{ align: 'start' }"
                >
                    <UButton
                        :label="banco.nombre"
                        :icon="banco.oculto ? 'i-lucide-eye-off' : 'i-lucide-landmark'"
                        color="neutral"
                        variant="outline"
                        :loading="ocupado === banco.id"
                        :class="[
                            'px-4 py-2',
                            banco.oculto ? 'border-dashed text-muted' : 'text-highlighted',
                            !banco.activo ? 'line-through opacity-70' : '',
                        ]"
                        :aria-label="`${banco.nombre}${banco.oculto ? ' (oculto en esta empresa)' : ''}${!banco.activo ? ' (fuera de las listas)' : ''}`"
                    />
                </UDropdownMenu>
            </li>
        </ul>
        <UEmpty
            v-else
            icon="i-lucide-search-x"
            :title="busqueda ? 'Ningún banco coincide' : 'El catálogo está vacío'"
            variant="naked"
        />

        <BancoOrigenModal
            v-model:open="modalAbierto"
            :banco="editando"
            @hecho="alGuardar"
            @recargar="cargar"
        />
    </ConfiguracionMarco>
</template>
