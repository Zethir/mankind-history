declare module "mapshaper" {
  interface MapshaperApi {
    applyCommands(
      commands: string,
      input: Record<string, string | Buffer>,
    ): Promise<Record<string, Uint8Array>>;
  }
  // mapshaper is CommonJS with `module.exports = api` built up dynamically, so
  // Node's static cjs-module-lexer (used by the real ESM/CJS interop under tsx
  // and plain `node`) cannot see a named `applyCommands` export -- only the
  // whole-module `default` export is synthesized. A named import works under
  // Vite/vitest, whose bundler-based CJS interop is more permissive, but it
  // throws `SyntaxError: does not provide an export named 'applyCommands'`
  // under tsx, which is how the real pipeline (`pnpm build`) runs. Import the
  // default and read `applyCommands` off it at runtime instead.
  const mapshaper: MapshaperApi;
  export default mapshaper;
}
