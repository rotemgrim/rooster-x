
import { expect } from 'chai';
import { describe, it } from "mocha";

import * as cv from "compare-versions"; // tslint:disable-line
import compareVersions = require('compare-versions'); // tslint:disable-line
import Validators from "./../../src/common/Validators";

describe("Tests the Validators functions", () => {
    it('checks version compare', () => {
        expect(Validators.isValidVersion('1.0.0.100')).to.equal(true);
        expect(Validators.isValidVersion('1.0.0.100', '1.0.0.101')).to.equal(true);
        expect(Validators.isValidVersion('1.0.0.100', '-master')).to.equal(false);
        expect(compareVersions('1.0.0.100', '1.0.0.100')).to.equal(0);
        expect(compareVersions('1.0.0.100', '1.0.0.101')).to.equal(-1);
        expect(compareVersions('1.0.0.100', '1.0.0.99')).to.equal(1);
    });
});
