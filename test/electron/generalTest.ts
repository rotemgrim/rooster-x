import { clipboard } from "electron";
import { expect } from 'chai';
import { describe, it } from "mocha";

/* global describe it */

describe('Electron general checks', function () {
    it('runs in main process by default', function () {
        expect(process["type"]).to.equal("browser");
    });
    it('checks that electron clipboard is working', () => {
        clipboard.writeText("save text");
        expect(clipboard.readText()).to.equal("save text");
    })
});