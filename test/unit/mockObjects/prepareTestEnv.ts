import AppGlobal from "../../../src/main/helpers/AppGlobal";
import {URL} from "url";
import {IConfig} from "../../../src/common/models/IConfig";

const config: IConfig = {
    serverUrl: new URL("https://dapp.rooster-x.com/"),
    // serverUrl: new URL("http://10.10.60.20:8000"),
};
AppGlobal.setConfig(config);

console.info = () => { return; };
console.debug = () => { return; };
console.warn = () => { return; };
// console.error = () => { return; };

export const testDir = "test/unit/";
export const mocks = testDir + "mockData/";
