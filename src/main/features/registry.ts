import { CORE_MAX_VERSION, type Migration } from '../db/migrations'
import type { Feature, IpcRegistrar } from './types'

export class FeatureRegistry {
  private features: Feature[] = []

  register(feature: Feature): void {
    if (this.features.some((f) => f.name === feature.name)) {
      throw new Error(`Feature "${feature.name}" is already registered`)
    }
    for (const m of feature.migrations ?? []) {
      if (m.version <= CORE_MAX_VERSION) {
        throw new Error(
          `Feature "${feature.name}" migration ${m.version} must use a version above ${CORE_MAX_VERSION}`
        )
      }
    }
    this.features.push(feature)
  }

  names(): string[] {
    return this.features.map((f) => f.name)
  }

  migrations(): Migration[] {
    return this.features.flatMap((f) => f.migrations ?? [])
  }

  registerIpc(ipc: IpcRegistrar): void {
    for (const f of this.features) f.registerIpc?.(ipc)
  }
}
