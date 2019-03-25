import { describe, it } from "mocha";
import { expect } from 'chai';
import * as mockery from "mockery";
import * as electronMock from "./mockObjects/electron";
import * as path from "path";
import {to} from "../../src/common/commonUtils";
import "./mockObjects/prepareTestEnv";

console.info = () => { return; };

mockery.registerAllowable('mkdirp', 'path', 'xlsx-populate');
mockery.registerMock('electron', electronMock);
mockery.enable({
    useCleanCache: true,
    warnOnReplace: false,
    warnOnUnregistered: false,
});

import ConfigController from "../../src/main/controllers/ConfigController";
import {
    checkIfFilePasswordProtected,
    deleteDrIni,
    getDrIniGuidOrCreate,
    isDrIniExistAsync,
    isValidGuid,
} from "../../src/main/helpers/Utils";

const mocks = path.join(__dirname, "mockData/");

describe("Tests the Rooster-X main utility functions", () => {
    it('checks that we test valid guid correctly', () => {
        expect(isValidGuid("someStrings")).to.equal(false);
        expect(isValidGuid("a9467730-8aa3-11e-9314-a183694152d6")).to.equal(false);
        expect(isValidGuid("a9467730-8aa3-11e8-9314-a183694152d6")).to.equal(true);
    });

    it('checks that we can load config file properly', async () => {
        // sync operation
        const config = await ConfigController.loadConfig();
        expect(!!config.serverUrl.href).to.be.equal(true);
    });
});

mockery.disable();
mockery.deregisterAll();
