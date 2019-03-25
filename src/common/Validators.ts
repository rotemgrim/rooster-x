
export default class Validators {

    // tslint:disable-next-line
    public static readonly semverRegex = /^v?(?:\d+)(\.(?:[x*]|\d+)(\.(?:[x*]|\d+)(\.(?:[x*]|\d+))?(?:-[\da-z\-]+(?:\.[\da-z\-]+)*)?(?:\+[\da-z\-]+(?:\.[\da-z\-]+)*)?)?)?$/i;
    public static readonly excludeFromFileBoxName = ["/", "\\", "\"", "<", ">", "*", ":", "?", "|"];

    public static isValidCharacterForFileBox(fileBoxName: string) {
        for (const substring of Validators.excludeFromFileBoxName) {
            if (fileBoxName.includes(substring)) {
                return false;
            }
        }
        return true;
    }

    public static isValidVersion(...versions) {
        for (const version of versions) {
            if (typeof version !== "string") {
                // throw new TypeError('Invalid argument expected string');
                return false;
            }
            if (!Validators.semverRegex.test(version)) {
                // throw new Error('Invalid argument not valid semver');
                return false;
            }
        }
        return true;
    }
}
