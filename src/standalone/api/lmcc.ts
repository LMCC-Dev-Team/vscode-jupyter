// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, NotebookDocument, Uri, extensions, workspace } from 'vscode';
import { IKernelProvider, KernelConnectionMetadata } from '../../kernels/types';
import { IControllerRegistration, ILocalPythonNotebookKernelSourceSelector } from '../../notebooks/controllers/types';
import { IServiceContainer } from '../../platform/ioc/types';

/** Versioned integration maintained by LMCC; standard Jupyter execution remains unchanged. */
export interface LmccRuntimeApi {
    readonly version: 1;
    readonly onDidSelectController: Event<{ notebook: NotebookDocument }>;
    getController(notebook: NotebookDocument, pythonPath: string): Promise<{ id: string; selected: boolean }>;
    releaseKernel(notebook: NotebookDocument): Promise<void>;
}
interface RuntimeProvider {
    resolveRuntime(uri: Uri | undefined, capability: 'notebook'): Promise<{ pythonPath: string }>;
    getExecutionEnvironment(uri: Uri | undefined): Promise<Record<string, string>>;
}

export async function checkManagedRuntime(notebook: NotebookDocument, connection: KernelConnectionMetadata) {
    const extensionId = workspace.getConfiguration('jupyter').get<string>('lmccRuntimeProvider');
    if (!extensionId) {
        return;
    }
    const extension = extensions.getExtension<RuntimeProvider>(extensionId);
    if (!extension) {
        throw new Error(`Managed runtime provider ${extensionId} is missing.`);
    }
    const provider = await extension.activate();
    const runtime = await provider.resolveRuntime(notebook.uri, 'notebook');
    if (connection.kind !== 'startUsingPythonInterpreter' || !samePath(connection.interpreter.uri, runtime.pythonPath)) {
        throw new Error('This notebook must use its LMCC runtime. Reopen the notebook to apply its runtime configuration.');
    }
}

export async function applyManagedKernelEnvironment(resource: Uri | undefined, interpreter: Uri | undefined, environment: NodeJS.ProcessEnv) {
    const extensionId = workspace.getConfiguration('jupyter').get<string>('lmccRuntimeProvider');
    if (!extensionId) {
        return environment;
    }
    const extension = extensions.getExtension<RuntimeProvider>(extensionId);
    if (!extension) {
        throw new Error(`Managed runtime provider ${extensionId} is missing.`);
    }
    const provider = await extension.activate();
    const runtime = await provider.resolveRuntime(resource, 'notebook');
    if (!interpreter || !samePath(interpreter, runtime.pythonPath)) {
        throw new Error('Cannot start a kernel outside the configured LMCC runtime.');
    }
    const overrides = await provider.getExecutionEnvironment(resource);
    const result = { ...environment };
    for (const key of Object.keys(result)) {
        if (Object.keys(overrides).includes(key.toUpperCase())) {
            delete result[key];
        }
    }
    return { ...result, ...overrides };
}

function samePath(uri: Uri, pythonPath: string) {
    // URI comparison also normalizes path separators without importing Node into the web bundle.
    const left = uri.toString();
    const right = Uri.file(pythonPath).toString();
    return /^\/[a-z]:/i.test(uri.path) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function createLmccRuntimeApi(services: IServiceContainer): LmccRuntimeApi {
    const controllers = services.get<IControllerRegistration>(IControllerRegistration);
    const kernels = services.get<IKernelProvider>(IKernelProvider);
    return {
        version: 1,
        onDidSelectController: controllers.onControllerSelected,
        async getController(notebook, pythonPath) {
            if (!workspace.isTrusted) {
                throw new Error('The notebook workspace is not trusted.');
            }
            if (notebook.notebookType !== 'jupyter-notebook') {
                throw new Error('Only Jupyter notebooks support managed runtimes.');
            }
            const running = kernels.get(notebook);
            if (running?.startedAtLeastOnce && !running.disposed) {
                const connection = running.kernelConnectionMetadata;
                if (connection.kind !== 'startUsingPythonInterpreter' || !samePath(connection.interpreter.uri, pythonPath)) {
                    throw new Error('The notebook runtime changed. Stop its kernel before applying the new runtime.');
                }
            }
            const selector = services.get<ILocalPythonNotebookKernelSourceSelector>(ILocalPythonNotebookKernelSourceSelector);
            const connection = await selector.getKernelConnection({ id: pythonPath, path: pythonPath });
            if (!connection || !samePath(connection.interpreter.uri, pythonPath)) {
                throw new Error(`Cannot resolve the managed Python runtime: ${pythonPath}`);
            }
            const controller = controllers.addOrUpdate(connection, ['jupyter-notebook'])[0];
            if (!controller) {
                throw new Error('The managed Jupyter controller could not be registered.');
            }
            return { id: controller.id, selected: controllers.getSelected(notebook)?.id === controller.id };
        },
        async releaseKernel(notebook) {
            await kernels.get(notebook)?.dispose();
        }
    };
}
