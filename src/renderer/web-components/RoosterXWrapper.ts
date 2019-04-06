import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./RoosterX";
import "./SelectDataBase";
import "./UserLogin";
import {IConfig} from "../../common/models/IConfig";

@customElement("rooster-x-wrapper")
export class RoosterXWrapper extends LitElement {

    @property() public hasDbPath: boolean = false;
    @property() public isLoggedIn: boolean = false;
    @property() public config: IConfig;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getConfig().then(config => {
            this.config = config;
            if (config.dbPath) {
                this.hasDbPath = true;

                // check if user is logged in
                if (config.userId) {
                    IpcService.getUser(config.userId)
                        .then(user => {
                            console.log(user);
                        })
                        .catch(console.log);
                } else {
                    this.isLoggedIn = false;
                }
            } else {
                this.hasDbPath = false;
            }
        });
    }

    public render() {
        if (!this.hasDbPath) {
            return html`<select-database .wrapper=${this}></select-database>`;
        } else if (!this.isLoggedIn) {
            return html`<user-login .wrapper=${this}></user-login>`;
        }
        return html`<rooster-x></rooster-x>`;
    }
}
