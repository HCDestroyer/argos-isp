import type { Schema } from '@argosisp/contracts'

export type VersionInstalada = Schema<'VersionInstalada'>

/**
 * Versión instalada de ArgosIsp (`GET /version`, cualquier sesión, sin permiso del ACL): SemVer,
 * commit, fecha de compilación, enlace a las notas y `cambios` (Markdown del CHANGELOG). Se lee una
 * vez por sesión del panel y se comparte entre el menú de usuario y el "Qué cambió".
 */
export function useVersion() {
    const api = useApi()
    const version = useState<VersionInstalada | null>('version-instalada', () => null)

    async function cargar(): Promise<Resultado<VersionInstalada>> {
        const resultado = await resolver(api.GET('/api/v1/version'))
        if (resultado.ok) {
            version.value = resultado.data
        }
        return resultado
    }

    return { version, cargar }
}
