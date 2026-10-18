<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Empresa sugerida de cada zona y router (multiempresa): un servicio nuevo toma la de la zona del
 * cliente, si no la del router, si no la empresa activa de quien lo crea. Se guarda al elegir, con
 * la `version` leída (409: se relee la fila). Sin `zonas.editar` / `routers.editar`, solo lectura.
 */
const props = defineProps<{
    empresas: EmpresaGrupo[]
}>()

const { puede } = usePermisos()
const toast = useToast()

const SIN_EMPRESA = 'ninguna'

const zonas = shallowRef<Zona[]>([])
const routers = shallowRef<RouterNas[]>([])
const problemaZonas = ref<Problem | null>(null)
const problemaRouters = ref<Problem | null>(null)
const cargando = ref(false)
const guardando = ref<string | null>(null)

const items = computed(() => [
    { label: 'Sin sugerencia (empresa activa)', value: SIN_EMPRESA },
    ...props.empresas.map(e => ({ label: e.nombre_comercial, value: String(e.id) })),
])

async function cargar() {
    cargando.value = true
    const [rz, rr] = await Promise.all([
        puede('zonas.ver') ? useZonas().listar() : Promise.resolve(null),
        puede('routers.ver') ? useRouters().listar({ limit: 200 }) : Promise.resolve(null),
    ])
    cargando.value = false
    if (rz) {
        zonas.value = rz.ok ? rz.data : []
        problemaZonas.value = rz.ok ? null : rz.problema
    }
    if (rr) {
        routers.value = rr.ok ? rr.data.data : []
        problemaRouters.value = rr.ok ? null : rr.problema
    }
}

onMounted(cargar)

function valorDe(id: number | null): string {
    return id === null ? SIN_EMPRESA : String(id)
}

function aEmpresa(valor: string): number | null {
    return valor === SIN_EMPRESA ? null : Number(valor)
}

function avisar(resultado: Resultado<unknown>, nombre: string) {
    if (resultado.ok) {
        toast.add({ title: 'Empresa sugerida guardada', description: nombre, color: 'success', icon: 'i-lucide-circle-check' })
        return
    }
    toast.add({ title: resultado.problema.title, description: resultado.problema.detail, color: 'error', icon: 'i-lucide-circle-x' })
}

async function cambiarZona(zona: Zona, valor: string) {
    guardando.value = `zona-${zona.id}`
    const resultado = await useZonas().editar(zona.id, { nombre: zona.nombre, empresa_sugerida_id: aEmpresa(valor), version: zona.version })
    guardando.value = null
    avisar(resultado, zona.nombre)
    if (resultado.ok) {
        zonas.value = zonas.value.map(z => (z.id === zona.id ? resultado.data : z))
    }
    else {
        await cargar()
    }
}

async function cambiarRouter(router: RouterNas, valor: string) {
    guardando.value = `router-${router.id}`
    const resultado = await useRouters().editar(router.id, { version: router.version, empresa_sugerida_id: aEmpresa(valor) })
    guardando.value = null
    avisar(resultado, router.nombre)
    if (resultado.ok) {
        routers.value = routers.value.map(r => (r.id === router.id ? resultado.data : r))
    }
    else {
        await cargar()
    }
}

const columnasZonas: TableColumn<Zona>[] = [
    { accessorKey: 'nombre', header: 'Zona' },
    { accessorKey: 'empresa_sugerida_id', header: 'Empresa sugerida' },
]
const columnasRouters: TableColumn<RouterNas>[] = [
    { accessorKey: 'nombre', header: 'Router' },
    { accessorKey: 'empresa_sugerida_id', header: 'Empresa sugerida' },
]
</script>

<template>
    <div class="grid gap-6 lg:grid-cols-2">
        <section
            v-if="puede('zonas.ver')"
            class="flex flex-col gap-2"
            aria-labelledby="titulo-sugerencias-zonas"
        >
            <h3
                id="titulo-sugerencias-zonas"
                class="text-sm font-semibold text-highlighted"
            >
                Zonas
            </h3>
            <ProblemaAlerta
                v-if="problemaZonas"
                :problema="problemaZonas"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="zonas"
                :columns="columnasZonas"
                :loading="cargando"
                data-prueba="sugerencias-zonas"
            >
                <template #empresa_sugerida_id-cell="{ row }">
                    <USelect
                        :model-value="valorDe(row.original.empresa_sugerida_id)"
                        :items="items"
                        :disabled="!puede('zonas.editar')"
                        :loading="guardando === `zona-${row.original.id}`"
                        :aria-label="`Empresa sugerida de la zona ${row.original.nombre}`"
                        class="w-full min-w-48"
                        @update:model-value="valor => cambiarZona(row.original, String(valor))"
                    />
                </template>
            </UTable>
        </section>

        <section
            v-if="puede('routers.ver')"
            class="flex flex-col gap-2"
            aria-labelledby="titulo-sugerencias-routers"
        >
            <h3
                id="titulo-sugerencias-routers"
                class="text-sm font-semibold text-highlighted"
            >
                Routers
            </h3>
            <ProblemaAlerta
                v-if="problemaRouters"
                :problema="problemaRouters"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="routers"
                :columns="columnasRouters"
                :loading="cargando"
                data-prueba="sugerencias-routers"
            >
                <template #nombre-cell="{ row }">
                    <div class="flex flex-col">
                        <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                        <span class="font-mono text-xs text-muted">{{ row.original.nas_ip }}</span>
                    </div>
                </template>
                <template #empresa_sugerida_id-cell="{ row }">
                    <USelect
                        :model-value="valorDe(row.original.empresa_sugerida_id)"
                        :items="items"
                        :disabled="!puede('routers.editar')"
                        :loading="guardando === `router-${row.original.id}`"
                        :aria-label="`Empresa sugerida del router ${row.original.nombre}`"
                        class="w-full min-w-48"
                        @update:model-value="valor => cambiarRouter(row.original, String(valor))"
                    />
                </template>
            </UTable>
        </section>
    </div>
</template>
