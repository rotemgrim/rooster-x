export default class DiagTest {
    private readonly nameString: string;
    private results: boolean;
    private info: any;
    private started: number;
    private ended: number | null;

    constructor(nameString) {
        this.nameString = nameString;
        this.started = +Date.now();
        this.results = false;
        this.ended = null;
    }

    public start() {
        this.started = +Date.now();
        return this;
    }

    public passed() {
        this.results = true;
        this.endTest();
        return this;
    }

    public failed() {
        this.results = false;
        this.endTest();
        return this;
    }

    public setResult(bool: any) {
        this.results = bool;
        this.endTest();
        return this;
    }
    public setInfo(data) {
        this.info = data;
        return this;
    }

    private endTest(): number {
        const now = +Date.now();
        this.ended = now;
        return now;
    }

    private getEnded(): number {
        if (this.ended) {
            return this.ended;
        } else {
            return this.endTest();
        }
    }

    public toString() {
        // result | duration | test name | info(json string)
        const res = this.results ? "PASS" : "FAIL";
        const duration = ((this.getEnded() - this.started) / 1000).toFixed(2);
        const info = this.info ? " | " + JSON.stringify(this.info) : "";
        return `${res} | ${duration}s | ${this.nameString}${info}`;
    }
}
