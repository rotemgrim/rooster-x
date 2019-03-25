// import { expect } from 'chai';
import { describe, it } from "mocha";
import CommandWatch from "../../src/main/services/CommandWatch";
import * as fs from "fs";

console.info = () => { return; };
let commandWatch: CommandWatch;

describe('Command watch tests', function() {

    it("checks if can start command watch", function(done) {
        this.timeout(10000);
        commandWatch = new CommandWatch();
        commandWatch.on("startedWatching", (data) => {
            done();
        });
    });

    it("checks that we can pass commands", function(done) {
        this.timeout(10000);
        commandWatch.on("activate", () => {
            done();
        });
        const txtCmd = "activate " + CommandWatch.getRoDelimiter() +
            " someFilePath " + CommandWatch.getEndOfLine() + "\n\r";
        fs.appendFile(CommandWatch.getCommandFilePath(), txtCmd, err => {
            if (err) {
                done(err);
            }
        });
    });
});
