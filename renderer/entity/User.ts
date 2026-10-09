// Mirrors profile in server/users_controller.go.
export interface User {
    id: number;
    firstName: string;
    lastName: string;
    isAdmin: boolean;
    /** Only media rated for this age or younger is shown, and no unrated media; null for no limit. */
    maxAge: number | null;
}

/** The age limits a profile can get. */
export const AGE_LIMITS: (number | null)[] = [null, 7, 10, 13, 16, 18];

export const ageLimitLabel = (maxAge: number | null) => (maxAge == null ? "No age limit" : `Ages ${maxAge} and under`);

/** A profile with an age limit, which also has no downloads. */
export const isLimited = (user: User) => user.maxAge != null;
