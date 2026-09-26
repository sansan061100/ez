let systemReadyPromise: Promise<void> | null = null;

// setSystemReadyPromise sets the promise which is resolved after the system is initialized
export function setSystemReadyPromise(promise: Promise<void>): void {
    systemReadyPromise = promise;
}

// waitForSystemReady waits for the system initialization, all requests should be handled after that
export async function waitForSystemReady(): Promise<void> {
    if (!systemReadyPromise) {
        throw new Error('system is not initialized');
    }

    await systemReadyPromise;
}
