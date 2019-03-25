export interface IConfirmationMsg {
    title: string;
    message?: string;

    /**
     * will be shot back upon user confirmation
     */
    onConfirmation: string;

    /**
     * will be shot back upon user cancel
     */
    onCancel: string;
}
