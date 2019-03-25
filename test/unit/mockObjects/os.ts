import * as originalOs from "os";
import * as uuidv1 from "uuid/v1";

const hostName = "IntegrationTest-" + uuidv1().substring(0, 8);

export const osMock = Object.assign(originalOs, {
    hostname() {
        return hostName;
    },
});
