import DiagTest from "./DiagTest";
import * as moment from "moment";

export default class Diagnostic {
    private diagArray: DiagTest[];
    private started: number;

    constructor() {
        this.diagArray = [];
        this.started = +Date.now();
        moment(Date.now()).utc().format("DD MMM, YYYY HH:mm");
    }

    public testFor(str: string): DiagTest {
        const diagTest = new DiagTest(str);
        this.diagArray.push(diagTest);
        return diagTest;
    }

    public toString() {
        const started = moment.unix(this.started / 1000).utc().format("DD MMM, YYYY HH:mm");
        let output = "\r\n========== " + started + " ==========\r\n";
        for (const dTest of this.diagArray) {
            output += dTest.toString() + "\r\n";
        }
        const duration = (+Date.now() - this.started) / 1000;
        output += "========== ended in " + duration + "s =============\r\n";
        return output;
    }
}
