export const remote_functions = {
    /**
     * @param {{ age : number, name : string }} body
     * @param {File} file
     */
    greetings: async (body, file) => {
        console.log(body, file);
        return { message: `Hello from server "${body.age} ${body.name}"`, date: new Date() };
    },
    /**
     * @param {string} body
     */
    console_log: async (body) => {
        console.log(body);
        return null;
    },
    /**
     * @param {number} a
     * @param {number} b
     * @returns
     */
    add_numbers: async (a, b) => {
        console.log(a, b, a + b);
        return a + b;
    }
};
