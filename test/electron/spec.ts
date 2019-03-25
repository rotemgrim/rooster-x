/// <reference types="node" />
import {Application, SpectronClient} from "spectron";
import { expect } from 'chai';
import * as path from "path";
import {describe, it, before, after} from "mocha";
import * as electronMock from "../unit/mockObjects/electron";
import {osMock} from "../unit/mockObjects/os";
import * as mockery from "mockery";

mockery.registerMock('electron', electronMock);
mockery.registerMock('os', osMock);
mockery.enable({
    useCleanCache: true,
    warnOnReplace: false,
    warnOnUnregistered: false,
});
import AppCommands from "./spectronMethods/sendCommands";
import {waitFor} from "./spectronMethods/testHelpers";

const endOfLine = "-eol$";
const drDelimiter = "rooster-x-delimiter";
const dataMockXcelFile = path.join(__dirname, "../../", "test", "unit", "mockData", "AutoUnitFunctionTest.xlsx");
let client: SpectronClient;
const app: Application = new Application({
    path: path.join("dist", "win-ia32-unpacked", "Rooster-XSync.exe"),
    args: [path.join(__dirname, '../../')],
});

describe('Application launch', function() {
    this.timeout(30000);
    before(() => {
        return app.start().then(() => {
            client = app.client;
            AppCommands.init(app);
        }).catch(() => {
            console.log("dead!");
        });
    });

    after(function(done): any {
        this.timeout(30000);
    });

    it('check that is running', function() {
        this.timeout(10000);
        return app.client.getWindowCount().then(count => {
            // console.log("count", count);
            expect(count).to.be.greaterThan(0);
            // Please note that getWindowCount() will return 2 if `dev tools` are opened.
            // assert.equal(count, 2)
        });
    });

    it('check that user is logged in with correct user', function(done) {
        this.timeout(60000);
        waitFor(() => AppCommands.gotAnswerForConnected)
            .then( async () => {
                if (AppCommands.isUserConnected) {
                    done();
                } else {
                    done();
                }
            }).catch((e) => {
                console.error(e);
            });
    });

    it('activates the connect command to show the window', async function() {
        this.timeout(15000);
        const connectTxtCmd = "connect " + drDelimiter + " " + dataMockXcelFile + " " + endOfLine + "\n\r";
        return AppCommands.write(connectTxtCmd);
    });

    it('checks that multipurpose window is visible', async function() {
        this.timeout(60000);
        return await getWindowByElement(app, "#connectToNewBtn", "New FileBox");
    });

    it('connecting file', async function() {
        this.timeout(60000);
        AppCommands.logListener.clear();
        const handle = await getWindowByElement(app, "#connectToNewBtn", "New FileBox");
        return app.client.click('#connectToNewBtn')
            .then(() => app.client.window(handle).click("#qa-connect-btn"))
            .then(() => app.client.window(handle).waitForExist(".b-success", 30000))
            .then(() => app.client.window(handle).click("#qa-done-connect-btn"))
            .catch(() => app.client.window(handle).waitForExist("#qa-errorMsg-step", 30000));
    });

    it('open History page', function() {
        const txtCmd = "history " + drDelimiter + " " + dataMockXcelFile + " " + endOfLine + "\n\r";
        this.timeout(60000);
        return AppCommands.write(txtCmd)
            .then(async () => await getWindowByElement(app, "#qaVersion", "Versions"));
    });

    it('hide History page', async function() {
        await app.electron.ipcRenderer.send("hide-me");
    });

    it('open connected file', function() {
        const txtCmd = "fileInfo " + drDelimiter + " " + dataMockXcelFile + " " + endOfLine + "\n\r";
        this.timeout(30000);
        return AppCommands.write(txtCmd);
    });

    it('disconnect file', async function() {
        this.timeout(30000);
        const handle = await getWindowByElement(app, "#qa-already-connected", "is already Connected");
        return app.client.window(handle).click('#qa-disconnect-btn')
            .then(async () => await app.client.window(handle).waitForExist(".b-success"));
    });

});
