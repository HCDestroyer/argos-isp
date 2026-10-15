import type { ApiClient } from '@argosisp/contracts'

/**
 * Cliente HTTP tipado contra `@argosisp/contracts` (openapi-fetch), con el token Bearer
 * de la sesión. En modo fixtures responde desde `apps/web/fixtures`.
 *
 * ```ts
 * const { data, error } = await useApi().GET('/api/v1/me')
 * ```
 */
export function useApi(): ApiClient {
    return useNuxtApp().$api
}
