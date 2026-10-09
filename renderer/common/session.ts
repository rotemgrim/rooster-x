import {type User} from "../entity/User";
import {IpcService} from "../services/ipc.service";

const USER_KEY = "user";

let user: User | null = null;

/** The profile using the app, or null on the login screen. */
export function currentUser(): User | null {
    return user;
}

/** The profile using the app, for the parts of it shown only after logging in. */
export function loggedInUser(): User {
    if (!user) {
        throw new Error("nobody is logged in");
    }
    return user;
}

/** Picks the profile every server call is made as; its id is remembered across reloads. */
export function setCurrentUser(u: User) {
    user = u;
    localStorage.setItem(USER_KEY, String(u.id));
    IpcService.setUserId(u.id);
}

/** The id of the profile picked last time, if any. */
export function savedUserId(): number | null {
    try {
        // older versions saved the whole user
        const saved = JSON.parse(localStorage.getItem(USER_KEY) || "null");
        return (typeof saved === "number" ? saved : saved?.id) ?? null;
    } catch {
        return null;
    }
}

export function logout() {
    localStorage.removeItem(USER_KEY);
    location.reload();
}
