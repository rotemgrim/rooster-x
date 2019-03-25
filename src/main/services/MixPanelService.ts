import * as MixPanel from "mixpanel";
import {Mixpanel} from "mixpanel";
import AppGlobal from "../helpers/AppGlobal";
import User from "../../common/models/User";

declare type MIX_PANEL_EVENT =
    "Open Single ConnectFlow" |
    "Open Multiple ConnectFlow" |
    "Open Convert To FileBox" |
    "Open File History" |
    "Open Show Changes" |
    "Open Cell History" |
    "Open Create KPI" |
    "Open File Info" |
    "Open Name Version" |
    "Open Insights" |
    "Logout Clicked" |
    "Login Clicked" |
    "Open Getting started" |
    "Open Help" |
    "Open Status" |
    "Open Settings" |
    "Quit" |
    "Refresh Alerts" |
    "Save Settings" |
    "OpenAppData Folder" |
    "OpenDevTools" |
    "Generate logs" |
    "Single Connect Finish" |
    "Single Connect To Existing Finish" |
    "Disconnect FileBox" |
    "Multiple Connect Finish";

declare type APP_COMPONENT =
    "Context Menu" |
    "AppIcon Menu" |
    "Excel plugin Menu" |
    "AppIcon Click" |
    "Status Window" |
    "Settings Window" |
    "File Info Window" |
    "ConnectFlow Window";

export default class MixPanelService {
    public static mixpanel: Mixpanel;
    private static isActive: boolean = false;
    private static token: string = "";

    public static init(user: User) {
        MixPanelService.token = user.getMixpanelToken();
        MixPanelService.isActive = user.isMixPanelActive();

        if (!MixPanelService.isActiveAndReady()) {
            return;
        }

        const serverProtocol: string = AppGlobal.getConfig().serverUrl.protocol.slice(0, -1);
        MixPanelService.mixpanel = MixPanel.init(MixPanelService.token, {
            protocol: serverProtocol,
        });

        MixPanelService.createUser(user);
        console.info("MixPanel initiated");
    }

    public static track(event: MIX_PANEL_EVENT, component: APP_COMPONENT | null = null, data: any = {}) {
        if (!MixPanelService.isActiveAndReady()) {
            return;
        }

        try {
            // this is instead of identify
            data = Object.assign(data, {
                // distinct_id: AuthService.getCurrentUser().getEmail(),
                client: "app",
                app_version: "{%VERSION%}",
            });

            if (component) {
                data = Object.assign(data, {component});
            }

            MixPanelService.mixpanel.track(event, data);
        } catch (e) {
            console.error("could not send event to mixpanel", e);
        }
    }

    private static createUser(user: User) {
        if (!MixPanelService.isActiveAndReady()) {
            return;
        }

        MixPanelService.mixpanel.people.set_once(user.getEmail(), {
            $created: (new Date()).toISOString(),
            domain: user.getEmail().split("@")[1],
            $email: user.getEmail(),
            $first_name: user.getFisrtName(),
            $last_name: user.getLastName(),
            $name: user.getUserName(),
            organization: user.getOrganization().name,
            organization_id: user.getOrganization().id,
        });
    }

    private static isActiveAndReady(): boolean {
        return !!(MixPanelService.isActive && MixPanelService.token);
    }
}
