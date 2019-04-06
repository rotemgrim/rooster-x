import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./RoosterX";
import "./SelectDataBase";

@customElement("rooster-x-wrapper")
export class RoosterXWrapper extends LitElement {

    @property() public hasDbPath: boolean = false;
    @property() public isLoggedIn: boolean = true;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getConfig().then(config => {
            if (config.dbPath) {
                this.hasDbPath = true;

                // check if user is logged in
                // show login page
            } else {
                this.hasDbPath = false;
            }
        });
    }

    public render() {
        if (!this.hasDbPath) {
            return html`<select-database .wrapper=${this}></select-database>`;
        } else if (!this.isLoggedIn) {
            return html`loginPage`;
        }
        return html`<rooster-x></rooster-x>`;
    }
}
