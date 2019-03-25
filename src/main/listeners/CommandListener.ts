
import CommandWatch from "../services/CommandWatch";
import AppController from "../controllers/AppController";

export default class CommandListener {

    public static init(): void {
        const watcher: CommandWatch = new CommandWatch();
        CommandListener.listen(watcher);
    }

    private static listen(watcher: CommandWatch) {

        watcher.on("quit", () => {
            AppController.quit();
        });

        // ===== below this line for test suit ===== //

        // watcher.on("logout", () => {
        //     console.log("logout command received");
        //     AppController.logout();
        // });
    }

    // private static openLoginIfNotConnect(func: () => void) {
    //     if (!AuthService.getCurrentUser().isLoggedin()) {
    //         // handle not connected situation
    //         AppController.login();
    //     } else {
    //         func();
    //     }
    // }
}
