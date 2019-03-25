
export const app = {
    getPath: () => {
        return "test/unit/mockData/";
    },
};

export const ipcMain = {
    emit: (...args) => {
        // mocking emit do nothing
    },
};
