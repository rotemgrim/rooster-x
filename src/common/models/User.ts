
export default class User {

    private id: number = 0;
    private userName: string = "";
    private email: string = "";
    private firstName: string = "";
    private lastName: string = "";
    private status: string = "";
    private type: string = "";
    private accountType: "Enterprise" | string = "";
    private permissions = {} as any;
    private groups: string[] = [];
    private organizationSettings: any;
    private organization: any;
    private mixPanelToken: string = "";
    private mixPanelIsActive: boolean = false;

    public isLoggedin(): boolean {
        // if
        // if csrf is not old && sessionId valid
            // return true;

        return false;
    }

    public setLoggedIn(bool: boolean) {
        // this.didLogIn = bool;
    }

    public setFieldsFromData(data: any) {
        // console.log("set user from data", data);
        // { id: 2,
        //     username: 'admin',
        //     email: 'rotem.g@rooster-x.io',
        //     groups: [],
        //     status: 'ACTIVE',
        //     type: 'PROCESS_OWNER',
        //     first_name: '',
        //     last_name: '',
        //     account_type: 'Enterprise',
        //     permissions: [Array],
        //     organization_settings: null,
        //     organization: [Object],
        //     mixpanel_token: 'e39cf61005a01016e6f59759be6edc60'
        // }
        const permissions = data.permissions ? data.permissions.rawData || data.permissions : [];
        this.setUserId(data.id);
        this.setUserName(data.userName);
        this.setEmail(data.email);
        this.setGroups(data.groups);
        this.setStatus(data.status);
        this.setType(data.type);
        this.setFisrtName(data.first_name || data.firstName);
        this.setLastName(data.last_name || data.lastName);
        this.setAccountType(data.account_type || data.accountType);
        this.setPermissions(permissions);
        this.setOrganizationSettings(data.organization_settings || data.organizationSettings);
        this.setOrganization(data.organization);
        this.setMixpanelToken(data.mixpanel_token || data.mixPanelToken);
        this.setMixPanelIsActive(data.is_mix_panel_active || data.mixPanelIsActive || false);
    }

    public getUserId(): number {
        return this.id;
    }
    public getUserName(): string {
        return this.userName;
    }
    public getEmail(): string {
        return this.email;
    }
    public getFisrtName(): string {
        return this.firstName;
    }
    public getLastName(): string {
        return this.lastName;
    }
    public getSessionKey(): any {
        // return this.sessionKey;
        return "";
    }
    public setSessionKey(value: any) {
        // this.sessionKey = value;
    }
    public getStatus(): string {
        return this.status;
    }
    public getType(): string {
        return this.type;
    }
    public getAccountType(): string {
        return this.accountType;
    }
    public getPermissions(): any {
        return this.permissions;
    }
    public getGroups(): string[] {
        return this.groups;
    }
    public getOrganizationSettings(): any {
        return this.organizationSettings;
    }
    public getOrganization(): {id: number, name: string} {
        return this.organization;
    }
    public getMixpanelToken(): string {
        return this.mixPanelToken;
    }
    public isMixPanelActive(): boolean {
        return this.mixPanelIsActive;
    }
    private setLastName(value: string) {
        this.lastName = value;
    }
    private setGroups(value: string[]) {
        this.groups = value;
    }
    private setPermissions(value: string[]) {
        this.permissions = {};
    }
    private setOrganizationSettings(value: any) {
        this.organizationSettings = value;
    }
    private setOrganization(value: any) {
        this.organization = value;
    }
    private setUserId(value: number) {
        this.id = value;
    }
    private setUserName(value: string) {
        this.userName = value;
    }
    private setEmail(value: string) {
        this.email = value;
    }
    private setFisrtName(value: string) {
        this.firstName = value;
    }
    private setStatus(value: string) {
        this.status = value;
    }
    private setType(value: string) {
        this.type = value;
    }
    private setAccountType(value: string) {
        this.accountType = value;
    }
    private setMixpanelToken(value: string) {
        this.mixPanelToken = value;
    }
    private setMixPanelIsActive(value: boolean) {
        this.mixPanelIsActive = value;
    }
}
