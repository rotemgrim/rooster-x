
export class AbstractPromiseIpc {
    protected static prepareDataForSend(data) {
        let res;
        if (typeof data === "object") {
            try {
                res = JSON.stringify(data);
            } catch (e) {
                res = data;
            }
        } else {
            res = data;
        }
        return res;
    }

    protected static translateReturndData(data) {
        if (typeof data === "string") {
            try {
                const o = JSON.parse(data);

                // Handle non-exception-throwing cases:
                // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
                // but... JSON.parse(null) returns null, and typeof null === "object",
                // so we must check for that, too. Thankfully, null is falsey, so this suffices:
                if (o && typeof o === "object") {
                    return o;
                } else {
                    return data;
                }
            } catch (e) {
                return data;
            }
        } else {
            return data;
        }
    }
}
