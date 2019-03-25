import {ipcRenderer} from "electron";
import * as uuid from "uuid/v4";
import {AbstractPromiseIpc} from "./AbstractPromiseIpc";
// import * as Promise from "bluebird";

export class RendererPromiseIpc extends AbstractPromiseIpc {
    private maxTimeoutMs: number = 1000;
    constructor(opts) {
        super();
        if (opts) {
            this.maxTimeoutMs = opts.maxTimeoutMs;
        }
    }

    public send(route, ...dataArgs): Promise<any> {
        return new Promise((resolve, reject) => {
            const replyChannel = `${route}#${uuid()}`;
            let timeout;
            let didTimeOut = false;

            // ipcMain will send a message back to replyChannel when it finishes calculating
            ipcRenderer.once(replyChannel, (event, status, returnData) => {
                clearTimeout(timeout);
                if (didTimeOut) {
                    return null;
                }
                const data = AbstractPromiseIpc.translateReturndData(returnData);
                switch (status) {
                    case "success":
                        return resolve(data);
                    case "failure":
                        return reject(data);
                    default:
                        return reject(new Error(`Unexpected IPC call status "${status}" in ${route}`));
                }
            });
            ipcRenderer.send(route, replyChannel, ...dataArgs.map(o => AbstractPromiseIpc.prepareDataForSend(o)));

            if (this.maxTimeoutMs) {
                timeout = setTimeout(() => {
                    didTimeOut = true;
                    console.error("Renderer PromiseIpc times out after " + (this.maxTimeoutMs / 1000) + " seconds");
                    reject(new Error(`${route} timed out.`));
                }, this.maxTimeoutMs);
            }
        });
    }

    // If I ever implement `off`, then this method will actually use `this`.
    // eslint-disable-next-line class-methods-use-this
    public on(route, listener) {
        ipcRenderer.on(route, (event, replyChannel, ...dataArgs) => {
            const args = dataArgs.map(o => AbstractPromiseIpc.translateReturndData(o));
            // Chaining off of Promise.resolve() means that listener can return a promise, or return
            // synchronously -- it can even throw. The end result will still be handled promise-like.
            Promise.resolve().then(() => listener(...args))
                .then(results =>
                    ipcRenderer.send(replyChannel, "success", AbstractPromiseIpc.prepareDataForSend(results)))
                .catch((e) => {
                    let res = e;
                    if (e && e.response) {
                        res = e.response.data ? e.response.data : e.response;
                    } else if (e instanceof Error) {
                        res = {message: e.message, name: e.name};
                    }
                    ipcRenderer.send(replyChannel, "failure", AbstractPromiseIpc.prepareDataForSend(res));
                });
        });
    }
}
