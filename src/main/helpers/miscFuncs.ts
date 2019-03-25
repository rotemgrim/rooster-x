
export function getChromiumErrorTypeByNetErrorCode(code: number): string {
    let errorType = "Unknown";
    code = Math.abs(code);
    // https://cs.chromium.org/chromium/src/net/base/net_error_list.h
    if (code > 99 && code < 200) {
        errorType = "Connection";
    }
    if (code > 199 && code < 300) {
        errorType = "Certificate";
    }
    if (code > 299 && code < 400) {
        errorType = "HTTP";
    }
    if (code > 399 && code < 500) {
        errorType = "Cache";
    }
    if (code > 499 && code < 600) {
        errorType = "Unknown";
    }
    if (code > 599 && code < 700) {
        errorType = "FTP errors";
    }
    if (code > 699 && code < 800) {
        errorType = "Certificate manager";
    }
    if (code > 799 && code < 900) {
        errorType = "DNS";
    }
    return errorType;
}

export function getServerError(error: any): any {
    if (error && error.response && error.response.data) {
        return error.response.data.detail;
    } else if (error && error.message) {
        return error.message;
    } else if (error && error.errno) {
        return error.errno;
    } else if (error && error.code) {
        return error.code;
    } else {
        return error;
    }
}

export function getProxy(): any {
    const tmp = [process.env.HTTPS_PROXY || process.env.https_proxy,
        process.env.HTTP_PROXY || process.env.http_proxy];
    if (tmp[0] === undefined && tmp[1] === undefined) {
        return "none";
    }
    return tmp;
}
