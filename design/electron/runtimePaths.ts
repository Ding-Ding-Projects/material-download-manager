import path from "node:path";

/**
 * Electron runs the compiled main process from dist-electron/electron while
 * Vite writes the renderer to dist. Keep this calculation in one small,
 * testable module so an unpackaged production launch cannot drift into a blank
 * window.
 */
export function resolveRendererPath(compiledMainDirectory: string): string {
  return path.join(compiledMainDirectory, "../../dist/index.html");
}

export function isDevelopmentLaunch(appIsPackaged: boolean, nodeEnv = process.env.NODE_ENV): boolean {
  return !appIsPackaged && nodeEnv === "development";
}
