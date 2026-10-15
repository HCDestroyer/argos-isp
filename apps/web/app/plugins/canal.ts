/**
 * Toda petición del panel lleva `X-Canal: panel`: la API lo guarda como canal de la acción en la
 * bitácora (`request_id_middleware`); sin él, todo quedaba como "API". Corre después de
 * `api.ts` (orden alfabético de plugins), que crea el cliente.
 */
export default defineNuxtPlugin(() => {
    useNuxtApp().$api.use({
        onRequest({ request }) {
            request.headers.set('X-Canal', 'panel')
            return request
        },
    })
})
