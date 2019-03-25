
export function waitFor(func, retryTime = 100, timeoutTime = 60000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            clearInterval(interval);
            reject("timed out");
        }, timeoutTime);
        const interval = setInterval(async () => {
            // console.log(func.toString(), await func());
            if (await func() === true) {
                clearTimeout(timeout);
                clearInterval(interval);
                resolve();
            }
        }, retryTime);
    });
}
