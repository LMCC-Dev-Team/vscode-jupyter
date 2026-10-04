# LMCC managed runtime integration

Upstream baseline: `microsoft/vscode-jupyter` **v2025.9.1**, commit `fc61dfe2fd70a3d62d3ce0fef580757e7d64b81c`.

This fork keeps the `ms-toolsai.jupyter` extension identity so the Python integration and existing Notebook metadata continue to work. LMCC IDE ships this build in place of the upstream extension. Do not enable a second upstream Jupyter installation alongside it. Version **2025.9.100** distinguishes the bundled fork, and the distribution disables automatic extension updates.

The added `api.lmcc` namespace has version `1` and provides:

- `getController(notebook, pythonPath)`: resolves a real local Python connection through Jupyter's existing kernel source, registers its controller, and returns its ID and selection state. It refuses to switch a running session to a different interpreter.
- `onDidSelectController`: lets the runtime manager restore a document's configured selection after history or a kernel picker changes it.
- `releaseKernel(notebook)`: explicitly stops that document's kernel before applying a changed runtime.

`jupyter.lmccRuntimeProvider` names the runtime-provider extension. When set by LMCC IDE, kernel startup and cell execution verify the configured runtime and apply its environment variables. Missing or invalid runtime configuration fails rather than falling back to an available system interpreter. An empty provider preserves upstream behavior.

The patch reuses Jupyter's execution queue, outputs, widgets, interrupt/restart handling, and kernel lifecycle. Managed runtimes obtain their activation environment directly from LMCC, including standalone notebook windows, instead of depending on system interpreter discovery. A Windows upstream handle-ownership bug is fixed: the interrupt helper must not close a handle duplicated into the extension host, which could otherwise close its own stdin and hang later kernel requests. The IDE's `lmcc.notebook.bindKernel` command binds the supplied controller ID to an open document by URI without an interactive picker.

## Build for Windows x64

Use Node 22.21.1, `npm ci`, and the VS Code API declarations matching LMCC IDE 1.109.0 (only the proposals named in `package.json`). Then:

```sh
VSC_VSCE_TARGET=win32-x64 npm run esbuild-release
VSC_VSCE_TARGET=win32-x64 npm run updatePackageJsonForBundle
npx @vscode/vsce@3.6.0 package --no-dependencies --target win32-x64
```

The postinstall script supplies the Windows ZeroMQ native binary; the VSIX includes it. The accompanying `ms-toolsai.jupyter-renderers` extension is bundled separately for offline output rendering. Fork package hashes are pinned by LMCC IDE after building and validating the release.

Windows interrupt-helper regression (requires the managed Python):

```sh
node build/lmcc/testInterruptDaemon.cjs C:/path/to/python/python.exe
```

The regression checks that the helper survives idle time and handles a second kernel and a subsequent interrupt. End-to-end runtime tests are maintained in `LMCC-Dev-Team/lmcc-env/test/windows`. Interrupts follow ipykernel semantics: native blocking calls may not return immediately; an explicit kernel restart terminates that session.
