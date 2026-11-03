/// <reference types="vite/client" />

declare module '@mkkellogg/gaussian-splats-3d' {
  import type { Group } from 'three';
  export const SceneFormat: { Splat: number; KSplat: number; Ply: number; Spz: number };
  export class DropInViewer extends Group {
    constructor(options?: Record<string, unknown>);
    addSplatScene(path: string, options?: Record<string, unknown>): Promise<void>;
    dispose(): Promise<void>;
  }
}
