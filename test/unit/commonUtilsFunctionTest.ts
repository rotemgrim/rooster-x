import { expect } from 'chai';
import { describe, it } from "mocha";
import * as fs from "fs";
import {
    getBaseNameFromPath,
    getBaseNameFromPathWithExt,
    getDirectoryPath,
    treeify,
} from "../../src/common/commonUtils";
import * as _ from "lodash";

const testDir = "test/unit/";
const mocks = testDir + "mockData/";
const pathsToCheck = [
    "M:\\SyncOrg\\file with spaces - .xlsx",
    "c:\\otherDir\\another\\fileWith.Dots.xlsx",
    "c:\\fileWith.Dots.xlsb",
    "M:\\SyncOrg\\file with spaces -&^.l;' (1).xlsx",
];

describe("Tests the common utility functions", () => {

    it('checks that getBaseNameFromPath working as expected', () => {
        const expectedResults = [
            "file with spaces - ",
            "fileWith.Dots",
            "fileWith.Dots",
            "file with spaces -&^.l;' (1)",
        ];
        for (const index in pathsToCheck) {
            if (pathsToCheck[index]) {
                expect(getBaseNameFromPath(pathsToCheck[index]))
                    .to.equal(expectedResults[index]);
            }
        }
    });

    it('checks that getBaseNameFromPathWithExt working as expected', () => {
        const expectedResults = [
            "file with spaces - .xlsx",
            "fileWith.Dots.xlsx",
            "fileWith.Dots.xlsb",
            "file with spaces -&^.l;' (1).xlsx",
        ];
        for (const index in pathsToCheck) {
            if (pathsToCheck[index]) {
                expect(getBaseNameFromPathWithExt(pathsToCheck[index]))
                    .to.equal(expectedResults[index]);
            }
        }
    });

    it('checks that getDirectoryPath working as expected', () => {
        const expectedResults = [
            "M:\\SyncOrg",
            "c:\\otherDir\\another",
            "c:\\",
            "M:\\SyncOrg",
        ];
        for (const index in pathsToCheck) {
            if (pathsToCheck[index]) {
                expect(getDirectoryPath(pathsToCheck[index]))
                    .to.equal(expectedResults[index]);
            }
        }
    });
});
