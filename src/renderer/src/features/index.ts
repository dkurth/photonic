import { dedupe } from './dedupe'
import type { RendererFeature } from './types'

/** Every optional feature's UI. Only those the main process reports as enabled are used. */
export const RENDERER_FEATURES: RendererFeature[] = [dedupe]
